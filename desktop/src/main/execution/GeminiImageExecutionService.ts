/**
 * GeminiImageExecutionService – Execution engine for Google Gemini Web image generation.
 *
 * GUARANTEES:
 *  - Supports both mock mode (for fast CI / testing) and live Gemini Web execution.
 *  - Dedicated job page per slot; multi-tab isolation.
 *  - Direct natural language aspect ratio directive (16:9, 9:16, 1:1) without hardcoded engine names.
 *  - High-reliability in-browser canvas extraction for blob: / cross-origin image URLs.
 *  - Non-destructive post-processing: preserves raw downloaded original image as `<name>_original.<ext>`.
 *  - Watermark detector verifies presence before altering; skips if clean to preserve pristine source.
 *  - High-performance thumbnail generation via FfmpegResolver.
 *  - Strict slot index mapping. Worker is always released in finally block.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GenerationJobEntity, JobAttemptRecord, SupportedAspectRatio } from '../../shared/types';
import { ProfileWorker } from '../scheduler/ProfileWorker';
import { ProjectRepository } from '../storage/ProjectRepository';
import { JobRepository } from '../storage/JobRepository';
import { AssetManager } from '../storage/AssetManager';
import { GeminiDriver } from '../engine/GeminiDriver';
import { GeminiUIDiscovery } from '../engine/GeminiUIDiscovery';
import { GeminiAuthDetector } from '../engine/GeminiAuthDetector';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';
import { ProgressEstimator } from './ProgressEstimator';
import { GeminiImagePostProcessingService } from './GeminiImagePostProcessingService';

export interface GeminiImageExecutionOptions {
  mockMode?: boolean;
  triggerGenerationClick?: boolean;
  pollTimeoutMs?: number;
  mockImageUrl?: string;
  concurrencyLevel?: number;
}

export class GeminiImageExecutionService {
  /**
   * Executes a Gemini image generation job on the designated ProfileWorker.
   */
  static async execute(
    worker: ProfileWorker,
    job: GenerationJobEntity,
    options: GeminiImageExecutionOptions = {},
  ): Promise<void> {
    const { projectId, slotIndex, promptId, jobId } = job;
    const isMock = options.mockMode ?? false;
    const triggerClick = options.triggerGenerationClick ?? true;
    const pollTimeoutMs = options.pollTimeoutMs ?? 120000;
    const jobStartTime = new Date().toISOString();
    const startMs = Date.now();
    let generationClickTime = jobStartTime;
    let estimator: ProgressEstimator | null = null;
    let jobPage: import('playwright').Page | null = null;

    const project = await ProjectRepository.get(projectId);
    const slot = project?.slots.find((s) => s.slotIndex === slotIndex);
    const targetModel = 'Gemini Without Watermark';
    const targetRatio: SupportedAspectRatio = (job.metadata?.aspectRatio as SupportedAspectRatio) || (project?.settings?.imageRatio as SupportedAspectRatio) || '16:9';

    const log = new AppLogger({ profileId: worker.profileId, mirrorToStderr: false });
    log.info('gemini_image_exec', `Starting Gemini image job ${jobId} (Slot ${slotIndex}) [ratio=${targetRatio}, mock=${isMock}]`);

    const attemptNumber = (job.attempts?.length || 0) + 1;
    const currentAttempt: JobAttemptRecord = {
      profileId: worker.profileId,
      attemptNumber,
      startedAt: jobStartTime,
      submissionState: 'preparing',
      outcome: 'unknown',
    };
    const updatedAttempts: JobAttemptRecord[] = [...(job.attempts || []), currentAttempt];

    try {
      // Step 1: Transition to starting
      await JobRepository.updateJob(projectId, jobId, {
        status: 'starting',
        submissionState: 'preparing',
        attempts: updatedAttempts,
      });
      await ProjectRepository.updateSlot(projectId, slotIndex, { status: 'running', activeJobId: jobId });

      const destinationPath = AssetManager.getImageDestinationPath(projectId, slotIndex, promptId, jobId);
      const thumbnailPath = AssetManager.getThumbnailDestinationPath(projectId, slotIndex, promptId, jobId);

      if (isMock) {
        // Mock execution mode
        currentAttempt.submissionState = 'ready_to_submit';
        await JobRepository.updateJob(projectId, jobId, { status: 'configuring', submissionState: 'ready_to_submit', attempts: updatedAttempts });
        currentAttempt.submissionState = 'submitted';
        await JobRepository.updateJob(projectId, jobId, { status: 'generating', submissionState: 'submitted', attempts: updatedAttempts });
        currentAttempt.submissionState = 'generating';
        await JobRepository.updateJob(projectId, jobId, { status: 'waiting_for_result', submissionState: 'generating', attempts: updatedAttempts });

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
        fs.writeFileSync(destinationPath, Buffer.from('TEST_GEMINI_IMAGE_PNG_SIMULATED_PAYLOAD'));
        fs.writeFileSync(thumbnailPath, Buffer.from('TEST_GEMINI_IMAGE_THUMBNAIL_PAYLOAD'));

        await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });

        const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
        if (!fileCheck.valid) {
          throw new Error(`Image output verification failed: ${fileCheck.error}`);
        }

        currentAttempt.endedAt = new Date().toISOString();
        currentAttempt.submissionState = 'completed';
        currentAttempt.outcome = 'completed';

        const completedJob = await JobRepository.updateJob(projectId, jobId, {
          status: 'completed',
          submissionState: 'completed',
          outputPath: destinationPath,
          thumbnailPath,
          provider: 'gemini',
          attempts: updatedAttempts,
        });

        const completionTime = new Date().toISOString();
        const totalElapsedTimeMs = Date.now() - startMs;
        const concurrencyLevel = options.concurrencyLevel ?? 1;

        const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
          status: 'completed',
          result: {
            assetId: `gemini_image_${promptId}_${jobId}`,
            mediaPath: destinationPath,
            thumbnailPath,
            provider: 'gemini',
            providerModel: 'Gemini Without Watermark',
            modelUsed: targetModel,
            ratioUsed: targetRatio,
            generationResolution: 'Original',
            downloadResolution: project?.settings?.imageDownloadQuality === '2k' ? '2K' : 'Original',
            jobStartTime,
            generationClickTime,
            completionTime,
            totalElapsedTimeMs,
            concurrencyLevel,
            completedAt: completionTime,
            fileSizeBytes: fileCheck.sizeBytes,
            mimeType: 'image/png',
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

        log.info('gemini_image_exec', `Mock completed Gemini image job ${jobId} -> Slot ${slotIndex}`);
        return;
      }

      // --- LIVE EXECUTION MODE ---
      jobPage = null;
      if (typeof worker.session?.createJobPage === 'function') {
        try {
          jobPage = await worker.session.createJobPage('https://gemini.google.com/app');
          log.info('gemini_image_exec', 'Dedicated job page instantiated for Gemini image generation');
        } catch (tabErr) {
          log.warn('gemini_image_exec', `Could not create dedicated tab, using default session page: ${(tabErr as Error).message}`);
        }
      }

      if (!jobPage) {
        throw new Error('Failed to create an isolated job page for Gemini image generation.');
      }

      const page = jobPage;

      // Check authentication
      const auth = await GeminiAuthDetector.checkAuthentication(page);
      if (auth.state === 'login_required' || auth.state === 'captcha') {
        throw new Error(`Authentication challenge encountered (${auth.state}). Manual login required.`);
      }

      // Dismiss onboarding or consent dialogs
      await GeminiUIDiscovery.dismissKnownModals(page);

      // Transition to configuring
      await JobRepository.updateJob(projectId, jobId, { status: 'configuring' });

      const rawPrompt = slot?.promptText || '';
      if (!rawPrompt.trim()) {
        throw new Error(`Slot ${slotIndex} has empty prompt text.`);
      }

      // Format prompt with explicit aspect ratio directive for Gemini
      const promptDirective = targetRatio === '9:16'
        ? `Generate an image in 9:16 aspect ratio: ${rawPrompt.trim()}`
        : (targetRatio as string) === '1:1'
        ? `Generate an image in 1:1 aspect ratio: ${rawPrompt.trim()}`
        : `Generate an image in 16:9 aspect ratio: ${rawPrompt.trim()}`;

      // Snapshot pre-existing images in DOM to prevent matching stale turns
      const beforeImages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map((i) => i.currentSrc || i.src || '');
      }).catch(() => []);

      // Inject prompt into Quill editor
      log.info('gemini_image_exec', `Injecting prompt: "${promptDirective}"`);
      await GeminiDriver.injectPrompt(page, promptDirective);

      // Pre-generation gate passed
      currentAttempt.submissionState = 'ready_to_submit';
      await JobRepository.updateJob(projectId, jobId, {
        submissionState: 'ready_to_submit',
        attempts: updatedAttempts,
      });

      if (!triggerClick) {
        log.info('gemini_image_exec', 'triggerGenerationClick is false; stopping before Send click.');
        return;
      }

      // Single Click Submission
      generationClickTime = new Date().toISOString();
      currentAttempt.submissionState = 'submitting';
      await JobRepository.updateJob(projectId, jobId, {
        status: 'generating',
        submissionState: 'submitting',
        attempts: updatedAttempts,
      });

      estimator = new ProgressEstimator({
        jobId,
        projectId,
        slotIndex,
        promptId,
        promptType: 'image',
        modelName: 'Gemini Without Watermark',
      });
      estimator.start();

      await GeminiDriver.submitGeneration(page);

      currentAttempt.submissionState = 'submitted';
      await JobRepository.updateJob(projectId, jobId, {
        status: 'waiting_for_result',
        submissionState: 'submitted',
        attempts: updatedAttempts,
      });

      // Poll for Completion
      const completionResult = await GeminiDriver.waitForImageCompletion(page, {
        timeoutMs: pollTimeoutMs,
        beforeUrls: beforeImages,
      });

      // Download Image Output
      estimator?.setDownloading('Downloading Gemini image in background...');
      await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });
      await GeminiDriver.downloadImage(page, completionResult.imageUrl, destinationPath);

      // Verify Output File
      const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
      if (!fileCheck.valid) {
        throw new Error(`Image file integrity check failed: ${fileCheck.error}`);
      }

      // Watermark post-processing pipeline
      let cleanImagePath = destinationPath;
      let originalImagePath: string | undefined = undefined;
      let watermarkCleaned = false;

      if (!isMock && GeminiImagePostProcessingService.isAvailable()) {
        try {
          const cleanResult = await GeminiImagePostProcessingService.cleanImageWatermark(destinationPath, undefined, {
            ratio: targetRatio,
            width: completionResult.width,
            height: completionResult.height,
          });
          if (cleanResult.success) {
            cleanImagePath = cleanResult.cleanImagePath;
            originalImagePath = cleanResult.originalImagePath;
            watermarkCleaned = cleanResult.watermarkCleaned;
            log.info('gemini_image_exec', `Watermark post-processing completed: cleaned=${watermarkCleaned} in ${cleanResult.durationMs}ms`);
          }
        } catch (cleanErr) {
          log.warn('gemini_image_exec', `Watermark post-processing fallback: ${(cleanErr as Error).message}`);
        }
      }

      // Generate verified thumbnail from clean image
      await FfmpegResolver.generateImageThumbnail(cleanImagePath, thumbnailPath);

      currentAttempt.endedAt = new Date().toISOString();
      currentAttempt.submissionState = 'completed';
      currentAttempt.outcome = 'completed';

      const completionTime = new Date().toISOString();
      const totalElapsedTimeMs = Date.now() - startMs;
      const concurrencyLevel = options.concurrencyLevel ?? 1;

      const completedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'completed',
        submissionState: 'completed',
        outputPath: cleanImagePath,
        thumbnailPath,
        provider: 'gemini',
        attempts: updatedAttempts,
      });

      const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'completed',
        result: {
          assetId: `gemini_image_${promptId}_${jobId}`,
          mediaPath: cleanImagePath,
          originalMediaPath: originalImagePath !== cleanImagePath ? originalImagePath : undefined,
          watermarkCleaned,
          thumbnailPath,
          provider: 'gemini',
          providerModel: 'Gemini Without Watermark',
          modelUsed: targetModel,
          ratioUsed: targetRatio,
          generationResolution: 'Original',
          downloadResolution: project?.settings?.imageDownloadQuality === '2k' ? '2K' : 'Original',
          jobStartTime,
          generationClickTime,
          completionTime,
          totalElapsedTimeMs,
          concurrencyLevel,
          completedAt: completionTime,
          fileSizeBytes: fileCheck.sizeBytes,
          mimeType: 'image/png',
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
      generationEventBus.emitTyped('media:downloaded', {
        projectId,
        jobId,
        slotIndex,
        filePath: cleanImagePath,
        bytes: fileCheck.sizeBytes,
      });

      log.info('gemini_image_exec', `Completed Gemini image job ${jobId} -> Slot ${slotIndex} in ${totalElapsedTimeMs}ms`);
    } catch (err) {
      const errorMsg = (err as Error).message;
      log.error('gemini_image_exec', `Failed Gemini image job ${jobId}: ${errorMsg}`, err as Error);

      currentAttempt.endedAt = new Date().toISOString();
      currentAttempt.submissionState = 'failed';
      currentAttempt.outcome = 'failed';
      currentAttempt.errorMessage = errorMsg;

      const failedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'failed',
        submissionState: 'failed',
        attempts: updatedAttempts,
      }).catch(() => null);

      await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'failed',
        error: {
          code: errorMsg.includes('SAFETY_BLOCK') ? 'SAFETY_BLOCK' : errorMsg.includes('QUOTA') ? 'QUOTA_EXHAUSTED' : 'GEMINI_ERROR',
          message: errorMsg,
          timestamp: new Date().toISOString(),
          retryCount: job.retryCount,
          profileId: worker.profileId,
        },
      }).catch(() => {});

      if (failedJob) {
        generationEventBus.emitTyped('job:failed', failedJob);
      }

      throw err;
    } finally {
      estimator?.stop();
      if (jobPage && typeof worker.session?.closeJobPage === 'function') {
        try {
          await worker.session.closeJobPage(jobPage);
        } catch {}
      } else if (jobPage) {
        try {
          await jobPage.close();
          log.info('gemini_image_exec', 'Closed dedicated Gemini image job tab');
        } catch {}
      }
      worker.release(jobId);
      generationEventBus.emitTyped('worker:available', worker.profileId);
    }
  }
}
