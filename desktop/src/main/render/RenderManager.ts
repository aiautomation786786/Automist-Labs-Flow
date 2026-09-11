/**
 * RenderManager – Central orchestrator for Phase 5 Motion & Subtitle clip rendering.
 *
 * Responsibilities:
 *  1. Bounded concurrency rendering queue (default concurrency: 2) to protect CPU/RAM.
 *  2. Completely isolated from WorkerPool (which manages Chrome profiles for Flow/Gemini).
 *  3. Orchestrates multi-scene rendering in strict contiguous order 1..N.
 *  4. Supports single-scene independent rendering and retries (e.g. retry Scene 3 only).
 *  5. Supports real cancellation via AbortController per projectId.
 *  6. Emits progress events (queued, rendering, validating, completed, failed).
 *  7. Persists metadata/render.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  RenderProjectOptions,
  RenderSceneOptions,
  RenderSceneResult,
  RenderManifest,
  RenderProgressEvent,
  MotionStyle,
  TransitionStyle,
  SupportedAspectRatio,
} from './RenderTypes';
import { SceneRenderer } from './SceneRenderer';
import { MotionPlanner, ResolvedSceneMotion, CLIP_RENDER_VERSION } from './MotionPlanner';
import { AssetManager } from '../storage/AssetManager';
import { StoryRepository } from '../storage/StoryRepository';
import { ProjectRepository } from '../storage/ProjectRepository';
import { fileMutex } from '../storage/FileMutex';
import { generationEventBus } from '../events/GenerationEventBus';
import { AudioDurationMeasurer } from '../tts/AudioDurationMeasurer';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export class RenderManager {
  private static activeJobs = new Map<string, { abortController: AbortController }>();
  private static defaultConcurrency = 2;

  /**
   * Sets the max concurrent FFmpeg render operations (1-4).
   */
  static setConcurrency(c: number): void {
    this.defaultConcurrency = Math.max(1, Math.min(4, c));
  }

  /**
   * Cancels any active rendering job for a project.
   */
  static cancelProjectRender(projectId: string): boolean {
    const job = this.activeJobs.get(projectId);
    if (job) {
      job.abortController.abort();
      this.activeJobs.delete(projectId);
      logger.info('render', `Cancelled render job for project ${projectId}`);
      return true;
    }
    return false;
  }

  /**
   * Subscribes to global render progress events.
   */
  static onProgress(listener: (ev: RenderProgressEvent) => void): () => void {
    generationEventBus.on('render:progress' as any, listener);
    return () => {
      generationEventBus.off('render:progress' as any, listener);
    };
  }

  /**
   * Generates a neutral placeholder image if none exists for a scene.
   */
  private static async ensureSceneImage(
    projectId: string,
    sceneNumber: number,
    aspectRatio: SupportedAspectRatio
  ): Promise<string> {
    const projectDir = AssetManager.getProjectDir(projectId);
    const imagesDir = path.join(projectDir, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const paddedNum = String(sceneNumber).padStart(3, '0');
    const placeholderPath = path.join(imagesDir, `scene-${paddedNum}.png`);

    if (fs.existsSync(placeholderPath)) {
      return placeholderPath;
    }

    // Check if slot asset exists in project
    try {
      const project = await ProjectRepository.get(projectId);
      const slotIndex = sceneNumber - 1;
      const slot = project?.slots?.[slotIndex];
      if (slot?.result?.mediaPath && fs.existsSync(slot.result.mediaPath)) {
        return slot.result.mediaPath;
      }
    } catch {}

    // Generate clean dark cinematic background card
    const ffmpegBin = SceneRenderer.getFfmpegPath();
    const dims = aspectRatio === '9:16' ? '720x1280' : '1280x720';
    try {
      await execFileAsync(
        ffmpegBin,
        ['-y', '-f', 'lavfi', '-i', `color=c=0x1a1917:size=${dims}:rate=1`, '-vframes', '1', placeholderPath],
        { timeout: 8000 }
      );
    } catch (err: any) {
      logger.warn('render', `Failed to generate placeholder card with ffmpeg, writing 1x1 png`, { error: err.message });
      // Minimal 1x1 transparent PNG fallback buffer
      const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      fs.writeFileSync(placeholderPath, png1x1);
    }

    return placeholderPath;
  }

  /**
   * Renders a single scene independently (for testing, initial render, or retrying a failed scene).
   */
  static async renderSingleScene(
    projectId: string,
    sceneNumber: number,
    options?: {
      motionEnabled?: boolean;
      motionStyle?: MotionStyle;
      transitionStyle?: TransitionStyle;
      subtitleStyle?: string;
      subtitlesEnabled?: boolean;
      forceRerender?: boolean;
      attempt?: number;
      watchdogTimeoutMs?: number;
      signal?: AbortSignal;
    }
  ): Promise<RenderSceneResult> {
    AssetManager.ensureProjectDirectories(projectId);
    const projectDir = AssetManager.getProjectDir(projectId);
    const rendersDir = path.join(projectDir, 'renders');
    const subtitlesDir = path.join(projectDir, 'subtitles');
    const audioDir = path.join(projectDir, 'audio');

    const story = await StoryRepository.getStory(projectId);
    if (!story || !story.scenes || story.scenes.length === 0) {
      throw new Error(`Cannot render scene: story.json does not exist for project ${projectId}`);
    }

    const scene = story.scenes.find((s) => (s.sceneNumber ?? 0) === sceneNumber) || story.scenes[sceneNumber - 1];
    if (!scene) {
      throw new Error(`Scene ${sceneNumber} not found in project story.`);
    }

    // Load factory config for default settings if not passed
    const config = await StoryRepository.getConfig(projectId);
    const motionEnabled = options?.motionEnabled ?? config?.motionEnabled ?? true;
    const rawMotionStyle = options?.motionStyle ?? config?.motionStyle ?? 'breathe';
    const transitionStyle = options?.transitionStyle ?? config?.transitionStyle ?? 'hard_cut';
    const subtitleStyle = options?.subtitleStyle ?? config?.subtitleStyle ?? 'bottom_glass';
    const subtitlesEnabled = options?.subtitlesEnabled ?? config?.subtitlesEnabled ?? true;
    const aspectRatio: SupportedAspectRatio = config?.aspectRatio ?? '16:9';

    // Resolve motion via MotionPlanner (handles auto, ai_director, concrete styles)
    const sceneIndex = scene.sceneNumber ? scene.sceneNumber - 1 : story.scenes.indexOf(scene);
    const resolvedMotion = MotionPlanner.resolveSceneMotion({
      mode: rawMotionStyle,
      motionEnabled,
      transitionStyle,
      scene,
      sceneIndex: Math.max(0, sceneIndex),
      totalScenes: story.scenes.length,
    });

    // Locate narration audio
    const paddedNum = String(sceneNumber).padStart(3, '0');
    const audioPath = path.join(audioDir, `scene-${paddedNum}.mp3`);
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found for scene ${sceneNumber} at ${audioPath}. Please synthesize voice first.`);
    }

    // Locate or ensure image
    const imagePath = await this.ensureSceneImage(projectId, sceneNumber, aspectRatio);

    // Duration: use measured duration from story or probe audio
    let duration = scene.durationSeconds;
    if (!duration || duration <= 0) {
      duration = await AudioDurationMeasurer.measureDurationSeconds(audioPath);
      scene.durationSeconds = duration;
      await StoryRepository.saveStory(projectId, story);
    }

    // Load audio manifest to check for word timings
    const audioManifest = await StoryRepository.getAudioManifest(projectId);
    const sceneAudioInfo = audioManifest?.scenes?.find((s) => s.sceneNumber === sceneNumber);

    const outputVideoPath = path.join(rendersDir, `scene-${paddedNum}.mp4`);
    const outputAssPath = path.join(subtitlesDir, `scene-${paddedNum}.ass`);

    // Check cache hit before rendering
    const manifest = await StoryRepository.getRenderManifest(projectId);
    const existingClip = manifest?.scenes?.find((s) => s.sceneNumber === sceneNumber);

    if (!options?.forceRerender && existingClip && fs.existsSync(outputVideoPath)) {
      const isCacheValid = MotionPlanner.isClipCacheValid(
        existingClip,
        resolvedMotion.clipMotionKey,
        resolvedMotion.renderVersion
      );
      if (isCacheValid) {
        logger.info('render', `Cache hit for single scene ${sceneNumber}: clip matches key '${resolvedMotion.clipMotionKey}' and v${resolvedMotion.renderVersion}`);
        return existingClip;
      }
    }

    const renderOpts: RenderSceneOptions = {
      projectId,
      sceneNumber,
      imagePath,
      audioPath,
      durationSeconds: duration,
      motionEnabled: resolvedMotion.motionEnabled,
      motionStyle: resolvedMotion.motionStyle,
      transitionStyle: resolvedMotion.transitionStyle,
      clipMotionKey: resolvedMotion.clipMotionKey,
      renderVersion: resolvedMotion.renderVersion,
      subtitleStyle,
      subtitlesEnabled,
      aspectRatio,
      outputVideoPath,
      outputAssPath,
      narrationText: scene.narration,
      wordTimings: sceneAudioInfo?.wordTimings,
      signal: options?.signal,
      attempt: options?.attempt,
      watchdogTimeoutMs: options?.watchdogTimeoutMs,
    };

    const result = await SceneRenderer.renderScene(renderOpts);

    // Update existing manifest if present, or create one
    if (manifest) {
      manifest.clipRenderVersion = CLIP_RENDER_VERSION;
      manifest.clipMotionKeys = manifest.clipMotionKeys || {};
      manifest.clipMotionKeys[sceneNumber] = result.clipMotionKey || resolvedMotion.clipMotionKey;
      const idx = manifest.scenes.findIndex((s) => s.sceneNumber === sceneNumber);
      if (idx >= 0) {
        manifest.scenes[idx] = result;
      } else {
        manifest.scenes.push(result);
        manifest.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
      }
      manifest.renderedScenes = manifest.scenes.filter((s) => s.status === 'completed').length;
      await StoryRepository.saveRenderManifest(projectId, manifest);
    } else {
      const newManifest: RenderManifest = {
        projectId,
        motionStyle: rawMotionStyle,
        transitionStyle,
        subtitleStyle,
        subtitlesEnabled,
        aspectRatio,
        totalScenes: story.scenes.length,
        renderedScenes: 1,
        totalDurationSeconds: result.durationSeconds,
        renderedAt: new Date().toISOString(),
        clipRenderVersion: CLIP_RENDER_VERSION,
        clipMotionKeys: {
          [sceneNumber]: result.clipMotionKey || resolvedMotion.clipMotionKey,
        },
        scenes: [result],
      };
      await StoryRepository.saveRenderManifest(projectId, newManifest);
    }

    return result;
  }

  /**
   * Renders all scene clips for a project with bounded concurrency.
   */
  static async renderProjectClips(
    projectId: string,
    options?: RenderProjectOptions
  ): Promise<RenderManifest> {
    return await fileMutex.runExclusive(`render:${projectId}`, async () => {
      AssetManager.ensureProjectDirectories(projectId);
      const projectDir = AssetManager.getProjectDir(projectId);
      const rendersDir = path.join(projectDir, 'renders');
      const subtitlesDir = path.join(projectDir, 'subtitles');
      const audioDir = path.join(projectDir, 'audio');

      const abortController = new AbortController();
      this.activeJobs.set(projectId, { abortController });

      if (options?.signal) {
        options.signal.addEventListener('abort', () => abortController.abort());
      }

      try {
        const story = await StoryRepository.getStory(projectId);
        if (!story || !story.scenes || story.scenes.length === 0) {
          throw new Error(`Cannot render clips: story.json does not exist or has no scenes for project ${projectId}`);
        }

        const config = await StoryRepository.getConfig(projectId);
        const motionEnabled = options?.motionEnabled ?? config?.motionEnabled ?? true;
        const rawMotionStyle = options?.motionStyle ?? config?.motionStyle ?? 'breathe';
        const transitionStyle = options?.transitionStyle ?? config?.transitionStyle ?? 'hard_cut';
        const subtitleStyle = options?.subtitleStyle ?? config?.subtitleStyle ?? 'bottom_glass';
        const subtitlesEnabled = options?.subtitlesEnabled ?? config?.subtitlesEnabled ?? true;
        const aspectRatio: SupportedAspectRatio = config?.aspectRatio ?? '16:9';
        const forceRerender = options?.forceRerender ?? false;

        const totalScenes = story.scenes.length;
        const sceneResults: RenderSceneResult[] = [];
        let totalDuration = 0;

        // Deterministically resolve motion for every scene upfront with anti-repetition
        const resolvedScenesMotion: ResolvedSceneMotion[] = [];
        let prevMotion: MotionStyle | undefined = undefined;
        for (let i = 0; i < totalScenes; i++) {
          const sc = story.scenes[i]!;
          const resolved = MotionPlanner.resolveSceneMotion({
            mode: rawMotionStyle,
            motionEnabled,
            transitionStyle,
            scene: sc,
            sceneIndex: i,
            totalScenes,
            previousStyle: prevMotion,
          });
          resolvedScenesMotion.push(resolved);
          prevMotion = resolved.motionStyle;
        }

        const existingManifest = await StoryRepository.getRenderManifest(projectId);
        const concurrency = Math.max(1, Math.min(4, options?.concurrency ?? this.defaultConcurrency));

        const emitProgress = (sceneNum: number, status: any, percent: number, err?: string) => {
          const ev: RenderProgressEvent = {
            projectId,
            sceneNumber: sceneNum,
            totalScenes,
            status,
            progressPercent: percent,
            error: err,
          };
          options?.onProgress?.(ev);
          generationEventBus.emit('render:progress' as any, ev);
        };

        const audioManifest = await StoryRepository.getAudioManifest(projectId);

        // Render scenes using a bounded concurrent worker queue
        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(concurrency, totalScenes) }, async () => {
          while (nextIndex < totalScenes) {
            const i = nextIndex++;
            const scene = story.scenes[i]!;
            const sceneNum = scene.sceneNumber ?? i + 1;
            const paddedNum = String(sceneNum).padStart(3, '0');
            const outputVideoPath = path.join(rendersDir, `scene-${paddedNum}.mp4`);
            const outputAssPath = path.join(subtitlesDir, `scene-${paddedNum}.ass`);
            const resolvedMotion = resolvedScenesMotion[i]!;

            emitProgress(sceneNum, 'queued', Math.round((i / totalScenes) * 100));
            if (abortController.signal.aborted) {
              emitProgress(sceneNum, 'cancelled', Math.round((i / totalScenes) * 100));
              sceneResults.push({
                sceneNumber: sceneNum,
                videoFile: '',
                absoluteVideoPath: outputVideoPath,
                durationSeconds: 0,
                fileSizeBytes: 0,
                status: 'cancelled',
                error: 'Render cancelled by user.',
              });
              break;
            }

            // Check cache validity before doing any work
            const existingClip = existingManifest?.scenes?.find((s) => s.sceneNumber === sceneNum);
            if (!forceRerender && existingClip && fs.existsSync(outputVideoPath)) {
              const isCacheValid = MotionPlanner.isClipCacheValid(
                existingClip,
                resolvedMotion.clipMotionKey,
                resolvedMotion.renderVersion
              );
              if (isCacheValid) {
                logger.info('render', `Cache hit for scene ${sceneNum}: valid clip matches key '${resolvedMotion.clipMotionKey}' and v${resolvedMotion.renderVersion}`);
                emitProgress(sceneNum, 'completed', Math.round(((i + 1) / totalScenes) * 100));
                sceneResults.push(existingClip);
                totalDuration += existingClip.durationSeconds;
                continue;
              } else {
                logger.info('render', `Cache invalid for scene ${sceneNum}: expected key '${resolvedMotion.clipMotionKey}' v${resolvedMotion.renderVersion}, existing key '${existingClip.clipMotionKey}' v${existingClip.renderVersion}. Re-rendering clip.`);
              }
            }

            const audioPath = path.join(audioDir, `scene-${paddedNum}.mp3`);
            if (!fs.existsSync(audioPath)) {
              throw new Error(`Audio file missing for scene ${sceneNum} at ${audioPath}`);
            }

            const imagePath = await this.ensureSceneImage(projectId, sceneNum, aspectRatio);
            let duration = scene.durationSeconds;
            if (!duration || duration <= 0) {
              duration = await AudioDurationMeasurer.measureDurationSeconds(audioPath);
              scene.durationSeconds = duration;
            }

            emitProgress(sceneNum, 'rendering', Math.round((i / totalScenes) * 100 + 10));

            try {
              const res = await SceneRenderer.renderScene({
                projectId,
                sceneNumber: sceneNum,
                imagePath,
                audioPath,
                durationSeconds: duration,
                motionEnabled: resolvedMotion.motionEnabled,
                motionStyle: resolvedMotion.motionStyle,
                transitionStyle: resolvedMotion.transitionStyle,
                clipMotionKey: resolvedMotion.clipMotionKey,
                renderVersion: resolvedMotion.renderVersion,
                subtitleStyle,
                subtitlesEnabled,
                aspectRatio,
                outputVideoPath,
                outputAssPath,
                narrationText: scene.narration,
                wordTimings: audioManifest?.scenes?.find((s) => s.sceneNumber === sceneNum)?.wordTimings,
                signal: abortController.signal,
                attempt: options?.attempt,
                watchdogTimeoutMs: options?.watchdogTimeoutMs,
              });

              emitProgress(sceneNum, 'completed', Math.round(((i + 1) / totalScenes) * 100));
              sceneResults.push(res);
              totalDuration += res.durationSeconds;
            } catch (err: any) {
              const isCancelled = abortController.signal.aborted;
              emitProgress(sceneNum, isCancelled ? 'cancelled' : 'failed', Math.round(((i + 1) / totalScenes) * 100), err.message);
              sceneResults.push({
                sceneNumber: sceneNum,
                videoFile: '',
                absoluteVideoPath: outputVideoPath,
                durationSeconds: duration,
                fileSizeBytes: 0,
                status: isCancelled ? 'cancelled' : 'failed',
                error: err.message,
              });
              if (!isCancelled) {
                logger.error('render', `Failed rendering scene ${sceneNum}`, err as Error);
              }
            }
          }
        });

        await Promise.all(workers);

        // Any remaining scenes if aborted
        while (nextIndex < totalScenes) {
          const i = nextIndex++;
          const scene = story.scenes[i]!;
          const sceneNum = scene.sceneNumber ?? i + 1;
          sceneResults.push({
            sceneNumber: sceneNum,
            videoFile: '',
            absoluteVideoPath: '',
            durationSeconds: scene.durationSeconds || 0,
            fileSizeBytes: 0,
            status: 'cancelled',
            error: 'Render cancelled by user.',
          });
        }

        // Sort results to strictly preserve 1..N order
        sceneResults.sort((a, b) => a.sceneNumber - b.sceneNumber);

        // Build manifest with clipRenderVersion and clipMotionKeys
        const clipMotionKeys: Record<number, string> = {};
        for (const res of sceneResults) {
          if (res.clipMotionKey) {
            clipMotionKeys[res.sceneNumber] = res.clipMotionKey;
          }
        }

        // Save metadata/render.json
        const completedCount = sceneResults.filter((s) => s.status === 'completed').length;
        const manifest: RenderManifest = {
          projectId,
          motionStyle: rawMotionStyle,
          transitionStyle,
          subtitleStyle,
          subtitlesEnabled,
          aspectRatio,
          totalScenes,
          renderedScenes: completedCount,
          totalDurationSeconds: Math.round(totalDuration * 100) / 100,
          renderedAt: new Date().toISOString(),
          clipRenderVersion: CLIP_RENDER_VERSION,
          clipMotionKeys,
          scenes: sceneResults,
        };

        await StoryRepository.saveRenderManifest(projectId, manifest);

        logger.info('render', `Project ${projectId} render completed`, {
          totalScenes,
          completedCount,
          totalDuration,
          clipRenderVersion: CLIP_RENDER_VERSION,
        });

        return manifest;
      } finally {
        this.activeJobs.delete(projectId);
      }
    });
  }

  /**
   * Retrieves the render manifest for a project.
   */
  static async getRenderManifest(projectId: string): Promise<RenderManifest | null> {
    return await StoryRepository.getRenderManifest(projectId);
  }
}
