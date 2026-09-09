/**
 * GeminiPostProcessingService – Production-grade local post-processing watermark pipeline.
 *
 * Responsibilities:
 *  - Automatically detects aspect ratio (16:9 vs 9:16) and calculates the precise
 *    watermark bounding box coordinates for Gemini/Veo generated videos.
 *  - Non-destructively preserves the pristine original downloaded video as `<path>_original.mp4`.
 *  - Executes FFmpeg delogo reconstruction asynchronously in the background via child_process
 *    without blocking the Electron UI thread or Node.js event loop.
 *  - Losslessly copies audio (-c:a copy) and preserves visual clarity (-crf 19 -preset fast).
 *  - Provides resilient error handling: falls back seamlessly to the original video if FFmpeg
 *    is unavailable or fails, ensuring generation jobs never fail due to post-processing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const log = new AppLogger({ mirrorToStderr: false });

export interface WatermarkCleanOptions {
  ratio?: string;         // '16:9' | '9:16'
  width?: number;
  height?: number;
  timeoutMs?: number;     // Defaults to 35000 ms
}

export interface WatermarkCleanResult {
  success: boolean;
  cleanVideoPath: string;
  originalVideoPath: string;
  durationMs: number;
  error?: string;
}

export class GeminiPostProcessingService {
  /**
   * Resolves the delogo bounding box based on aspect ratio and resolution.
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

    const dir = path.dirname(videoPath);
    const ext = path.extname(videoPath);
    const base = path.basename(videoPath, ext);

    const originalBackupPath = path.join(dir, `${base}_original${ext}`);
    const tempCleanPath = outputCleanPath || path.join(dir, `${base}_clean_tmp${ext}`);
    const targetCleanPath = outputCleanPath || videoPath;

    const bbox = this.getWatermarkBoundingBox(options.ratio, options.width, options.height);
    const filterArg = `delogo=x=${bbox.x}:y=${bbox.y}:w=${bbox.w}:h=${bbox.h}`;
    const timeoutMs = options.timeoutMs || 35000;

    log.info('gemini_post_process', `Starting watermark removal on: ${videoPath}`, {
      filter: filterArg,
      ratio: options.ratio || '16:9',
    });

    try {
      // 1. Run FFmpeg to create the cleaned video
      await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-i', videoPath,
          '-vf', filterArg,
          '-c:v', 'libx264',
          '-crf', '19',
          '-preset', 'fast',
          '-c:a', 'copy',
          tempCleanPath,
        ],
        { timeout: timeoutMs }
      );

      // 2. Verify temp output file exists and is non-empty
      if (!fs.existsSync(tempCleanPath) || fs.statSync(tempCleanPath).size === 0) {
        throw new Error('Cleaned video output was not created or has 0 bytes.');
      }

      // 3. If targetCleanPath is the same as videoPath, archive original first
      if (targetCleanPath === videoPath) {
        if (!fs.existsSync(originalBackupPath)) {
          fs.copyFileSync(videoPath, originalBackupPath);
        }
        // Replace original path with cleaned file
        fs.renameSync(tempCleanPath, videoPath);
      }

      const durationMs = Date.now() - startTime;
      log.info('gemini_post_process', `Watermark removal completed successfully in ${durationMs}ms`, {
        cleanVideoPath: targetCleanPath,
        originalVideoPath: originalBackupPath,
      });

      return {
        success: true,
        cleanVideoPath: targetCleanPath,
        originalVideoPath: fs.existsSync(originalBackupPath) ? originalBackupPath : videoPath,
        durationMs,
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
        error: errorMsg,
      };
    }
  }
}
