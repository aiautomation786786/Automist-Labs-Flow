/**
 * FinalAssemblyService – Low-level FFmpeg multi-scene assembly, music mixing, and muxing engine.
 *
 * Responsibilities:
 *  1. Assembles scene clips in strict sequence via Hard Cut (concat) or Cross Fade (xfade/acrossfade).
 *  2. Integrates optional looped background music, trimming, outro fade, and sidechain ducking.
 *  3. Encodes compliant MP4 (H.264 + AAC) with -movflags +faststart.
 *  4. Extracts deterministic final-thumbnail.jpg and final-poster.jpg.
 *  5. Validates final output with ffprobe before declaring success.
 *  6. Supports native cancellation via AbortSignal and cleans temporary files on abort/failure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type {
  FinalAssemblyServiceParams,
  FinalAssemblyServiceResult,
  FinalVideoProbeResult,
} from './FinalRenderTypes';
import { FinalAudioMixer } from './FinalAudioMixer';
import { SceneRenderer } from './SceneRenderer';
import { AudioDurationMeasurer } from '../tts/AudioDurationMeasurer';
import { AppLogger } from '../utils/AppLogger';
import { toEven } from './RenderDimensions';
import { FfmpegProgressParser, mapFfmpegErrorMessage } from './FfmpegProgressParser';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export class FinalAssemblyService {
  /**
   * Validates final MP4 video using ffprobe.
   */
  static async validateFinalVideo(videoPath: string): Promise<FinalVideoProbeResult> {
    if (!fs.existsSync(videoPath)) {
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        audioCodec: '',
        error: `Final video file does not exist on disk: ${videoPath}`,
      };
    }

    const stat = fs.statSync(videoPath);
    if (stat.size < 2000) {
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: stat.size,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        audioCodec: '',
        error: `Final video file is too small (${stat.size} bytes).`,
      };
    }

    const ffprobeBin = AudioDurationMeasurer.getFfprobePath() || 'ffprobe';

    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,duration',
          '-of',
          'json',
          videoPath,
        ],
        { timeout: 10000 }
      );

      const probe = JSON.parse(stdout);
      const streams = probe.streams || [];
      const videoStream = streams.find((s: any) => s.codec_type === 'video');
      const audioStream = streams.find((s: any) => s.codec_type === 'audio');

      if (!videoStream) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          width: 0,
          height: 0,
          fps: 0,
          videoCodec: '',
          audioCodec: '',
          error: 'Final video is missing a video stream.',
        };
      }

      if (!audioStream) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          width: 0,
          height: 0,
          fps: 0,
          videoCodec: '',
          audioCodec: '',
          error: 'Final video is missing an audio stream.',
        };
      }

      const formatDuration = parseFloat(probe.format?.duration || '0');
      const videoDuration = parseFloat(videoStream.duration || '0');
      const audioDuration = parseFloat(audioStream.duration || '0');
      const duration = Math.max(formatDuration, Math.max(videoDuration, audioDuration));

      if (duration <= 0.1) {
        return {
          valid: false,
          durationSeconds: duration,
          fileSizeBytes: stat.size,
          width: 0,
          height: 0,
          fps: 0,
          videoCodec: videoStream.codec_name || '',
          audioCodec: audioStream.codec_name || '',
          error: `Final video duration is invalid (${duration}s).`,
        };
      }

      let fps = 30;
      if (videoStream.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/');
        if (parts.length === 2 && parseFloat(parts[1]) > 0) {
          fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
        }
      }

      return {
        valid: true,
        durationSeconds: duration,
        fileSizeBytes: stat.size,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps,
        videoCodec: videoStream.codec_name || 'h264',
        audioCodec: audioStream.codec_name || 'aac',
      };
    } catch (err: any) {
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: stat.size,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        audioCodec: '',
        error: `ffprobe failed to inspect final video: ${err.message}`,
      };
    }
  }

  /**
   * Extracts a thumbnail frame from the final video.
   */
  static async extractFrame(
    videoPath: string,
    outputPath: string,
    timestampSeconds = 1.0
  ): Promise<{ success: boolean; outputPath: string; error?: string }> {
    const ffmpegBin = SceneRenderer.getFfmpegPath();
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const ssStr = `00:00:${timestampSeconds.toFixed(3).padStart(6, '0')}`;

    try {
      await execFileAsync(
        ffmpegBin,
        [
          '-y',
          '-ss',
          ssStr,
          '-i',
          videoPath,
          '-vframes',
          '1',
          '-q:v',
          '2',
          outputPath,
        ],
        { timeout: 8000 }
      );

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 500) {
        throw new Error(`Extracted frame at ${outputPath} is missing or too small.`);
      }

      return { success: true, outputPath };
    } catch (err: any) {
      logger.error('assembly', `Failed to extract frame at ${timestampSeconds}s`, err as Error);
      return { success: false, outputPath, error: err.message };
    }
  }

  /**
   * Checks if a video file has an audio stream.
   */
  static async hasAudioStream(filePath: string): Promise<boolean> {
    const ffprobeBin = AudioDurationMeasurer.getFfprobePath() || 'ffprobe';
    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        [
          '-v',
          'error',
          '-select_streams',
          'a',
          '-show_entries',
          'stream=index',
          '-of',
          'csv=p=0',
          filePath,
        ],
        { timeout: 5000 }
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Executes the full final video assembly pipeline.
   */
  static async assembleFinalVideo(params: FinalAssemblyServiceParams): Promise<FinalAssemblyServiceResult> {
    const {
      projectId,
      sceneClips,
      outputVideoPath,
      outputThumbnailPath,
      outputPosterPath,
      options = {},
      signal,
      onProgress,
    } = params;

    if (signal?.aborted) {
      throw new Error('Final render cancelled before assembly started.');
    }

    if (!sceneClips || sceneClips.length === 0) {
      throw new Error(`Cannot assemble final video: project ${projectId} has no scene clips.`);
    }

    // Sort scene clips strictly in ascending order (1 ... N)
    const sortedScenes = [...sceneClips].sort((a, b) => a.sceneNumber - b.sceneNumber);

    // Validate that all scene clip files exist on disk
    for (const scene of sortedScenes) {
      if (!fs.existsSync(scene.videoPath)) {
        throw new Error(`Scene ${scene.sceneNumber} video clip not found at: ${scene.videoPath}`);
      }
      const stat = fs.statSync(scene.videoPath);
      if (stat.size < 1000) {
        throw new Error(`Scene ${scene.sceneNumber} video clip is corrupt or empty (${stat.size} bytes).`);
      }
    }

    const outputDir = path.dirname(outputVideoPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const tempOutput = `${outputVideoPath}.tmp.${Date.now()}.${Math.floor(Math.random() * 10000)}.mp4`;
    const ffmpegBin = SceneRenderer.getFfmpegPath();
    const transitionStyle = options.transitionStyle ?? 'hard_cut';
    const numScenes = sortedScenes.length;

    onProgress?.({
      projectId,
      status: 'preparing',
      progressPercent: 5,
      stageMessage: `Preparing assembly of ${numScenes} scene(s) with ${transitionStyle} transition`,
    });

    // Compute durations and build filtergraph
    let totalSpeechDuration = 0;
    for (const s of sortedScenes) {
      totalSpeechDuration += s.durationSeconds;
    }

    let filterComplexParts: string[] = [];
    const inputArgs: string[] = [];

    // Add all scene video inputs
    for (const s of sortedScenes) {
      inputArgs.push('-i', s.videoPath);
    }

    if (signal?.aborted) {
      throw new Error(`Final assembly for project ${projectId} was cancelled.`);
    }

    // Inspect each clip to check if audio stream exists and normalize audio pad
    const sceneAudioPads: string[] = [];
    for (let i = 0; i < numScenes; i++) {
      if (signal?.aborted) {
        throw new Error(`Final assembly for project ${projectId} was cancelled.`);
      }
      const s = sortedScenes[i];
      const hasAudio = await this.hasAudioStream(s.videoPath);
      if (hasAudio) {
        filterComplexParts.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a_in_${i}]`);
      } else {
        filterComplexParts.push(`anullsrc=r=44100:cl=stereo,atrim=0:${s.durationSeconds.toFixed(3)}[a_in_${i}]`);
      }
      sceneAudioPads.push(`[a_in_${i}]`);
    }

    let finalVideoPad = '[v_final]';
    let speechAudioPad = '[a_speech]';
    let expectedAssemblyDuration = totalSpeechDuration;

    if (numScenes === 1) {
      // Single scene: direct passthrough via null filter
      filterComplexParts.push('[0:v]null[v_final]');
      finalVideoPad = '[v_final]';
      speechAudioPad = sceneAudioPads[0];
    } else if (transitionStyle === 'cross_fade') {
      // Project-wide cross fade between scenes
      const desiredXfade = Math.min(1.0, Math.max(0.3, options.crossfadeDuration ?? 0.75));
      // Ensure crossfade doesn't exceed half the shortest scene duration
      const minSceneDur = Math.min(...sortedScenes.map((s) => s.durationSeconds));
      const xfadeDur = Math.min(desiredXfade, Math.max(0.25, minSceneDur / 2));

      let lastVPad = '[0:v]';
      let lastAPad = sceneAudioPads[0];
      let cumulativeOffset = 0;

      for (let i = 1; i < numScenes; i++) {
        const prevDuration = sortedScenes[i - 1].durationSeconds;
        cumulativeOffset += (i === 1 ? prevDuration : sortedScenes[i - 1].durationSeconds) - xfadeDur;
        // In cumulative calculation:
        // offset_1 = dur_0 - D
        // offset_2 = (dur_0 + dur_1 - D) - D = dur_0 + dur_1 - 2D
      }

      // Re-calculate precise cumulative offsets
      let currentOffset = 0;
      for (let i = 1; i < numScenes; i++) {
        const prevDur = sortedScenes[i - 1].durationSeconds;
        currentOffset += (i === 1 ? prevDur : prevDur) - xfadeDur;

        // Accurate formula: offset_i is the timestamp in the combined stream where scene i starts fading in
        // For scene 1 into scene 0: offset = dur0 - D
        // For scene 2 into (0+1): offset = (dur0 + dur1 - D) - D
      }

      // Let's accurately build the chain
      let accumulatedDur = sortedScenes[0].durationSeconds;
      for (let i = 1; i < numScenes; i++) {
        const nextV = `[${i}:v]`;
        const nextA = sceneAudioPads[i];
        const outV = i === numScenes - 1 ? '[v_final]' : `[v_xf${i}]`;
        const outA = i === numScenes - 1 ? '[a_speech]' : `[a_xf${i}]`;

        const offset = Math.max(0.1, accumulatedDur - xfadeDur);
        filterComplexParts.push(
          `${lastVPad}${nextV}xfade=transition=fade:duration=${xfadeDur.toFixed(3)}:offset=${offset.toFixed(3)}${outV}`
        );
        filterComplexParts.push(
          `${lastAPad}${nextA}acrossfade=d=${xfadeDur.toFixed(3)}${outA}`
        );

        accumulatedDur = accumulatedDur + sortedScenes[i].durationSeconds - xfadeDur;
        lastVPad = outV;
        lastAPad = outA;
      }

      finalVideoPad = '[v_final]';
      speechAudioPad = '[a_speech]';
      expectedAssemblyDuration = accumulatedDur;
    } else {
      // Hard Cut concatenation
      let concatInputs = '';
      for (let i = 0; i < numScenes; i++) {
        concatInputs += `[${i}:v]${sceneAudioPads[i]}`;
      }
      filterComplexParts.push(
        `${concatInputs}concat=n=${numScenes}:v=1:a=1[v_concat][a_speech]`
      );
      finalVideoPad = '[v_concat]';
      speechAudioPad = '[a_speech]';
      expectedAssemblyDuration = totalSpeechDuration;
    }

    onProgress?.({
      projectId,
      status: 'mixing_audio',
      progressPercent: 25,
      stageMessage: options.musicEnabled && options.musicPath
        ? 'Configuring background music and sidechain ducking'
        : 'Normalizing narration audio',
    });

    // Mix in background music
    const bgmInputIndex = numScenes; // Background music is input N (after scenes 0 ... N-1)
    const audioMixResult = FinalAudioMixer.buildAudioMixFilter({
      speechPad: speechAudioPad,
      bgmInputIndex,
      bgmPath: options.musicPath,
      finalDuration: expectedAssemblyDuration,
      musicEnabled: options.musicEnabled,
      musicVolume: options.musicVolume,
      duckingEnabled: options.duckingEnabled,
      applyLoudnorm: true,
    });

    // Append extra inputs (e.g. ['-stream_loop', '-1', '-i', bgmPath])
    inputArgs.push(...audioMixResult.extraInputArgs);

    // Append audio filter parts
    filterComplexParts.push(...audioMixResult.filterComplexParts);

    // Resolution scaling (4K or 1080p local FFmpeg assembly)
    let assembledVideoPad = finalVideoPad;
    if (options.outputResolution === '4k' || options.outputResolution === '1080p') {
      const isPortrait = options.aspectRatio === '9:16';
      const rawTargetW = options.outputResolution === '4k'
        ? (isPortrait ? 2160 : 3840)
        : (isPortrait ? 1080 : 1920);
      const rawTargetH = options.outputResolution === '4k'
        ? (isPortrait ? 3840 : 2160)
        : (isPortrait ? 1920 : 1080);

      const targetW = toEven(rawTargetW);
      const targetH = toEven(rawTargetH);

      const scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      filterComplexParts.push(`${assembledVideoPad}${scaleFilter}[v_scaled]`);
      assembledVideoPad = '[v_scaled]';
    }

    const fullFilterComplex = filterComplexParts.join(';');
    const finalAudioPad = audioMixResult.outputAudioPad;

    onProgress?.({
      projectId,
      status: 'muxing',
      progressPercent: 40,
      stageMessage: 'Rendering and muxing final broadcast MP4',
    });

    const ffmpegArgs = [
      '-y',
      '-nostdin',
      '-progress', 'pipe:1',
      ...inputArgs,
      '-filter_complex',
      fullFilterComplex,
      '-map',
      assembledVideoPad,
      '-map',
      finalAudioPad,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      tempOutput,
    ];

    logger.info('assembly', `Assembling final video for project ${projectId}`, {
      numScenes,
      transitionStyle,
      expectedDuration: expectedAssemblyDuration,
      hasBgm: Boolean(options.musicEnabled && options.musicPath),
    });

    // Execute FFmpeg child process with cancellation, watchdog, and progress parsing
    const watchdogTimeoutMs = options.watchdogTimeoutMs ?? 600_000;
    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      let watchdogTimer: NodeJS.Timeout | null = null;
      const child = spawn(ffmpegBin, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const progressParser = new FfmpegProgressParser((data) => {
        if (data.progress === 'end') {
          onProgress?.({
            projectId,
            status: 'muxing',
            progressPercent: 74,
            stageMessage: 'Encoding complete, finalizing container...',
          });
          return;
        }

        if (typeof data.outTimeSec === 'number' && expectedAssemblyDuration > 0) {
          const rawRatio = Math.min(1.0, Math.max(0.0, data.outTimeSec / expectedAssemblyDuration));
          const muxPercent = Math.min(74, 40 + Math.round(rawRatio * 34));
          onProgress?.({
            projectId,
            status: 'muxing',
            progressPercent: muxPercent,
            stageMessage: `Rendering final broadcast MP4 (${Math.round(rawRatio * 100)}% - ${data.outTimeSec.toFixed(1)}s / ${expectedAssemblyDuration.toFixed(1)}s)`,
          });
        } else if (typeof data.outTimeSec === 'number') {
          onProgress?.({
            projectId,
            status: 'muxing',
            progressPercent: 40,
            stageMessage: `Rendering final broadcast MP4 (${data.outTimeSec.toFixed(1)}s encoded)...`,
          });
        }
      });

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          progressParser.feed(chunk);
        });
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
        logger.error('assembly', `Final assembly watchdog triggered after ${watchdogTimeoutMs}ms for project ${projectId}. Terminating process.`);
        cleanup();
        try {
          child.kill('SIGKILL');
        } catch {}
        reject(new Error(`Final assembly timed out after ${watchdogTimeoutMs}ms (watchdog triggered).`));
      }, watchdogTimeoutMs);

      if (signal) {
        if (signal.aborted) {
          cleanup();
          try { child.kill('SIGKILL'); } catch {}
          reject(new Error(`Final assembly for project ${projectId} was cancelled.`));
          return;
        }
        signal.addEventListener('abort', () => {
          cleanup();
          try { child.kill('SIGKILL'); } catch {}
          reject(new Error(`Final assembly for project ${projectId} was cancelled.`));
        });
      }

      child.on('error', (err) => {
        cleanup();
        reject(new Error(`FFmpeg spawn error during final assembly: ${err.message}`));
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
          const tailErr = stderrOutput.slice(-500);
          logger.error('assembly', `Final assembly FFmpeg process exited with code ${code}`, { stderr: tailErr });
          const userMessage = mapFfmpegErrorMessage(code, tailErr, 'Final assembly rendering failed');
          reject(new Error(userMessage));
        }
      });
    });

    onProgress?.({
      projectId,
      status: 'validating',
      progressPercent: 75,
      stageMessage: 'Validating final video with ffprobe',
    });

    // Validate the rendered file with ffprobe
    const probeResult = await this.validateFinalVideo(tempOutput);
    if (!probeResult.valid) {
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch {}
      }
      throw new Error(`Final video validation failed: ${probeResult.error}`);
    }

    // Atomically move temp output to final destination
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        fs.renameSync(tempOutput, outputVideoPath);
        break;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
          await new Promise((r) => setTimeout(r, attempt * 50));
        } else {
          try {
            fs.copyFileSync(tempOutput, outputVideoPath);
            fs.unlinkSync(tempOutput);
            break;
          } catch {
            if (fs.existsSync(tempOutput)) {
              try { fs.unlinkSync(tempOutput); } catch {}
            }
            throw err;
          }
        }
      }
    }

    onProgress?.({
      projectId,
      status: 'generating_thumbnail',
      progressPercent: 90,
      stageMessage: 'Generating final video thumbnail and poster',
    });

    // Extract frame at 1.0s or midpoint if video is shorter than 1.0s
    const frameTime = probeResult.durationSeconds >= 1.0 ? 1.0 : Math.max(0.1, probeResult.durationSeconds / 2);

    let thumbnailSuccess = false;
    let posterSuccess = false;

    if (outputThumbnailPath) {
      const tRes = await this.extractFrame(outputVideoPath, outputThumbnailPath, frameTime);
      thumbnailSuccess = tRes.success;
    }

    if (outputPosterPath) {
      const pRes = await this.extractFrame(outputVideoPath, outputPosterPath, frameTime);
      posterSuccess = pRes.success;
    }

    const finalStat = fs.statSync(outputVideoPath);

    onProgress?.({
      projectId,
      status: 'completed',
      progressPercent: 100,
      stageMessage: 'Final video assembly complete and verified',
    });

    return {
      success: true,
      outputVideoPath,
      thumbnailPath: thumbnailSuccess ? outputThumbnailPath : undefined,
      posterPath: posterSuccess ? outputPosterPath : undefined,
      durationSeconds: probeResult.durationSeconds,
      fileSizeBytes: finalStat.size,
      width: probeResult.width,
      height: probeResult.height,
      fps: probeResult.fps,
      videoCodec: probeResult.videoCodec,
      audioCodec: probeResult.audioCodec,
      musicTrack: audioMixResult.musicTrackMetadata,
    };
  }

  /**
   * Applies a 2-second thumbnail overlay to the beginning of a vertical Shorts video.
   *
   * REQUIREMENTS:
   *  1. 0.0s -> 2.0s: thumbnail/poster visual.
   *  2. 2.0s onward: normal video.
   *  3. Preserves continuous audio from 0.0s without interruption or disappearance.
   *  4. Normalizes dimensions, fps, and yuv420p pixel format.
   *  5. Strictly vertical (9:16) short-form; rejects horizontal Longs videos.
   *  6. Encodes compliant H.264/AAC MP4 with faststart.
   *  7. Atomic file operation: never destroys or corrupts the canonical source video.
   */
  static async applyShortsThumbnailOverlay(params: {
    sourceVideoPath: string;
    thumbnailPath: string;
    outputVideoPath: string;
    durationSeconds?: number;
    signal?: AbortSignal;
  }): Promise<FinalAssemblyServiceResult> {
    const { sourceVideoPath, thumbnailPath, outputVideoPath, durationSeconds = 2.0, signal } = params;

    if (signal?.aborted) {
      throw new Error('Shorts thumbnail overlay cancelled before start.');
    }

    if (!fs.existsSync(sourceVideoPath)) {
      throw new Error(`Source video not found on disk: ${sourceVideoPath}`);
    }
    if (!fs.existsSync(thumbnailPath)) {
      throw new Error(`Thumbnail image not found on disk: ${thumbnailPath}`);
    }

    const sourceStat = fs.statSync(sourceVideoPath);
    if (sourceStat.size < 1000) {
      throw new Error(`Source video is too small or corrupt (${sourceStat.size} bytes).`);
    }

    const thumbStat = fs.statSync(thumbnailPath);
    if (thumbStat.size < 100) {
      throw new Error(`Thumbnail image is too small or corrupt (${thumbStat.size} bytes).`);
    }

    // Inspect source video with ffprobe
    const probe = await this.validateFinalVideo(sourceVideoPath);
    if (!probe.valid) {
      throw new Error(`Cannot apply Shorts thumbnail overlay: invalid source video: ${probe.error}`);
    }

    // Must be vertical format (height > width)
    if (probe.width >= probe.height) {
      throw new Error(
        `Shorts thumbnail overlay only applies to vertical (9:16) video. Provided video is horizontal (${probe.width}x${probe.height}).`
      );
    }

    const width = toEven(probe.width || 1080);
    const height = toEven(probe.height || 1920);
    const fps = probe.fps || 30;
    const overlayDuration = Math.min(durationSeconds, probe.durationSeconds);

    const outputDir = path.dirname(outputVideoPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const tempOutput = `${outputVideoPath}.shorts_overlay.tmp.${Date.now()}.${Math.floor(Math.random() * 10000)}.mp4`;
    const ffmpegBin = SceneRenderer.getFfmpegPath();

    // Scale thumbnail to exact video dimensions and frame rate with pad & pixel format
    const filterComplex = [
      `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[th]`,
      `[0:v][th]overlay=enable='between(t,0,${overlayDuration.toFixed(3)})':eof_action=pass[v]`,
    ].join(';');

    const hasAudio = Boolean(probe.audioCodec && probe.audioCodec !== 'none');
    const ffmpegArgs = [
      '-y',
      '-nostdin',
      '-progress', 'pipe:1',
      '-i', sourceVideoPath,
      '-loop', '1',
      '-t', overlayDuration.toFixed(3),
      '-i', thumbnailPath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      ...(hasAudio ? ['-map', '0:a', '-c:a', 'aac', '-b:a', '192k', '-ac', '2'] : []),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      tempOutput,
    ];

    logger.info('assembly', 'Applying Shorts 2-second thumbnail overlay', {
      sourceVideoPath,
      thumbnailPath,
      overlayDuration,
      dimensions: `${width}x${height}`,
      hasAudio,
    });

    const watchdogTimeoutMs = (params as any).watchdogTimeoutMs ?? 300_000;
    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      let watchdogTimer: NodeJS.Timeout | null = null;
      const child = spawn(ffmpegBin, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const progressParser = new FfmpegProgressParser((_data) => {
        // Progress parsing available if needed
      });

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          progressParser.feed(chunk);
        });
      }

      let stderrOutput = '';
      child.stderr.on('data', (d) => {
        stderrOutput += d.toString();
      });

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
        logger.error('assembly', `Shorts overlay watchdog triggered after ${watchdogTimeoutMs}ms. Terminating process.`);
        cleanup();
        try {
          child.kill('SIGKILL');
        } catch {}
        reject(new Error(`Shorts overlay timed out after ${watchdogTimeoutMs}ms (watchdog triggered).`));
      }, watchdogTimeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          try { child.kill('SIGKILL'); } catch {}
          reject(new Error('Shorts thumbnail overlay was cancelled.'));
        });
      }

      child.on('error', (err) => {
        cleanup();
        reject(new Error(`FFmpeg spawn error during Shorts overlay: ${err.message}`));
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
          const tailErr = stderrOutput.slice(-500);
          logger.error('assembly', `Shorts overlay FFmpeg process exited with code ${code}`, { stderr: tailErr });
          const userMessage = mapFfmpegErrorMessage(code, tailErr, 'Shorts thumbnail overlay failed');
          reject(new Error(userMessage));
        }
      });
    });

    // Validate result with ffprobe
    const probeResult = await this.validateFinalVideo(tempOutput);
    if (!probeResult.valid) {
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch {}
      }
      throw new Error(`Shorts overlay video validation failed: ${probeResult.error}`);
    }

    // Replace output file atomically
    try {
      fs.copyFileSync(tempOutput, outputVideoPath);
      fs.unlinkSync(tempOutput);
    } catch (renameErr) {
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch {}
      }
      throw renameErr;
    }

    const finalStat = fs.statSync(outputVideoPath);
    return {
      success: true,
      outputVideoPath,
      thumbnailPath,
      durationSeconds: probeResult.durationSeconds,
      fileSizeBytes: finalStat.size,
      width: probeResult.width,
      height: probeResult.height,
      fps: probeResult.fps,
      videoCodec: probeResult.videoCodec,
      audioCodec: probeResult.audioCodec,
    };
  }
}

