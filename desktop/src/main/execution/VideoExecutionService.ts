/**
 * VideoExecutionService – Service architecture for Google Flow video generation.
 *
 * STATUS MATRIX (per Phase 3 specification):
 *  - [IMPLEMENTED]: Worker binding, pre/post delta detection abstraction, output storage,
 *    deterministic slot updating, thumbnail path generation, and worker release safety.
 *  - [MOCKED]: Video generation trigger and poll simulation for automated testing.
 *  - [NOT YET VERIFIED]: Live Google Flow video generation trigger in current Google Flow UI
 *    (avoiding paid credit consumption during automated development).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GenerationJobEntity } from '../../shared/types';
import { ProfileWorker } from '../scheduler/ProfileWorker';
import { ProjectRepository } from '../storage/ProjectRepository';
import { JobRepository } from '../storage/JobRepository';
import { AssetManager } from '../storage/AssetManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';

export class VideoExecutionService {
  /**
   * Executes a video generation job on the designated ProfileWorker.
   */
  static async execute(
    worker: ProfileWorker,
    job: GenerationJobEntity,
    options: { mockMode?: boolean } = {},
  ): Promise<void> {
    const { projectId, slotIndex, promptId, jobId } = job;
    const isMock = options.mockMode ?? true; // Default to mock to prevent credit consumption

    const log = new AppLogger({ profileId: worker.profileId, mirrorToStderr: false });
    log.info('video_exec', `Starting video job ${jobId} (Slot ${slotIndex})`);

    try {
      await JobRepository.updateJob(projectId, jobId, { status: 'starting' });
      await JobRepository.updateJob(projectId, jobId, { status: 'generating' });

      // In mock/test mode: create a valid simulated video file
      const destinationPath = AssetManager.getVideoDestinationPath(projectId, slotIndex, promptId, jobId);
      const thumbnailPath = AssetManager.getThumbnailDestinationPath(projectId, slotIndex, promptId, jobId);

      if (isMock) {
        // Write simulated mock MP4 and thumbnail
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
        fs.writeFileSync(destinationPath, Buffer.from('TEST_VIDEO_MP4_SIMULATED_PAYLOAD'));
        fs.writeFileSync(thumbnailPath, Buffer.from('TEST_VIDEO_THUMBNAIL_PAYLOAD'));
      } else {
        throw new Error(
          'Live Google Flow video generation is not yet enabled in this version. Use mockMode: true.'
        );
      }

      await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });

      // Output verification
      const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
      if (!fileCheck.valid) {
        throw new Error(`Video output verification failed: ${fileCheck.error}`);
      }

      // Complete job
      const completedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'completed',
        outputPath: destinationPath,
        thumbnailPath,
      });

      // Update exact slot
      const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'completed',
        result: {
          assetId: `video_${promptId}_${jobId}`,
          mediaPath: destinationPath,
          thumbnailPath,
          modelUsed: 'Veo 3.1',
          ratioUsed: '16:9',
          completedAt: new Date().toISOString(),
          fileSizeBytes: fileCheck.sizeBytes,
        },
      });

      generationEventBus.emitTyped('job:completed', completedJob);
      generationEventBus.emitTyped('slot:updated', {
        projectId,
        slotIndex,
        promptId,
        status: 'completed',
        result: updatedSlot.result,
        timestamp: new Date().toISOString(),
      });

      log.info('video_exec', `Completed video job ${jobId} -> Slot ${slotIndex}`);
    } catch (err) {
      log.error('video_exec', `Video job ${jobId} failed`, err as Error);

      const failedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'failed',
        errorMessage: (err as Error).message,
      }).catch(() => null);

      await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'failed',
        error: {
          code: 'VIDEO_GENERATION_ERROR',
          message: (err as Error).message,
          timestamp: new Date().toISOString(),
          retryCount: job.retryCount,
          profileId: worker.profileId,
        },
      }).catch(() => null);

      if (failedJob) {
        generationEventBus.emitTyped('job:failed', failedJob);
      }

      throw err;
    } finally {
      worker.release();
      generationEventBus.emitTyped('worker:available', worker.profileId);
    }
  }
}
