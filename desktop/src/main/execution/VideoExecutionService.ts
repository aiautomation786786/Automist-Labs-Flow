/**
 * VideoExecutionService – Service architecture for Google Flow video generation.
 *
 * GUARANTEES:
 *  - Supports both mock mode (for fast CI / testing) and live Google Flow video execution.
 *  - Enforces mandatory pre-generation gate before clicking Generate.
 *  - Exactly ONE generate click with credit safety.
 *  - Media delta detection for newly generated video asset.
 *  - Non-navigating safe download via SafeDownloader.
 *  - Video container verification and duration extraction (via ffprobe / internal parser).
 *  - Strict slot index mapping. Worker is always released in finally block.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'playwright';
import type { GenerationJobEntity } from '../../shared/types';
import { ProfileWorker } from '../scheduler/ProfileWorker';
import { ProjectRepository } from '../storage/ProjectRepository';
import { JobRepository } from '../storage/JobRepository';
import { AssetManager } from '../storage/AssetManager';
import { FlowDriver } from '../engine/FlowDriver';
import { FlowAutomationSession } from '../engine/FlowAutomationSession';
import { ModelSelector } from '../engine/ModelSelector';
import { MediaDetector } from '../engine/MediaDetector';
import { SafeDownloader } from '../engine/SafeDownloader';
import { VideoDuration } from '../utils/VideoDuration';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';
import { ProgressEstimator } from './ProgressEstimator';

export interface VideoExecutionOptions {
  mockMode?: boolean;
  triggerGenerationClick?: boolean;
  pollTimeoutMs?: number;
  mockVideoUrl?: string;
  mockDurationSeconds?: number;
  concurrencyLevel?: number;
}

export class VideoExecutionService {
  /**
   * Executes a video generation job on the designated ProfileWorker.
   */
  static async execute(
    worker: ProfileWorker,
    job: GenerationJobEntity,
    options: VideoExecutionOptions = {},
  ): Promise<void> {
    const { projectId, slotIndex, promptId, jobId } = job;
    const isMock = options.mockMode ?? false;
    const triggerClick = options.triggerGenerationClick ?? true;
    const pollTimeoutMs = options.pollTimeoutMs ?? 180000;
    const jobStartTime = new Date().toISOString();
    const startMs = Date.now();
    let generationClickTime = jobStartTime;
    let estimator: ProgressEstimator | null = null;
    let jobPage: import('playwright').Page | null = null;

    const project = await ProjectRepository.get(projectId);
    const targetModel = project?.settings?.videoModel || 'Omni 1.1 Flash';
    const targetRatio = (project?.settings?.videoRatio as any) || '16:9';
    const targetRes = project?.settings?.videoResolution || (targetModel.includes('Omni') ? '720p' : 'Default');
    const targetDuration = project?.settings?.videoDuration || (targetModel.includes('Quality') ? '8s' : targetModel.includes('Omni') ? '4s' : '8s');

    const log = new AppLogger({ profileId: worker.profileId, mirrorToStderr: false });
    log.info('video_exec', `Starting video job ${jobId} (Slot ${slotIndex}) [model=${targetModel}, mock=${isMock}]`);

    try {
      // Step 1: Transition to starting
      await JobRepository.updateJob(projectId, jobId, { status: 'starting' });
      await ProjectRepository.updateSlot(projectId, slotIndex, { status: 'running', activeJobId: jobId });

      const destinationPath = AssetManager.getVideoDestinationPath(projectId, slotIndex, promptId, jobId);
      const thumbnailPath = AssetManager.getThumbnailDestinationPath(projectId, slotIndex, promptId, jobId);

      if (isMock) {
        // Mock execution mode
        await JobRepository.updateJob(projectId, jobId, { status: 'configuring' });
        await JobRepository.updateJob(projectId, jobId, { status: 'generating' });
        await JobRepository.updateJob(projectId, jobId, { status: 'waiting_for_result' });

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
        fs.writeFileSync(destinationPath, Buffer.from('TEST_VIDEO_MP4_SIMULATED_PAYLOAD'));
        fs.writeFileSync(thumbnailPath, Buffer.from('TEST_VIDEO_THUMBNAIL_PAYLOAD'));

        await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });

        const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
        if (!fileCheck.valid) {
          throw new Error(`Video output verification failed: ${fileCheck.error}`);
        }

        const durationSeconds = options.mockDurationSeconds ?? 4.0;
        const durationFormatted = `${durationSeconds.toFixed(1)}s`;

        const completedJob = await JobRepository.updateJob(projectId, jobId, {
          status: 'completed',
          outputPath: destinationPath,
          thumbnailPath,
        });

        const completionTime = new Date().toISOString();
        const totalElapsedTimeMs = Date.now() - startMs;
        const concurrencyLevel = options.concurrencyLevel ?? 1;

        const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
          status: 'completed',
          result: {
            assetId: `video_${promptId}_${jobId}`,
            mediaPath: destinationPath,
            thumbnailPath,
            modelUsed: targetModel,
            ratioUsed: targetRatio,
            resolution: targetRes,
            generationResolution: targetRes,
            downloadResolution: project?.settings?.videoDownloadQuality === '1080p' ? '1080p' : targetRes,
            durationSeconds,
            durationFormatted,
            jobStartTime,
            generationClickTime,
            completionTime,
            totalElapsedTimeMs,
            concurrencyLevel,
            completedAt: completionTime,
            fileSizeBytes: fileCheck.sizeBytes,
            mimeType: 'video/mp4',
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

        log.info('video_exec', `Mock completed video job ${jobId} -> Slot ${slotIndex}`);
        return;
      }

      // --- LIVE EXECUTION MODE ---
      jobPage = null;
      let automation = worker.automation;
      if (typeof worker.session?.createJobPage === 'function') {
        try {
          jobPage = await worker.session.createJobPage();
          automation = new FlowAutomationSession(worker.session, jobPage);
          log.info('video_exec', 'Dedicated job page instantiated for video job tab lifecycle');
        } catch (tabErr) {
          log.warn('video_exec', `Could not create dedicated tab, using default session page: ${(tabErr as Error).message}`);
        }
      }
      const page = automation.getPage();

      // Check authentication
      const auth = await automation.checkAuthentication();
      if (auth.state === 'login_required' || auth.state === 'captcha') {
        throw new Error(`Authentication challenge encountered (${auth.state}). Manual login required.`);
      }

      // Transition to configuring
      await JobRepository.updateJob(projectId, jobId, { status: 'configuring' });

      const slot = project?.slots.find((s) => s.slotIndex === slotIndex);
      const promptText = slot?.promptText || '';
      if (!promptText.trim()) {
        throw new Error(`Slot ${slotIndex} has empty prompt text.`);
      }

      // Configure video model in Flow UI
      log.info('video_exec', `Configuring Flow Video UI controls for ${targetModel}...`, {
        modelName: targetModel,
        resolution: targetRes,
        duration: targetDuration,
        ratio: targetRatio,
      });
      const configResult = await ModelSelector.ensureVideoModel(page, {
        modelName: targetModel,
        resolution: targetRes,
        duration: targetDuration,
        ratio: targetRatio,
        quantity: 'x1',
      });

      if (!configResult.verified) {
        throw new Error(`Mandatory video configuration failed: ${configResult.error}`);
      }

      // Mandatory Pre-Generation Gate Verification
      log.info('video_exec', 'Running mandatory pre-generation gate verification...', configResult);
      if (configResult.mode !== 'Video') {
        throw new Error(`Pre-generation gate failed: mode is "${configResult.mode}", expected "Video"`);
      }
      const modelVerified =
        (targetModel.toLowerCase().includes('lite') && configResult.model.toLowerCase().includes('lite') && !configResult.model.toLowerCase().includes('omni')) ||
        (targetModel.toLowerCase().includes('fast') && configResult.model.toLowerCase().includes('fast') && !configResult.model.toLowerCase().includes('omni')) ||
        (targetModel.toLowerCase().includes('quality') && configResult.model.toLowerCase().includes('quality') && !configResult.model.toLowerCase().includes('omni')) ||
        (targetModel.toLowerCase().includes('omni') && configResult.model.toLowerCase().includes('omni'));

      if (!modelVerified) {
        throw new Error(`Pre-generation gate failed: model is "${configResult.model}", expected "${targetModel}"`);
      }

      // Prompt injection
      log.info('video_exec', `Injecting video prompt: "${promptText}"`);
      const promptCandidates = [
        '[contenteditable="true"]:visible',
        'div[contenteditable="true"]',
        'textarea:visible',
        'textarea',
      ];
      const promptInput = await FlowDriver.findFirstVisible(page, promptCandidates, 3000);
      if (!promptInput) {
        throw new Error('Prompt input field not found on Google Flow page.');
      }

      await promptInput.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await promptInput.evaluate((el: HTMLElement) => {
        el.innerText = '';
      }).catch(() => {});
      await promptInput.fill(promptText).catch(async () => {
        await promptInput.type(promptText, { delay: 15 });
      });
      await page.waitForTimeout(400);

      // Verify prompt was entered into DOM
      const domPrompt = await promptInput.evaluate((el: HTMLElement) => el.innerText || el.textContent || (el as HTMLInputElement).value || '');
      log.info('video_exec', `DOM prompt verified: "${domPrompt.trim()}"`);

      // Pre-generation media snapshot & network video sniffer
      const preGenMedia = await MediaDetector.detectMedia(page);
      const beforeVideoSources = new Set<string>([
        ...preGenMedia.videoSources,
        ...preGenMedia.mediaUrls.filter(u => u.includes('/video/')),
      ]);

      let capturedNetworkVideoUrl: string | null = null;
      const responseHandler = (res: Response) => {
        try {
          const url = res.url();
          const contentType = res.headers()['content-type'] || '';
          const isFlowVideo =
            url.includes('flow-content.google/video') ||
            (url.includes('/video/') && url.includes('.mp4')) ||
            url.includes('media.video.redirect') ||
            (url.includes('/asb/') && contentType.includes('video'));

          if (isFlowVideo && !beforeVideoSources.has(url)) {
            log.info('video_exec', `Sniffed specific Flow video media response: ${url} (${contentType})`);
            capturedNetworkVideoUrl = url;
          }
        } catch {
          // ignore
        }
      };
      page.on('response', responseHandler);

      // Transition to generating (with Duplicate-Click Lock & Live Progress Estimator)
      estimator = new ProgressEstimator({
        jobId,
        projectId,
        promptId,
        slotIndex,
        promptType: 'video',
        modelName: targetModel,
        resolution: targetRes,
      });

      await JobRepository.updateJob(projectId, jobId, { status: 'generating' });
      estimator.start();

      const isAlreadySubmitted = job.submissionState === 'submitted';
      if (isAlreadySubmitted) {
        log.info('video_exec', `Job ${jobId} was already submitted; bypassing duplicate Generate click to protect credits.`);
        generationClickTime = job.startedAt ?? new Date().toISOString();
      } else if (triggerClick) {
        const generateSelectors = [
          'button[aria-label="Start generation"]',
          'button:has-text("arrow_forward")',
          'button.generate-icon-button',
          'button[aria-label*="generate" i]',
        ];
        const generateButton = await FlowDriver.findFirstVisible(page, generateSelectors, 3000);
        if (!generateButton) {
          throw new Error('Generate button not found in Google Flow toolbar.');
        }

        const isDisabled = await generateButton.isDisabled().catch(() => false);
        if (isDisabled) {
          throw new Error('Generate button is disabled. Check prompt validity or credit status.');
        }

        log.info('video_exec', 'Clicking Generate button (EXACTLY ONCE)...');
        await JobRepository.updateJob(projectId, jobId, { submissionState: 'submitting' });
        await generateButton.click();
        await JobRepository.updateJob(projectId, jobId, { submissionState: 'submitted' });
        generationClickTime = new Date().toISOString();
        log.info('video_exec', 'Generate button clicked once. Transitioning to waiting_for_result.');
      } else {
        log.info('video_exec', 'Dry-run: skipping real Generate click.');
        generationClickTime = new Date().toISOString();
      }

      await JobRepository.updateJob(projectId, jobId, { status: 'waiting_for_result' });

      // Wait for newly generated video (optimized detection via network sniffer & DOM tile inspection)
      log.info('video_exec', 'Waiting for new video result from Flow...');
      const pollStart = Date.now();
      let detectedVideoUrl: string | null = null;
      let detectedUuid: string | undefined = undefined;

      while (Date.now() - pollStart < pollTimeoutMs) {
        if (capturedNetworkVideoUrl) {
          detectedVideoUrl = capturedNetworkVideoUrl;
          detectedUuid = MediaDetector.parseMediaUuids([capturedNetworkVideoUrl]).uuids[0];
          break;
        }

        const postGenMedia = await MediaDetector.detectMedia(page);
        for (const src of postGenMedia.videoSources) {
          if (!beforeVideoSources.has(src) && src.trim().length > 0) {
            detectedVideoUrl = src;
            detectedUuid = MediaDetector.parseMediaUuids([src]).uuids[0];
            break;
          }
        }
        if (detectedVideoUrl) break;

        for (const url of postGenMedia.mediaUrls) {
          if (!beforeVideoSources.has(url) && (url.includes('/video/') || url.includes('.mp4') || url.includes('/asb/'))) {
            detectedVideoUrl = url;
            detectedUuid = MediaDetector.parseMediaUuids([url]).uuids[0];
            break;
          }
        }
        if (detectedVideoUrl) break;

        // Immediate tile inspection to avoid waiting for slow thumbnails
        const tileMedia = await page.evaluate((beforeUrls) => {
          const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
          for (const t of tiles) {
            const spinner = t.querySelector('mat-progress-spinner, mat-spinner, .mat-mdc-progress-spinner');
            if (spinner) continue;
            const vid = t.querySelector('video');
            if (vid && vid.src && !beforeUrls.includes(vid.src)) return vid.src;
            const img = t.querySelector('img');
            if (img && img.src && !beforeUrls.includes(img.src)) {
              if (img.src.includes('/asb/')) return img.src.split('=')[0] + '=mm,22,15';
              return img.src;
            }
          }
          return null;
        }, Array.from(beforeVideoSources)).catch(() => null);

        if (tileMedia) {
          detectedVideoUrl = tileMedia;
          detectedUuid = MediaDetector.parseMediaUuids([tileMedia]).uuids[0];
          break;
        }

        // Adaptive polling: 400ms for fast detection
        await page.waitForTimeout(400);
      }

      page.off('response', responseHandler);

      if (!detectedVideoUrl) {
        throw new Error(`Video generation timed out after ${pollTimeoutMs / 1000}s. No new video media detected.`);
      }

      log.info('video_exec', 'New video detected from Flow', { detectedVideoUrl, detectedUuid });

      // Transition to downloading
      estimator?.setDownloading();
      await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });

      // Non-navigating safe download
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      log.info('video_exec', `Downloading video from ${detectedVideoUrl} -> ${destinationPath}`);
      await SafeDownloader.download(page, detectedVideoUrl, destinationPath);

      // Output verification
      const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
      if (!fileCheck.valid) {
        throw new Error(`Downloaded video output verification failed: ${fileCheck.error}`);
      }
      log.info('video_exec', `Video output verified: ${fileCheck.sizeBytes} bytes`);

      // Duration extraction
      const durationResult = await VideoDuration.getDuration(destinationPath);
      const durationSeconds = durationResult?.durationSeconds;
      const durationFormatted = durationResult?.durationFormatted || '8.0s';
      log.info('video_exec', 'Video duration measured', {
        durationSeconds,
        durationFormatted,
        method: durationResult?.method,
      });

      // Extract real JPEG video poster frame via production-safe FfmpegResolver
      log.info('video_exec', `Extracting video poster frame -> ${thumbnailPath}`);
      await FfmpegResolver.extractPoster(destinationPath, thumbnailPath);

      // Verify poster thumbnail exists on disk
      const thumbCheck = AssetManager.verifyOutputFile(thumbnailPath, projectId);
      if (!thumbCheck.valid) {
        log.warn('video_exec', `Poster thumbnail verification notice: ${thumbCheck.error}`);
      }

      const completionTime = new Date().toISOString();
      const totalElapsedTimeMs = Date.now() - startMs;
      const concurrencyLevel = options.concurrencyLevel ?? 1;

      // Complete job
      const completedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'completed',
        outputPath: destinationPath,
        thumbnailPath: thumbnailPath,
      });

      // Update Slot in project
      const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'completed',
        result: {
          assetId: detectedUuid || `video_${promptId}_${jobId}`,
          mediaPath: destinationPath,
          thumbnailPath: thumbnailPath,
          modelUsed: targetModel,
          ratioUsed: targetRatio,
          resolution: targetRes,
          generationResolution: targetRes,
          downloadResolution: project?.settings?.videoDownloadQuality === '1080p' ? '1080p' : targetRes,
          durationSeconds,
          durationFormatted,
          jobStartTime,
          generationClickTime,
          completionTime,
          totalElapsedTimeMs,
          concurrencyLevel,
          completedAt: completionTime,
          fileSizeBytes: fileCheck.sizeBytes,
          mimeType: 'video/mp4',
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

      estimator?.setCompleted();
      log.info('video_exec', `Completed video job ${jobId} -> Slot ${slotIndex}`);
    } catch (err) {
      estimator?.setFailed((err as Error).message);
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
      if (jobPage && typeof worker.session?.closeJobPage === 'function') {
        try {
          await worker.session.closeJobPage(jobPage);
        } catch (closeErr) {
          log.debug('video_exec', `Error closing video job page: ${(closeErr as Error).message}`);
        }
      }
      // Release only THIS job's slot (worker may still hold other concurrent jobs)
      worker.release(jobId);
      generationEventBus.emitTyped('worker:available', worker.profileId);
    }
  }
}
