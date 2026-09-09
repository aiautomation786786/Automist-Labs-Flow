/**
 * GeminiImagePostProcessingService – Production-grade local post-processing image watermark pipeline.
 *
 * Responsibilities:
 *  - Automatically detects image orientation and queries GeminiImageWatermarkDetector.
 *  - If watermark is detected, non-destructively preserves the untouched original image as `<path>_original.<ext>`.
 *  - Executes localized reconstruction (tight delogo / reverse alpha blending) asynchronously via FFmpeg.
 *  - Preserves visual fidelity (-update 1, lossless or high-quality image muxing).
 *  - If watermark is NOT detected, skips processing entirely to preserve pristine source without modification.
 *  - Resilient fallback: returns original image without failing the generation job if FFmpeg is unavailable.
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
  reconstructionMethod?: 'reverse_alpha_blending' | 'delogo_fallback';
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

      let reconMethod: 'reverse_alpha_blending' | 'delogo_fallback' = 'reverse_alpha_blending';
      let reverseAlphaSuccess = false;

      try {
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

        if (rawBuffer && rawBuffer.length >= width * height * 3) {
          const { modifiedPixels } = WatermarkMasks.applyReverseAlphaBlend(
            rawBuffer,
            width,
            height,
            x0,
            y0,
            variant,
            { alphaGain, channels: 3 }
          );
          log.info('gemini_image_post_process', `Reverse-alpha reconstructed ${modifiedPixels} pixels under watermark at (${x0}, ${y0}) with gain ${alphaGain}`);

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
            reverseAlphaSuccess = fs.existsSync(tempCleanPath) && fs.statSync(tempCleanPath).size >= 1000;
          } finally {
            if (fs.existsSync(tempRawPath)) {
              try { fs.unlinkSync(tempRawPath); } catch {}
            }
          }
        }
      } catch (revErr) {
        log.warn('gemini_image_post_process', `Reverse-alpha blending failed, falling back to delogo: ${(revErr as Error).message}`);
      }

      // Safety fallback to delogo if reverse alpha blending did not succeed
      if (!reverseAlphaSuccess) {
        reconMethod = 'delogo_fallback';
        log.warn('gemini_image_post_process', `Applying fallback delogo reconstruction for [x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h}]`);
        const delogoFilter = `delogo=x=${bbox.x}:y=${bbox.y}:w=${bbox.w}:h=${bbox.h}:show=0`;
        await execFileAsync(
          ffmpegPath,
          [
            '-y',
            '-i', originalBackupPath,
            '-vf', delogoFilter,
            '-update', '1',
            tempCleanPath,
          ],
          { timeout: timeoutMs }
        );
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
