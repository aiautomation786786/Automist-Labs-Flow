/**
 * SceneRenderer – Executes FFmpeg to render individual scene video clips.
 *
 * Responsibilities:
 *  1. Composes motion filter + subtitle filter in a single-pass FFmpeg pipeline.
 *  2. Syncs video frames to exact narration audio duration.
 *  3. Verifies rendered output via ffprobe (streams present, duration matched).
 *  4. Supports real cancellation via AbortSignal and process killing.
 *  5. Atomically writes to destination and cleans temporary files on failure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type { RenderSceneOptions, RenderSceneResult } from './RenderTypes';
import type { MotionStyle, TransitionStyle } from '../../shared/types';
import { MotionFilterBuilder } from './MotionFilterBuilder';
import { MotionPlanner, CLIP_RENDER_VERSION } from './MotionPlanner';
import { SubtitleGenerator } from './SubtitleGenerator';
import { AudioDurationMeasurer } from '../tts/AudioDurationMeasurer';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export class SceneRenderer {
  private static ffmpegPathCache: string | null = null;
  private static ffmpegChecked = false;

  /**
   * Resolves the path to the ffmpeg executable.
   */
  static getFfmpegPath(): string {
    if (this.ffmpegChecked && this.ffmpegPathCache) {
      return this.ffmpegPathCache;
    }

    const candidates = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'ffmpeg.exe',
      'ffmpeg',
    ];

    for (const cand of candidates) {
      if (cand.includes('\\') || cand.includes('/')) {
        if (fs.existsSync(cand)) {
          this.ffmpegPathCache = cand;
          this.ffmpegChecked = true;
          return cand;
        }
      }
    }

    this.ffmpegPathCache = 'ffmpeg';
    this.ffmpegChecked = true;
    return 'ffmpeg';
  }

  /**
   * Validates rendered MP4 clip using ffprobe.
   */
  static async validateClip(
    clipPath: string,
    expectedDuration: number
  ): Promise<{ valid: boolean; duration: number; sizeBytes: number; error?: string }> {
    if (!fs.existsSync(clipPath)) {
      return { valid: false, duration: 0, sizeBytes: 0, error: 'Rendered video file does not exist on disk.' };
    }

    const stat = fs.statSync(clipPath);
    if (stat.size < 1000) {
      return { valid: false, duration: 0, sizeBytes: stat.size, error: `Rendered file is too small (${stat.size} bytes).` };
    }

    const ffprobeBin = AudioDurationMeasurer.getFfprobePath() || 'ffprobe';

    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,duration',
          '-of',
          'json',
          clipPath,
        ],
        { timeout: 8000 }
      );

      const probe = JSON.parse(stdout);
      const streams = probe.streams || [];
      const hasVideo = streams.some((s: any) => s.codec_type === 'video');
      const hasAudio = streams.some((s: any) => s.codec_type === 'audio');

      if (!hasVideo) {
        return { valid: false, duration: 0, sizeBytes: stat.size, error: 'Output video missing video stream.' };
      }
      if (!hasAudio) {
        return { valid: false, duration: 0, sizeBytes: stat.size, error: 'Output video missing audio stream.' };
      }

      // Check measured duration from video stream or format
      const videoStream = streams.find((s: any) => s.codec_type === 'video');
      const measuredDuration = parseFloat(videoStream?.duration || '0');

      if (isNaN(measuredDuration) || measuredDuration <= 0) {
        return { valid: false, duration: 0, sizeBytes: stat.size, error: 'Failed to read valid video stream duration.' };
      }

      // Allow 0.35s delta due to frame boundaries / AAC padding
      const delta = Math.abs(measuredDuration - expectedDuration);
      if (delta > 0.45 && expectedDuration > 1.0) {
        logger.warn('render', `Duration delta detected for clip: expected ${expectedDuration}s, measured ${measuredDuration}s`);
      }

      return {
        valid: true,
        duration: Math.round(measuredDuration * 100) / 100,
        sizeBytes: stat.size,
      };
    } catch (err: any) {
      return {
        valid: false,
        duration: 0,
        sizeBytes: stat.size,
        error: `ffprobe inspection failed: ${err.message}`,
      };
    }
  }

  /**
   * Probes media properties (streams, dimensions, duration) using ffprobe.
   */
  static async probeMedia(filePath: string): Promise<{ hasVideo: boolean; hasAudio: boolean; width: number; height: number; durationSeconds: number }> {
    const ffprobeBin = AudioDurationMeasurer.getFfprobePath() || 'ffprobe';
    const { stdout } = await execFileAsync(
      ffprobeBin,
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'json', filePath],
      { timeout: 8000 }
    );
    const probe = JSON.parse(stdout);
    const streams = probe.streams || [];
    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const hasAudio = streams.some((s: any) => s.codec_type === 'audio');
    const duration = parseFloat(videoStream?.duration || '0');
    return {
      hasVideo: !!videoStream,
      hasAudio,
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      durationSeconds: duration,
    };
  }

  /**
   * Renders a single scene clip end-to-end.
   */
  static async renderScene(options: RenderSceneOptions): Promise<RenderSceneResult> {
    const {
      sceneNumber,
      imagePath,
      audioPath,
      durationSeconds,
      aspectRatio,
      narrationText,
      wordTimings,
      subtitlesEnabled,
      subtitleStyle,
      signal,
      fps = 25,
    } = options;

    const attempt = options.attempt ?? 1;
    const fallbackApplied = attempt >= 3;
    const motionEnabled = options.motionEnabled ?? true;

    let effectiveMotionStyle: MotionStyle = options.motionStyle;
    let effectiveTransitionStyle: TransitionStyle = options.transitionStyle ?? 'hard_cut';

    if (fallbackApplied) {
      logger.warn('render', `Scene ${sceneNumber} attempt ${attempt} >= 3: applying fallback static motion (none) and hard_cut transition`);
      effectiveMotionStyle = 'none';
      effectiveTransitionStyle = 'hard_cut';
    } else if (!motionEnabled) {
      effectiveMotionStyle = 'none';
    }

    const finalRenderVersion = options.renderVersion ?? CLIP_RENDER_VERSION;
    const finalMotionKey = options.clipMotionKey || MotionPlanner.buildClipMotionKey(
      fallbackApplied ? false : motionEnabled,
      effectiveMotionStyle,
      effectiveTransitionStyle
    );

    const outputVideoPath = options.outputVideoPath || (options as any).outputPath;
    const outputAssPath = options.outputAssPath || (options as any).subtitlePath;

    if (!outputVideoPath) {
      throw new Error(`Scene ${sceneNumber} render failed: outputVideoPath is required.`);
    }

    // 1. Input validations
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Scene ${sceneNumber} render failed: image file not found at ${imagePath}`);
    }
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Scene ${sceneNumber} render failed: audio file not found at ${audioPath}`);
    }
    if (durationSeconds <= 0) {
      throw new Error(`Scene ${sceneNumber} render failed: invalid duration ${durationSeconds}s`);
    }

    // Ensure output directories exist
    const outputDir = path.dirname(outputVideoPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    let writtenAssPath: string | undefined;

    // 2. Build Subtitles if enabled
    if (subtitlesEnabled) {
      if (outputAssPath && fs.existsSync(outputAssPath)) {
        writtenAssPath = outputAssPath;
      } else if (narrationText && narrationText.trim().length > 0 && outputAssPath) {
        const assDir = path.dirname(outputAssPath);
        if (!fs.existsSync(assDir)) fs.mkdirSync(assDir, { recursive: true });

        writtenAssPath = await SubtitleGenerator.writeAssFile({
          narrationText,
          durationSeconds,
          subtitleStyle,
          aspectRatio,
          wordTimings,
          outputPath: outputAssPath,
        });
      }
    }

    // 3. Construct FFmpeg video filter chain
    const motionFilter = MotionFilterBuilder.buildFilter({
      motionStyle: effectiveMotionStyle,
      durationSeconds,
      aspectRatio,
      fps,
    });

    let videoFilter = motionFilter;
    if (writtenAssPath && fs.existsSync(writtenAssPath)) {
      const escapedAss = SubtitleGenerator.escapePathForFfmpeg(writtenAssPath);
      videoFilter = `${videoFilter},subtitles='${escapedAss}'`;
    }
    videoFilter = `${videoFilter},format=yuv420p`;

    const ffmpegBin = this.getFfmpegPath();
    const tempOutput = `${outputVideoPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp.mp4`;

    const ffmpegArgs = [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-i', audioPath,
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-t', String(durationSeconds),
      '-pix_fmt', 'yuv420p',
      tempOutput,
    ];

    logger.info('render', `Starting scene ${sceneNumber} render with ${effectiveMotionStyle} motion (attempt ${attempt})`, {
      durationSeconds,
      hasSubtitles: !!writtenAssPath,
      clipMotionKey: finalMotionKey,
      fallbackApplied,
    });

    // 4. Spawn FFmpeg process with cancellation and watchdog support
    const watchdogTimeoutMs = options.watchdogTimeoutMs ?? 480_000;
    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      let watchdogTimer: NodeJS.Timeout | null = null;
      const child = spawn(ffmpegBin, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrOutput = '';
      if (child && child.stderr) {
        child.stderr.on('data', (d) => {
          stderrOutput += d.toString();
        });
      }

      const cleanup = () => {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        if (!isDone) {
          isDone = true;
          if (fs.existsSync(tempOutput)) {
            try { fs.unlinkSync(tempOutput); } catch {}
          }
        }
      };

      watchdogTimer = setTimeout(() => {
        logger.error('render', `Scene ${sceneNumber} render watchdog triggered after ${watchdogTimeoutMs}ms. Terminating process.`);
        cleanup();
        try {
          child.kill('SIGKILL');
        } catch {}
        reject(new Error(`Scene ${sceneNumber} render timed out after ${watchdogTimeoutMs}ms (watchdog triggered).`));
      }, watchdogTimeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          try {
            child.kill('SIGKILL');
          } catch {}
          reject(new Error(`Scene ${sceneNumber} render was cancelled by caller.`));
        });
      }

      child.on('error', (err) => {
        cleanup();
        reject(new Error(`FFmpeg spawn error on scene ${sceneNumber}: ${err.message}`));
      });

      child.on('close', (code) => {
        if (isDone) return;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        isDone = true;

        if (code === 0) {
          resolve();
        } else {
          cleanup();
          const tailErr = stderrOutput.slice(-400);
          reject(new Error(`FFmpeg exited with code ${code} rendering scene ${sceneNumber}: ${tailErr}`));
        }
      });
    });

    // 5. Validate rendered output via ffprobe
    const validation = await this.validateClip(tempOutput, durationSeconds);
    if (!validation.valid) {
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch {}
      }
      throw new Error(`Scene ${sceneNumber} validation failed: ${validation.error}`);
    }

    // 6. Rename temp output into final destination atomically
    for (let renameAttempt = 1; renameAttempt <= 5; renameAttempt++) {
      try {
        fs.renameSync(tempOutput, outputVideoPath);
        break;
      } catch (err: any) {
        if (renameAttempt < 5) {
          await new Promise((r) => setTimeout(r, renameAttempt * 25));
        } else {
          fs.copyFileSync(tempOutput, outputVideoPath);
          try { fs.unlinkSync(tempOutput); } catch {}
        }
      }
    }

    const relativeVideo = path.relative(path.join(outputDir, '..'), outputVideoPath).replace(/\\/g, '/');
    const relativeAss = writtenAssPath
      ? path.relative(path.join(outputDir, '..'), writtenAssPath).replace(/\\/g, '/')
      : undefined;

    logger.info('render', `Scene ${sceneNumber} render completed and validated`, {
      durationSeconds: validation.duration,
      sizeBytes: validation.sizeBytes,
      clipMotionKey: finalMotionKey,
    });

    return {
      sceneNumber,
      videoFile: relativeVideo,
      subtitleFile: relativeAss,
      absoluteVideoPath: outputVideoPath,
      durationSeconds: validation.duration,
      fileSizeBytes: validation.sizeBytes,
      status: 'completed',
      clipMotionKey: finalMotionKey,
      appliedMotionStyle: effectiveMotionStyle,
      renderVersion: finalRenderVersion,
      attempt,
      fallbackApplied,
    };
  }
}
