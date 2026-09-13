/**
 * ImportedMediaRenderer – Thin orchestration layer for transforming imported media.
 *
 * Guarantees:
 *  1. Single Unified FFmpeg Engine: Strictly reuses FfmpegResolver, toEven(), stall watchdog,
 *     -nostdin, -progress pipe:1, cancellation, and mapFfmpegErrorMessage.
 *  2. Single Subtitle Engine: Reuses SubtitleGenerator with Phase 1 resolution scaling and canvas parity.
 *  3. Raw Mode Pass-Through: Uses stream copy (-c copy) when no subtitles or filtering are requested.
 *  4. Strict Validation: Validates final output with FinalAssemblyService.validateFinalVideo before returning.
 *  5. State Parity: Atomically persists metadata/final_render.json for instant UI recognition.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type {
  BurnImportedSubtitlesParams,
  FinalRenderManifest,
  FinalRenderProgressEvent,
} from '../../shared/types';
import { AssetManager } from '../storage/AssetManager';
import { ProjectRepository } from '../storage/ProjectRepository';
import { StoryRepository } from '../storage/StoryRepository';
import { SubtitleGenerator } from './SubtitleGenerator';
import { toEven } from './RenderDimensions';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { FfmpegProgressParser, mapFfmpegErrorMessage } from './FfmpegProgressParser';
import { FinalAssemblyService } from './FinalAssemblyService';
import { AudioTranscriptionService } from '../transcription/AudioTranscriptionService';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class ImportedMediaRenderer {
  /**
   * Renders an imported video either via raw stream copy or by burning styled subtitles.
   */
  static async renderImportedVideo(
    params: BurnImportedSubtitlesParams,
    options: {
      signal?: AbortSignal;
      onProgress?: (percent: number) => void;
      watchdogTimeoutMs?: number;
    } = {}
  ): Promise<FinalRenderManifest> {
    const { projectId, rawModeOnly = false, subtitleStyle, subtitleConfig } = params;

    const project = await ProjectRepository.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found.`);
    }

    if (!project.sourceMedia) {
      throw new Error(`Project ${projectId} has no sourceMedia. Only imported media can use ImportedMediaRenderer.`);
    }

    const projectDir = AssetManager.getProjectDir(projectId);
    const sourceVideoPath = path.join(projectDir, project.sourceMedia.mediaPath);
    if (!fs.existsSync(sourceVideoPath)) {
      throw new Error(`Source video file not found on disk: ${sourceVideoPath}`);
    }

    const ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';
    const watchdogTimeoutMs = options.watchdogTimeoutMs ?? 300_000;
    const signal = options.signal;

    AssetManager.ensureProjectDirectories(projectId);
    const outputVideoPath = AssetManager.getFinalDestinationPath(projectId, 'final.mp4');
    const tempOutput = `${outputVideoPath}.tmp.${Date.now()}.mp4`;

    const emitProgress = (progressPercent: number, stageMessage: string) => {
      options.onProgress?.(progressPercent);
      const ev: FinalRenderProgressEvent = {
        projectId,
        status: 'muxing',
        progressPercent,
        stageMessage,
      };
      generationEventBus.emit('final-render:progress' as any, ev);
    };

    let ffmpegArgs: string[] = [];

    if (rawModeOnly) {
      // 1. Raw Pass-Through: Fast stream copy without re-encoding
      emitProgress(20, 'Preparing raw media pass-through container...');
      ffmpegArgs = [
        '-y',
        '-nostdin',
        '-progress', 'pipe:1',
        '-i', sourceVideoPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        tempOutput,
      ];
    } else {
      // 2. Subtitle Burning: Generate ASS from transcript and burn
      emitProgress(10, 'Resolving transcript and generating styled subtitles...');
      const transcript = project.transcript || (await AudioTranscriptionService.getTranscript(projectId));
      if (!transcript || !transcript.cues || transcript.cues.length === 0) {
        throw new Error('No transcript found for project. Please transcribe the video before burning subtitles.');
      }

      const targetW = toEven(project.sourceMedia.width || 1080);
      const targetH = toEven(project.sourceMedia.height || 1920);
      const isPortrait = targetW < targetH;

      const assPath = path.join(projectDir, 'subtitles', 'imported_subtitles.ass');
      const assDir = path.dirname(assPath);
      if (!fs.existsSync(assDir)) fs.mkdirSync(assDir, { recursive: true });

      // Convert transcript cues to wordTimings for accurate cue synchronisation
      const wordTimings = transcript.cues.map((c) => ({
        word: c.text,
        startMs: c.startMs,
        durationMs: Math.max(50, c.endMs - c.startMs),
      }));

      const fullNarration = transcript.fullText || transcript.cues.map((c) => c.text).join(' ');

      await SubtitleGenerator.writeAssFile({
        narrationText: fullNarration,
        wordTimings,
        durationSeconds: project.sourceMedia.durationSeconds,
        aspectRatio: isPortrait ? '9:16' : '16:9',
        targetWidthPx: targetW,
        targetHeightPx: targetH,
        subtitleStyle: subtitleConfig || subtitleStyle || 'bottom_glass',
        subtitleConfig,
        outputPath: assPath,
      });

      emitProgress(30, 'Burning styled subtitles onto video...');
      const escapedAss = SubtitleGenerator.escapePathForFfmpeg(assPath);

      const hasAudio = project.sourceMedia.hasAudio;
      ffmpegArgs = [
        '-y',
        '-nostdin',
        '-progress', 'pipe:1',
        '-i', sourceVideoPath,
        '-vf', `ass='${escapedAss}'`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '21',
        '-pix_fmt', 'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
        '-movflags', '+faststart',
        tempOutput,
      ];
    }

    // Execute FFmpeg with watchdog, progress parsing, and cancellation
    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      let watchdogTimer: NodeJS.Timeout | null = null;

      const child = spawn(ffmpegBin, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const progressParser = new FfmpegProgressParser((data) => {
        if (data.progress === 'end') {
          emitProgress(95, 'Finalizing broadcast MP4 container...');
          return;
        }
        if (typeof data.outTimeSec === 'number' && project.sourceMedia!.durationSeconds > 0) {
          const ratio = Math.min(1.0, Math.max(0.0, data.outTimeSec / project.sourceMedia!.durationSeconds));
          const pct = Math.min(95, 30 + Math.round(ratio * 65));
          emitProgress(pct, `Processing imported video (${Math.round(ratio * 100)}%)...`);
        }
      });

      if (child.stdout) {
        child.stdout.on('data', (chunk) => progressParser.feed(chunk));
      }

      let stderrOutput = '';
      if (child.stderr) {
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
        logger.error('import_render', `Imported render watchdog triggered after ${watchdogTimeoutMs}ms.`);
        cleanup();
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`Imported video rendering timed out after ${watchdogTimeoutMs}ms (watchdog triggered).`));
      }, watchdogTimeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          try { child.kill('SIGKILL'); } catch {}
          reject(new Error('Imported video rendering was cancelled by user.'));
        });
      }

      child.on('error', (err) => {
        cleanup();
        reject(new Error(`FFmpeg spawn error during imported render: ${err.message}`));
      });

      child.on('close', (code) => {
        if (isDone) return;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        isDone = true;

        if (code === 0) {
          progressParser.flush();
          resolve();
        } else {
          cleanup();
          const tailErr = stderrOutput.slice(-400);
          logger.error('import_render', `FFmpeg process exited with code ${code}`, { stderr: tailErr });
          const userMessage = mapFfmpegErrorMessage(code, tailErr, 'Imported video rendering failed');
          reject(new Error(userMessage));
        }
      });
    });

    // Validate rendered output with ffprobe
    const validation = await FinalAssemblyService.validateFinalVideo(tempOutput);
    if (!validation.valid) {
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch {}
      }
      throw new Error(`Imported render validation failed: ${validation.error}`);
    }

    // Atomic replace
    try {
      if (fs.existsSync(outputVideoPath)) {
        fs.unlinkSync(outputVideoPath);
      }
      fs.renameSync(tempOutput, outputVideoPath);
    } catch {
      fs.copyFileSync(tempOutput, outputVideoPath);
      try { fs.unlinkSync(tempOutput); } catch {}
    }

    const finalStat = fs.statSync(outputVideoPath);
    const manifest: FinalRenderManifest = {
      projectId,
      status: 'completed',
      videoFile: 'final/final.mp4',
      absoluteVideoPath: outputVideoPath,
      durationSeconds: validation.durationSeconds,
      fileSizeBytes: finalStat.size,
      width: validation.width,
      height: validation.height,
      fps: validation.fps,
      videoCodec: validation.videoCodec,
      audioCodec: validation.audioCodec,
      transitionStyle: 'hard_cut',
      totalScenes: 1,
      renderedAt: new Date().toISOString(),
    };

    await StoryRepository.saveFinalRenderManifest(projectId, manifest);

    emitProgress(100, 'Imported video successfully rendered and verified.');
    logger.info('import_render', `Successfully rendered imported video for project ${projectId}`, {
      outputVideoPath,
      duration: manifest.durationSeconds,
      size: manifest.fileSizeBytes,
    });

    return manifest;
  }
}
