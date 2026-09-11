/**
 * FinalRenderManager – Central orchestrator for Phase 6 Final Video Assembly, Music & Muxing.
 *
 * Responsibilities:
 *  1. Serialized per-project execution using FileMutex to prevent concurrent duplicate renders.
 *  2. Completely isolated from WorkerPool (which manages Chrome profiles for Flow/Gemini).
 *  3. Reuses completed Phase 5 scene clips (renders/scene-XXX.mp4) and Phase 4 audio without regeneration.
 *  4. Safe music handling: non-destructively copies external audio files into projects/{projectId}/music/.
 *  5. Real-time progress lifecycle emissions (queued, preparing, assembling, mixing_audio, muxing, validating, generating_thumbnail, completed, failed, cancelled).
 *  6. Supports real cancellation via AbortController per projectId.
 *  7. Independent retry capability (re-assembles without modifying scene clips).
 *  8. Atomically persists metadata/final_render.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  FinalAssemblyOptions,
  FinalRenderManifest,
  FinalRenderProgressEvent,
  TransitionStyle,
} from '../../shared/types';
import type { SceneClipInfo } from './FinalRenderTypes';
import { FinalAssemblyService } from './FinalAssemblyService';
import { AssetManager } from '../storage/AssetManager';
import { StoryRepository } from '../storage/StoryRepository';
import { fileMutex } from '../storage/FileMutex';
import { generationEventBus } from '../events/GenerationEventBus';
import { AudioDurationMeasurer } from '../tts/AudioDurationMeasurer';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class FinalRenderManager {
  private static activeRenders = new Map<string, AbortController>();

  /**
   * Cancels any active final render job for a project.
   */
  static cancelFinalRender(projectId: string): boolean {
    const controller = this.activeRenders.get(projectId);
    if (controller) {
      controller.abort();
      this.activeRenders.delete(projectId);
      const ev: FinalRenderProgressEvent = {
        projectId,
        status: 'cancelled',
        progressPercent: 0,
        stageMessage: 'Final assembly cancelled by user',
      };
      generationEventBus.emit('final-render:progress' as any, ev);
      logger.info('final_render', `Cancelled final render for project ${projectId}`);
      return true;
    }
    return false;
  }

  /**
   * Subscribes to global final render progress events.
   */
  static onProgress(listener: (ev: FinalRenderProgressEvent) => void): () => void {
    generationEventBus.on('final-render:progress' as any, listener);
    return () => {
      generationEventBus.off('final-render:progress' as any, listener);
    };
  }

  /**
   * Orchestrates the end-to-end final assembly pipeline for a project.
   */
  static async assembleFinalVideo(
    projectId: string,
    options: FinalAssemblyOptions = {}
  ): Promise<FinalRenderManifest> {
    return await fileMutex.runExclusive(`final_render:${projectId}`, async () => {
      if (this.activeRenders.has(projectId)) {
        throw new Error(`Final video assembly is already in progress for project ${projectId}`);
      }

      const abortController = new AbortController();
      this.activeRenders.set(projectId, abortController);

      const dirs = AssetManager.ensureProjectDirectories(projectId);
      const story = await StoryRepository.getStory(projectId);
      const factoryConfig = await StoryRepository.getConfig(projectId);
      const renderManifest = await StoryRepository.getRenderManifest(projectId);

      const emitProgress = (ev: FinalRenderProgressEvent) => {
        generationEventBus.emit('final-render:progress' as any, ev);
      };

      emitProgress({
        projectId,
        status: 'queued',
        progressPercent: 0,
        stageMessage: 'Queued for final assembly',
      });

      try {
        if (abortController.signal.aborted) {
          throw new Error('Final assembly cancelled before start.');
        }

        // 1. Resolve and validate scene clips from Phase 5
        const sceneClips: SceneClipInfo[] = [];

        if (renderManifest && renderManifest.scenes && renderManifest.scenes.length > 0) {
          // Use scenes from completed Phase 5 RenderManifest
          const completedScenes = renderManifest.scenes.filter((s) => s.status === 'completed');
          if (completedScenes.length === 0) {
            throw new Error(
              `Project ${projectId} has a render manifest, but 0 completed scene clips. Please render clips first.`
            );
          }

          for (const s of completedScenes) {
            const videoPath = s.absoluteVideoPath || path.join(dirs.rendersDir, path.basename(s.videoFile));
            if (!fs.existsSync(videoPath)) {
              throw new Error(
                `Scene clip for scene ${s.sceneNumber} not found on disk at: ${videoPath}. Please re-render scene.`
              );
            }

            let dur = s.durationSeconds;
            if (!dur || dur <= 0) {
              dur = await AudioDurationMeasurer.measureDurationSeconds(videoPath);
            }

            sceneClips.push({
              sceneNumber: s.sceneNumber,
              videoPath,
              durationSeconds: Math.max(0.5, dur),
            });
          }
        } else if (story && story.scenes && story.scenes.length > 0) {
          // Check disk directly for renders/scene-001.mp4, scene-002.mp4...
          for (const s of story.scenes) {
            const filename = `scene-${String(s.sceneNumber).padStart(3, '0')}.mp4`;
            const videoPath = path.join(dirs.rendersDir, filename);

            if (!fs.existsSync(videoPath)) {
              throw new Error(
                `Scene clip for scene ${s.sceneNumber} (${filename}) is missing. Please render all scenes in Phase 5 first.`
              );
            }

            const dur = await AudioDurationMeasurer.measureDurationSeconds(videoPath);
            sceneClips.push({
              sceneNumber: s.sceneNumber,
              videoPath,
              durationSeconds: Math.max(0.5, dur),
            });
          }
        } else {
          // Check rendersDir for any scene-XXX.mp4
          const files = fs.readdirSync(dirs.rendersDir).filter((f) => /^scene-\d+\.mp4$/i.test(f));
          if (files.length === 0) {
            throw new Error(
              `No rendered scene clips found for project ${projectId}. Please render scenes in Phase 5 first.`
            );
          }

          files.sort();
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const numMatch = f.match(/scene-(\d+)\.mp4/i);
            const sceneNum = numMatch ? parseInt(numMatch[1], 10) : i + 1;
            const videoPath = path.join(dirs.rendersDir, f);
            const dur = await AudioDurationMeasurer.measureDurationSeconds(videoPath);
            sceneClips.push({
              sceneNumber: sceneNum,
              videoPath,
              durationSeconds: Math.max(0.5, dur),
            });
          }
        }

        sceneClips.sort((a, b) => a.sceneNumber - b.sceneNumber);

        // 2. Resolve background music path safely
        let projectMusicPath: string | undefined = undefined;
        let originalMusicFilename: string | undefined = undefined;

        if (options.musicEnabled !== false && options.musicPath && typeof options.musicPath === 'string') {
          const rawPath = options.musicPath.trim();
          if (rawPath.length > 0 && fs.existsSync(rawPath)) {
            originalMusicFilename = path.basename(rawPath);
            // Check if music is already located in the project's music folder
            const resolvedRaw = path.resolve(rawPath);
            const resolvedMusicDir = path.resolve(dirs.musicDir);

            if (resolvedRaw.startsWith(resolvedMusicDir)) {
              projectMusicPath = resolvedRaw;
            } else {
              // Copy safely into project's music directory (never modify user's original)
              const safeBasename = path.basename(rawPath).replace(/[^a-zA-Z0-9._-]/g, '_');
              const destName = `bgm_${Date.now()}_${safeBasename}`;
              const targetMusicPath = path.join(dirs.musicDir, destName);
              fs.copyFileSync(rawPath, targetMusicPath);
              projectMusicPath = targetMusicPath;
              logger.info('final_render', `Copied external music safely to: ${projectMusicPath}`);
            }
          }
        }

        // 3. Setup output file paths
        const outputVideoPath = AssetManager.getFinalDestinationPath(projectId, 'final.mp4');
        const outputThumbnailPath = AssetManager.getFinalThumbnailDestinationPath(projectId);
        const outputPosterPath = AssetManager.getFinalPosterDestinationPath(projectId);

        const transitionStyle: TransitionStyle =
          options.transitionStyle ?? factoryConfig?.transitionStyle ?? 'hard_cut';

        const assemblyOptions: FinalAssemblyOptions = {
          ...options,
          transitionStyle,
          musicPath: projectMusicPath,
          musicEnabled: Boolean(projectMusicPath && options.musicEnabled !== false),
          musicVolume: typeof options.musicVolume === 'number' ? options.musicVolume : 0.20,
          duckingEnabled: options.duckingEnabled !== false,
          crossfadeDuration: options.crossfadeDuration ?? 0.75,
        };

        // 4. Call FinalAssemblyService
        const result = await FinalAssemblyService.assembleFinalVideo({
          projectId,
          sceneClips,
          outputVideoPath,
          outputThumbnailPath,
          outputPosterPath,
          options: assemblyOptions,
          signal: abortController.signal,
          onProgress: emitProgress,
        });

        // 4b. Check Shorts 2-second thumbnail overlay applicability
        // Invariants:
        //  1. Video must be vertical (height > width from probed result)
        //  2. Mode must not be 'audio_only'
        //  3. Configuration must not have explicitly disabled overlay
        const isVertical = result.height > result.width;
        const isShortsApplicable =
          isVertical &&
          factoryConfig?.mode !== 'audio_only' &&
          options.shortsThumbnailOverlay !== false &&
          factoryConfig?.shortsThumbnailOverlay !== false;

        let finalResult = result;
        if (isShortsApplicable) {
          const thumbPath =
            options.thumbnailOverlayPath ||
            result.thumbnailPath ||
            AssetManager.getFinalThumbnailDestinationPath(projectId) ||
            path.join(dirs.imagesDir, 'thumbnail.png');

          const validThumb = [
            thumbPath,
            path.join(dirs.imagesDir, 'thumbnail.png'),
            path.join(dirs.imagesDir, 'thumbnail.jpg'),
            result.posterPath,
          ].find((p) => p && fs.existsSync(p) && fs.statSync(p).size > 100);

          if (validThumb) {
            emitProgress({
              projectId,
              status: 'assembling',
              progressPercent: 95,
              stageMessage: 'Applying Shorts 2-second thumbnail overlay',
            });
            try {
              finalResult = await FinalAssemblyService.applyShortsThumbnailOverlay({
                sourceVideoPath: outputVideoPath,
                thumbnailPath: validThumb,
                outputVideoPath,
                durationSeconds: options.thumbnailOverlayDurationSeconds ?? 2.0,
                signal: abortController.signal,
              });
              logger.info('final_render', 'Shorts 2-second thumbnail overlay applied successfully', {
                projectId,
                thumb: validThumb,
                duration: finalResult.durationSeconds,
              });
            } catch (overlayErr: any) {
              logger.warn('final_render', `Failed to apply Shorts overlay, preserving base assembled video: ${overlayErr.message}`);
            }
          }
        }

        // Synchronize canonical output to renders/final_video.mp4 for pipeline validator parity
        const rendersFinalMp4 = path.join(dirs.rendersDir, 'final_video.mp4');
        try {
          fs.copyFileSync(outputVideoPath, rendersFinalMp4);
        } catch (copyErr) {
          logger.warn('final_render', `Could not copy final video to rendersDir: ${(copyErr as Error).message}`);
        }

        // 5. Build and save FinalRenderManifest
        const manifest: FinalRenderManifest = {
          projectId,
          status: 'completed',
          videoFile: 'final/final.mp4',
          absoluteVideoPath: outputVideoPath,
          thumbnailFile: finalResult.thumbnailPath ? 'final/final-thumbnail.jpg' : undefined,
          absoluteThumbnailPath: finalResult.thumbnailPath,
          posterFile: finalResult.posterPath ? 'final/final-poster.jpg' : undefined,
          absolutePosterPath: finalResult.posterPath,
          durationSeconds: finalResult.durationSeconds,
          fileSizeBytes: finalResult.fileSizeBytes,
          width: finalResult.width,
          height: finalResult.height,
          fps: finalResult.fps,
          videoCodec: finalResult.videoCodec,
          audioCodec: finalResult.audioCodec,
          musicTrack: result.musicTrack
            ? {
                ...result.musicTrack,
                originalFilename: originalMusicFilename || result.musicTrack.originalFilename,
              }
            : undefined,
          transitionStyle,
          totalScenes: sceneClips.length,
          renderedAt: new Date().toISOString(),
        };

        await StoryRepository.saveFinalRenderManifest(projectId, manifest);

        this.activeRenders.delete(projectId);
        logger.info('final_render', `Successfully completed and verified final render for project ${projectId}`, {
          duration: manifest.durationSeconds,
          fileSize: manifest.fileSizeBytes,
          scenes: manifest.totalScenes,
        });

        return manifest;
      } catch (err: any) {
        this.activeRenders.delete(projectId);

        if (abortController.signal.aborted) {
          const cancelManifest: FinalRenderManifest = {
            projectId,
            status: 'cancelled',
            videoFile: 'final/final.mp4',
            absoluteVideoPath: AssetManager.getFinalDestinationPath(projectId, 'final.mp4'),
            durationSeconds: 0,
            fileSizeBytes: 0,
            width: 0,
            height: 0,
            fps: 0,
            videoCodec: '',
            audioCodec: '',
            transitionStyle: options.transitionStyle ?? 'hard_cut',
            totalScenes: 0,
            renderedAt: new Date().toISOString(),
            error: 'Final video assembly was cancelled.',
          };
          try {
            await StoryRepository.saveFinalRenderManifest(projectId, cancelManifest);
          } catch {}

          emitProgress({
            projectId,
            status: 'cancelled',
            progressPercent: 0,
            stageMessage: 'Final video assembly was cancelled.',
          });

          return cancelManifest;
        }

        const failManifest: FinalRenderManifest = {
          projectId,
          status: 'failed',
          videoFile: 'final/final.mp4',
          absoluteVideoPath: AssetManager.getFinalDestinationPath(projectId, 'final.mp4'),
          durationSeconds: 0,
          fileSizeBytes: 0,
          width: 0,
          height: 0,
          fps: 0,
          videoCodec: '',
          audioCodec: '',
          transitionStyle: options.transitionStyle ?? 'hard_cut',
          totalScenes: 0,
          renderedAt: new Date().toISOString(),
          error: err.message || 'Unknown error during final video assembly',
        };

        try {
          await StoryRepository.saveFinalRenderManifest(projectId, failManifest);
        } catch {}

        emitProgress({
          projectId,
          status: 'failed',
          progressPercent: 0,
          stageMessage: `Assembly failed: ${err.message}`,
          error: err.message,
        });

        logger.error('final_render', `Final video assembly failed for project ${projectId}`, err as Error);
        throw err;
      }
    });
  }
}
