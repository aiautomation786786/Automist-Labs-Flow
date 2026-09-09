/**
 * GeminiPostProcessingService – Production-grade local post-processing video watermark pipeline.
 *
 * Responsibilities:
 *  - Automatically detects aspect ratio (16:9 vs 9:16) and calculates the precise
 *    watermark bounding box coordinates for Gemini/Veo generated videos.
 *  - Non-destructively preserves the untouched original downloaded video as `<path>_original.mp4`.
 *  - Executes visually high-fidelity reverse-alpha reconstruction in planar RGB asynchronously via FFmpeg.
 *  - Losslessly copies audio stream (-c:a copy) and re-encodes video with visually pristine settings (-c:v libx264 -crf 18 -preset veryfast).
 *  - Strict quality rule: Does NOT use delogo/blur fallback; if reverse-alpha fails, preserves original.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';
import { GeminiWatermarkDetector } from './GeminiWatermarkDetector';
import { WatermarkMasks } from './WatermarkMasks';
export type { WatermarkBoundingBox } from './GeminiWatermarkDetector';

const execFileAsync = promisify(execFile);
const log = new AppLogger({ mirrorToStderr: false });

export interface WatermarkCleanOptions {
  ratio?: string;         // '16:9' | '9:16'
  width?: number;
  height?: number;
  timeoutMs?: number;     // Defaults to 45000 ms
  officialOptOut?: boolean;
}

export interface WatermarkCleanResult {
  success: boolean;
  cleanVideoPath: string;
  originalVideoPath: string;
  durationMs: number;
  watermarkCleaned?: boolean;
  detectionMethod?: string;
  reconstructionMethod?: 'reverse_alpha_blending' | 'reverse_alpha_alternate_variant';
  error?: string;
}

export class GeminiPostProcessingService {
  /**
   * Resolves the watermark bounding box based on aspect ratio and resolution.
   */
  static getWatermarkBoundingBox(ratio?: string, width?: number, height?: number): { x: number; y: number; w: number; h: number } {
    const isPortrait = ratio === '9:16' || (width !== undefined && height !== undefined && height > width);

    if (isPortrait) {
      // 9:16 portrait orientation (720x1280 or scaled)
      if (width && width > 720) {
        // 1080x1920
        return { x: 860, y: 1700, w: 90, h: 90 };
      }
      return { x: 570, y: 1130, w: 60, h: 60 };
    }

    // Default 16:9 landscape orientation (1280x720 or 1920x1080)
    if (width && width > 1280) {
      // 1920x1080
      return { x: 1700, y: 860, w: 90, h: 90 };
    }
    return { x: 1130, y: 570, w: 60, h: 60 };
  }

  /**
   * Checks whether FFmpeg is available on the host system to perform local cleaning.
   */
  static isAvailable(): boolean {
    const ffmpegPath = FfmpegResolver.findFfmpeg();
    return !!ffmpegPath;
  }

  /**
   * Cleans the visible Gemini diamond watermark from a video file asynchronously.
   *
   * Non-destructive:
   *  - Preserves the untouched original video at `<basename>_original.mp4`.
   *  - Replaces `<videoPath>` with the cleaned version so UI preview and exports work seamlessly.
   *  - Falls back gracefully to the original file if cleaning fails.
   */
  static async cleanVideoWatermark(
    videoPath: string,
    outputCleanPath?: string,
    options: WatermarkCleanOptions = {}
  ): Promise<WatermarkCleanResult> {
    const startTime = Date.now();

    if (!fs.existsSync(videoPath)) {
      return {
        success: false,
        cleanVideoPath: videoPath,
        originalVideoPath: videoPath,
        durationMs: 0,
        error: `Input video does not exist: ${videoPath}`,
      };
    }

    const ffmpegPath = FfmpegResolver.findFfmpeg();
    if (!ffmpegPath) {
      log.warn('gemini_post_process', 'FFmpeg binary not resolved; skipping watermark removal.');
      return {
        success: false,
        cleanVideoPath: videoPath,
        originalVideoPath: videoPath,
        durationMs: 0,
        error: 'FFmpeg binary not found on system',
      };
    }

    // Run multi-tier watermark detection
    const detection = await GeminiWatermarkDetector.detect(videoPath, {
      ratio: options.ratio,
      width: options.width,
      height: options.height,
      officialOptOut: options.officialOptOut,
    });

    if (!detection.detected) {
      log.info('gemini_post_process', `Watermark not detected on ${videoPath} (${detection.method}); skipping processing to preserve pristine source.`);
      return {
        success: true,
        cleanVideoPath: videoPath,
        originalVideoPath: videoPath,
        durationMs: Date.now() - startTime,
        watermarkCleaned: false,
        detectionMethod: detection.method,
      };
    }

    const dir = path.dirname(videoPath);
    const ext = path.extname(videoPath);
    const base = path.basename(videoPath, ext);

    const originalBackupPath = path.join(dir, `${base}_original${ext}`);
    const tempCleanPath = outputCleanPath || path.join(dir, `${base}_clean_tmp${ext}`);
    const targetCleanPath = outputCleanPath || videoPath;

    const bbox = detection.boundingBox;
    const timeoutMs = options.timeoutMs || 45000;
    const width = detection.videoDimensions.width;
    const height = detection.videoDimensions.height;
    const variant = detection.variant ?? (width >= 1080 && height >= 1080 ? '96' : '48');
    const alphaGain = detection.alphaGain ?? 0.60;
    const x0 = detection.exactCoordinates?.x0 ?? (bbox.x + 2);
    const y0 = detection.exactCoordinates?.y0 ?? (bbox.y + 2);

    let reconstructionMethod: 'reverse_alpha_blending' | 'reverse_alpha_alternate_variant' = 'reverse_alpha_blending';
    let reverseAlphaSuccess = false;

    log.info('gemini_post_process', `Starting watermark removal on: ${videoPath}`, {
      variant,
      alphaGain,
      x0,
      y0,
      method: detection.method,
      confidence: detection.confidence,
      ratio: options.ratio || '16:9',
    });

    const attemptVideoReconstruction = async (varToTry: '48' | '96'): Promise<boolean> => {
      const maskPath = WatermarkMasks.getMaskPngPath(varToTry);
      const reverseAlphaFilter = `color=c=black:s=${width}x${height}[bg];[bg][1:v]overlay=x=${x0}:y=${y0}:shortest=1[mask];[0:v]format=gbrp[v_rgb];[mask]format=gbrp[m_rgb];[v_rgb][m_rgb]blend=all_expr='if(lte(B,2), A, clip(255*(A-B*${alphaGain.toFixed(2)})/(255-B*${alphaGain.toFixed(2)}), 0, 255))':shortest=1[clean];[clean]format=yuv420p[out]`;

      await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-i', videoPath,
          '-loop', '1',
          '-i', maskPath,
          '-filter_complex', reverseAlphaFilter,
          '-map', '[out]',
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-c:a', 'copy',
          tempCleanPath,
        ],
        { timeout: timeoutMs }
      );

      return fs.existsSync(tempCleanPath) && fs.statSync(tempCleanPath).size > 0;
    };

    try {
      // 1. Primary Method: High-fidelity reverse-alpha blending in planar RGB
      try {
        reverseAlphaSuccess = await attemptVideoReconstruction(variant);
      } catch (primErr) {
        log.warn('gemini_post_process', `Primary reverse-alpha variant (${variant}) failed: ${(primErr as Error).message}`);
      }

      // 2. Secondary Method: Alternate variant retry if primary failed
      if (!reverseAlphaSuccess) {
        const altVariant: '48' | '96' = variant === '48' ? '96' : '48';
        log.info('gemini_post_process', `Attempting alternate reverse-alpha variant (${altVariant})`);
        try {
          reverseAlphaSuccess = await attemptVideoReconstruction(altVariant);
          if (reverseAlphaSuccess) {
            reconstructionMethod = 'reverse_alpha_alternate_variant';
          }
        } catch (altErr) {
          log.warn('gemini_post_process', `Alternate reverse-alpha variant (${altVariant}) also failed: ${(altErr as Error).message}`);
        }
      }

      // Strict Quality Rule: NEVER fall back to delogo/blur. If reverse-alpha fails, surface failure and preserve original.
      if (!reverseAlphaSuccess) {
        throw new Error('Reverse-alpha video reconstruction failed across all calibrated variants; preserving original to prevent blur/smear artifacts');
      }

      // 2. If targetCleanPath is the same as videoPath, archive original first
      if (targetCleanPath === videoPath) {
        if (!fs.existsSync(originalBackupPath)) {
          fs.copyFileSync(videoPath, originalBackupPath);
        }
        // Replace original path with cleaned file
        fs.renameSync(tempCleanPath, videoPath);
      }

      const durationMs = Date.now() - startTime;
      log.info('gemini_post_process', `Watermark removal completed successfully in ${durationMs}ms (${reconstructionMethod})`, {
        cleanVideoPath: targetCleanPath,
        originalVideoPath: originalBackupPath,
        reconstructionMethod,
      });

      return {
        success: true,
        cleanVideoPath: targetCleanPath,
        originalVideoPath: fs.existsSync(originalBackupPath) ? originalBackupPath : videoPath,
        durationMs,
        watermarkCleaned: true,
        detectionMethod: detection.method,
        reconstructionMethod,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;
      log.warn('gemini_post_process', `Watermark removal failed (${durationMs}ms); falling back to original`, {
        error: errorMsg,
      });

      // Cleanup temp clean file if it exists
      if (tempCleanPath !== videoPath && fs.existsSync(tempCleanPath)) {
        try {
          fs.unlinkSync(tempCleanPath);
        } catch {
          // ignore
        }
      }

      return {
        success: false,
        cleanVideoPath: videoPath,
        originalVideoPath: videoPath,
        durationMs,
        watermarkCleaned: false,
        error: errorMsg,
      };
    }
  }
}
