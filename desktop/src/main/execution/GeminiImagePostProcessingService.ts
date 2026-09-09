/**
 * GeminiImagePostProcessingService – Production-grade local post-processing image watermark pipeline.
 *
 * Responsibilities:
 *  - Automatically detects image orientation and queries GeminiImageWatermarkDetector.
 *  - If watermark is detected, non-destructively preserves the untouched original image as `<path>_original.<ext>`.
 *  - Executes localized reverse-alpha reconstruction on raw pixel buffers.
 *  - Preserves original pixels outside the watermark footprint byte-for-byte.
 *  - If watermark is NOT detected, skips processing entirely to preserve pristine source without modification.
 *  - Strict quality rule: Does NOT use delogo/blur fallback; if reverse-alpha fails, preserves original.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';
import { GeminiImageWatermarkDetector, type ImageWatermarkBoundingBox } from './GeminiImageWatermarkDetector';
import { WatermarkMasks } from './WatermarkMasks';

const execFileAsync = promisify(execFile);
const log = new AppLogger({ mirrorToStderr: false });

export interface ImageWatermarkCleanOptions {
  ratio?: string;         // '16:9' | '9:16' | '1:1'
  width?: number;
  height?: number;
  timeoutMs?: number;     // Defaults to 15000 ms
  officialOptOut?: boolean;
}

export interface ImageWatermarkCleanResult {
  success: boolean;
  cleanImagePath: string;
  originalImagePath: string;
  durationMs: number;
  watermarkCleaned: boolean;
  detectionMethod?: string;
  reconstructionMethod?: 'reverse_alpha_blending' | 'reverse_alpha_alternate_variant';
  confidence?: number;
  boundingBox?: ImageWatermarkBoundingBox;
  error?: string;
}

export class GeminiImagePostProcessingService {
  /**
   * Checks whether FFmpeg is available on the host system to perform local cleaning.
   */
  static isAvailable(): boolean {
    const ffmpegPath = FfmpegResolver.findFfmpeg();
    return !!ffmpegPath;
  }

  /**
   * Cleans the visible Gemini diamond watermark from an image file asynchronously.
   *
   * Non-destructive:
   *  - Preserves the untouched original image at `<basename>_original<ext>`.
   *  - Replaces `<imagePath>` with the cleaned version so UI preview and exports work seamlessly.
   *  - Falls back gracefully to the original file if cleaning fails.
   */
  static async cleanImageWatermark(
    imagePath: string,
    outputCleanPath?: string,
    options: ImageWatermarkCleanOptions = {}
  ): Promise<ImageWatermarkCleanResult> {
    const startTime = Date.now();

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        cleanImagePath: imagePath,
        originalImagePath: imagePath,
        durationMs: 0,
        watermarkCleaned: false,
        error: `Input image does not exist: ${imagePath}`,
      };
    }

    const ffmpegPath = FfmpegResolver.findFfmpeg();
    if (!ffmpegPath) {
      log.warn('gemini_image_post_process', 'FFmpeg binary not resolved; skipping watermark removal.');
      return {
        success: false,
        cleanImagePath: imagePath,
        originalImagePath: imagePath,
        durationMs: 0,
        watermarkCleaned: false,
        error: 'FFmpeg binary not found on system',
      };
    }

    // Run multi-tier image watermark detection
    const detection = await GeminiImageWatermarkDetector.detect(imagePath, {
      ratio: options.ratio,
      width: options.width,
      height: options.height,
      officialOptOut: options.officialOptOut,
    });

    if (!detection.detected) {
      log.info('gemini_image_post_process', `Watermark not detected on ${imagePath} (${detection.method}); skipping reconstruction to preserve pristine source.`);
      return {
        success: true,
        cleanImagePath: imagePath,
        originalImagePath: imagePath,
        durationMs: Date.now() - startTime,
        watermarkCleaned: false,
        detectionMethod: detection.method,
        confidence: detection.confidence,
      };
    }

    const dir = path.dirname(imagePath);
    const ext = path.extname(imagePath) || '.png';
    const base = path.basename(imagePath, ext);

    const originalBackupPath = path.join(dir, `${base}_original${ext}`);
    const tempCleanPath = outputCleanPath || path.join(dir, `${base}_clean_tmp${ext}`);
    const targetCleanPath = outputCleanPath || imagePath;

    try {
      const bbox = detection.boundingBox;
      log.info('gemini_image_post_process', `Reconstructing watermark region [x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h}] via FFmpeg`);

      // 1. Non-destructively preserve original image if backup does not already exist
      if (!fs.existsSync(originalBackupPath)) {
        fs.copyFileSync(imagePath, originalBackupPath);
        log.info('gemini_image_post_process', `Preserved untouched original image at: ${originalBackupPath}`);
      }

      // 2. Execute localized reconstruction
      // Primary: Mathematically precise in-memory reverse alpha blending on raw pixel buffer
      // Invariant: Modifies ONLY pixels covered by the watermark, preserving fine textures and background
      const width = detection.imageDimensions.width;
      const height = detection.imageDimensions.height;
      const x0 = detection.exactCoordinates?.x0 ?? bbox.x;
      const y0 = detection.exactCoordinates?.y0 ?? bbox.y;
      const variant = detection.variant ?? (Math.max(width, height) > 1500 ? '96' : '48');
      const alphaGain = detection.alphaGain ?? 0.60;
      const timeoutMs = options.timeoutMs || 15000;

      let reconMethod: 'reverse_alpha_blending' | 'reverse_alpha_alternate_variant' = 'reverse_alpha_blending';
      let reverseAlphaSuccess = false;

      // Helper to attempt in-memory reverse alpha reconstruction with a specified variant
      const attemptReconstruction = async (varToTry: '48' | '96'): Promise<boolean> => {
        const { stdout: rawBuffer } = await execFileAsync(
          ffmpegPath,
          [
            '-y',
            '-i', originalBackupPath,
            '-f', 'rawvideo',
            '-pix_fmt', 'rgb24',
            '-',
          ],
          { encoding: 'buffer' as any, maxBuffer: 150 * 1024 * 1024, timeout: timeoutMs }
        );

        if (!rawBuffer || rawBuffer.length < width * height * 3) {
          return false;
        }

        const { modifiedPixels } = WatermarkMasks.applyReverseAlphaBlend(
          rawBuffer,
          width,
          height,
          x0,
          y0,
          varToTry,
          { alphaGain, channels: 3 }
        );
        log.info('gemini_image_post_process', `Reverse-alpha reconstructed ${modifiedPixels} pixels under watermark at (${x0}, ${y0}) with variant ${varToTry}`);

        const tempRawPath = path.join(dir, `${base}_temp_recon_${Date.now()}.raw`);
        fs.writeFileSync(tempRawPath, rawBuffer);
        try {
          await execFileAsync(
            ffmpegPath,
            [
              '-y',
              '-f', 'rawvideo',
              '-pix_fmt', 'rgb24',
              '-s', `${width}x${height}`,
              '-i', tempRawPath,
              '-update', '1',
              tempCleanPath,
            ],
            { timeout: timeoutMs }
          );
          return fs.existsSync(tempCleanPath) && fs.statSync(tempCleanPath).size >= 1000;
        } finally {
          if (fs.existsSync(tempRawPath)) {
            try { fs.unlinkSync(tempRawPath); } catch {}
          }
        }
      };

      try {
        reverseAlphaSuccess = await attemptReconstruction(variant);
      } catch (revErr) {
        log.warn('gemini_image_post_process', `Primary reverse-alpha variant (${variant}) failed: ${(revErr as Error).message}`);
      }

      // If primary variant failed, attempt alternate mask variant
      if (!reverseAlphaSuccess) {
        const altVariant: '48' | '96' = variant === '48' ? '96' : '48';
        log.info('gemini_image_post_process', `Attempting alternate reverse-alpha variant (${altVariant})`);
        try {
          reverseAlphaSuccess = await attemptReconstruction(altVariant);
          if (reverseAlphaSuccess) {
            reconMethod = 'reverse_alpha_alternate_variant';
          }
        } catch (altErr) {
          log.warn('gemini_image_post_process', `Alternate reverse-alpha variant (${altVariant}) also failed: ${(altErr as Error).message}`);
        }
      }

      // Strict Quality Rule: NEVER fall back to delogo/blur. If reverse-alpha fails, surface failure and preserve original.
      if (!reverseAlphaSuccess) {
        throw new Error('Reverse-alpha reconstruction failed across all calibrated variants; preserving original to prevent blur/smear artifacts');
      }

      // 3. Verify reconstructed file exists and is valid
      if (!fs.existsSync(tempCleanPath)) {
        throw new Error(`FFmpeg finished but cleaned image was not produced at: ${tempCleanPath}`);
      }

      const tempStat = fs.statSync(tempCleanPath);
      if (tempStat.size < 1000) {
        throw new Error(`Cleaned image file is unexpectedly small: ${tempStat.size} bytes`);
      }

      // 4. Atomically swap tempCleanPath into targetCleanPath
      if (targetCleanPath === imagePath) {
        try {
          fs.unlinkSync(imagePath);
        } catch {}
      }
      fs.renameSync(tempCleanPath, targetCleanPath);

      const durationMs = Date.now() - startTime;
      log.info('gemini_image_post_process', `Watermark successfully removed in ${durationMs}ms -> ${targetCleanPath}`);

      return {
        success: true,
        cleanImagePath: targetCleanPath,
        originalImagePath: originalBackupPath,
        durationMs,
        watermarkCleaned: true,
        detectionMethod: detection.method,
        reconstructionMethod: reconMethod,
        confidence: detection.confidence,
        boundingBox: bbox,
      };
    } catch (err) {
      log.error('gemini_image_post_process', `Watermark removal failed: ${(err as Error).message}. Falling back safely to original.`);

      // Clean up temp file if present
      if (fs.existsSync(tempCleanPath)) {
        try { fs.unlinkSync(tempCleanPath); } catch {}
      }

      // Ensure targetCleanPath exists
      if (!fs.existsSync(targetCleanPath) && fs.existsSync(originalBackupPath)) {
        try { fs.copyFileSync(originalBackupPath, targetCleanPath); } catch {}
      }

      return {
        success: false,
        cleanImagePath: imagePath,
        originalImagePath: fs.existsSync(originalBackupPath) ? originalBackupPath : imagePath,
        durationMs: Date.now() - startTime,
        watermarkCleaned: false,
        error: (err as Error).message,
      };
    }
  }
}
