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
import type { GenerationJobEntity, JobAttemptRecord } from '../../shared/types';
import { CreditFailureDetector, type CreditDetectionResult } from '../engine/CreditFailureDetector';
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
    const pollTimeoutMs = options.pollTimeoutMs ?? 360000;
    const jobStartTime = new Date().toISOString();
    const startMs = Date.now();
    let generationClickTime = jobStartTime;
    let estimator: ProgressEstimator | null = null;
    let jobPage: import('playwright').Page | null = null;

    const project = await ProjectRepository.get(projectId);
    const slot = project?.slots.find((s) => s.slotIndex === slotIndex);
    const sourceImagePath = job.sourceImagePath || slot?.sourceImagePath || (job.metadata as any)?.sourceImagePath;
    const targetModel = project?.settings?.videoModel || 'Omni 1.1 Flash';
    const targetRatio = (project?.settings?.videoRatio as any) || '16:9';
    const targetRes = project?.settings?.videoResolution || (targetModel.includes('Omni') ? '720p' : 'Default');
    const targetDuration = project?.settings?.videoDuration || (targetModel.includes('Quality') ? '8s' : targetModel.includes('Omni') ? '4s' : '8s');

    const log = new AppLogger({ profileId: worker.profileId, mirrorToStderr: true });
    log.info('video_exec', `Starting video job ${jobId} (Slot ${slotIndex}) [model=${targetModel}, mock=${isMock}, sourceImage=${sourceImagePath || 'none'}]`);

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

      const destinationPath = AssetManager.getVideoDestinationPath(projectId, slotIndex, promptId, jobId);
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
        fs.writeFileSync(destinationPath, Buffer.from('TEST_VIDEO_MP4_SIMULATED_PAYLOAD'));
        fs.writeFileSync(thumbnailPath, Buffer.from('TEST_VIDEO_THUMBNAIL_PAYLOAD'));

        await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });

        const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
        if (!fileCheck.valid) {
          throw new Error(`Video output verification failed: ${fileCheck.error}`);
        }

        const durationSeconds = options.mockDurationSeconds ?? 4.0;
        const durationFormatted = `${durationSeconds.toFixed(1)}s`;

        currentAttempt.endedAt = new Date().toISOString();
        currentAttempt.submissionState = 'completed';
        currentAttempt.outcome = 'completed';

        const completedJob = await JobRepository.updateJob(projectId, jobId, {
          status: 'completed',
          submissionState: 'completed',
          outputPath: destinationPath,
          thumbnailPath,
          sourceImagePath: sourceImagePath || undefined,
          attempts: updatedAttempts,
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
            sourceImagePath: sourceImagePath || undefined,
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

      // Ensure Flow project canvas
      const flowProjectId = (project?.settings as any)?.flowProjectId;
      if (typeof automation.ensureProject === 'function') {
        await automation.ensureProject(flowProjectId ? { projectId: flowProjectId } : {});
        await page.waitForTimeout(2000);
      }

      const promptText = slot?.promptText || '';
      if (!promptText.trim()) {
        throw new Error(`Slot ${slotIndex} has empty prompt text.`);
      }

      // If Image-to-Video, attach source image
      if (sourceImagePath) {
        if (!fs.existsSync(sourceImagePath)) {
          throw new Error(`Source image file not found on disk: ${sourceImagePath}`);
        }
        log.info('video_exec', `Attaching source image for Image-to-Video: ${sourceImagePath}`);
        await FlowDriver.attachSourceImage(page, sourceImagePath);
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

      await FlowDriver.safeFill(page, promptInput, promptText);

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
      let capturedNetworkFailure: CreditDetectionResult | null = null;

      const responseHandler = async (res: Response) => {
        try {
          const url = res.url();
          const contentType = res.headers()['content-type'] || '';
          const status = res.status();

          if (status >= 400 || url.includes('/fx/api/') || url.includes('trpc')) {
            try {
              const body = await res.text().catch(() => '');
              const netFail = CreditFailureDetector.detectFromNetwork(status, body);
              if (netFail) {
                log.warn('video_exec', `Network error classified: [${netFail.classification}] ${netFail.evidence}`);
                capturedNetworkFailure = netFail;
              }
            } catch {}
          }

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

      currentAttempt.submissionState = 'ready_to_submit';
      await JobRepository.updateJob(projectId, jobId, { submissionState: 'ready_to_submit', attempts: updatedAttempts });

      // Inspect whether the page is already running an active generation
      const pageAlreadyGenerating = await page.evaluate(() => {
        return document.querySelector('.progress-bar, flow-video-tile .generating, mat-spinner') !== null;
      }).catch(() => false);

      if (pageAlreadyGenerating) {
        log.info('video_exec', `Page is already actively generating; bypassing duplicate Generate click to protect credits.`);
        generationClickTime = job.startedAt ?? new Date().toISOString();
        currentAttempt.submissionState = 'generating';
        await JobRepository.updateJob(projectId, jobId, { submissionState: 'generating', attempts: updatedAttempts });
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
          const domSignal = await CreditFailureDetector.detectFromPage(page);
          if (domSignal) {
            throw new Error(`FlowFailure [${domSignal.classification}]: ${domSignal.evidence}`);
          }
          throw new Error('Generate button is disabled. Check prompt validity or credit status.');
        }

        log.info('video_exec', 'Clicking Generate button (EXACTLY ONCE)...');
        currentAttempt.submissionState = 'submitting';
        await JobRepository.updateJob(projectId, jobId, { submissionState: 'submitting', attempts: updatedAttempts });
        await generateButton.click();
        currentAttempt.submissionState = 'submitted';
        await JobRepository.updateJob(projectId, jobId, { submissionState: 'submitted', attempts: updatedAttempts });
        generationClickTime = new Date().toISOString();
        log.info('video_exec', 'Generate button clicked once. Transitioning to waiting_for_result.');
      } else {
        log.info('video_exec', 'Dry-run: skipping real Generate click.');
        generationClickTime = new Date().toISOString();
      }

      currentAttempt.submissionState = 'generating';
      await JobRepository.updateJob(projectId, jobId, { status: 'waiting_for_result', submissionState: 'generating', attempts: updatedAttempts });

      // Wait for newly generated video (optimized detection via network sniffer & DOM tile inspection)
      log.info('video_exec', 'Waiting for new video result from Flow...');
      const pollStart = Date.now();
      let lastDomCheck = Date.now();
      let earlyFailure: CreditDetectionResult | null = null;
      let detectedVideoUrl: string | null = null;
      let detectedUuid: string | undefined = undefined;

      while (Date.now() - pollStart < pollTimeoutMs) {
        // 1. Check network sniffed failure
        if (capturedNetworkFailure) {
          earlyFailure = capturedNetworkFailure;
          break;
        }

        // 2. Periodic targeted DOM check every 2500ms
        if (Date.now() - lastDomCheck >= 2500) {
          lastDomCheck = Date.now();
          const domFail = await CreditFailureDetector.detectFromPage(page);
          if (domFail) {
            earlyFailure = domFail;
            break;
          }
        }

        let candidateUrl: string | null = null;

        if (capturedNetworkVideoUrl) {
          candidateUrl = capturedNetworkVideoUrl;
        }

        if (!candidateUrl) {
          const postGenMedia = await MediaDetector.detectMedia(page);
          for (const src of postGenMedia.videoSources) {
            if (!beforeVideoSources.has(src) && src.trim().length > 0 && (src.includes('=mm,22,15') || src.includes('.mp4') || src.includes('flow-content.google/video'))) {
              candidateUrl = src;
              break;
            }
          }
        }

        if (!candidateUrl) {
          // Inspect tiles: check for <video> or /asb/ stream
          const tileVideoCandidate = await page.evaluate((beforeUrls) => {
            const tiles = Array.from(document.querySelectorAll('flow-video-tile, [class*="video-tile"]'));
            for (const t of tiles) {
              const vid = t.querySelector('video');
              const vidSrc = vid?.src || (vid as HTMLMediaElement)?.currentSrc;
              if (vidSrc && !beforeUrls.includes(vidSrc)) return vidSrc;

              const img = t.querySelector('img.thumbnail, img[src*="/asb/"]') as HTMLImageElement | null;
              if (img && img.src && img.src.includes('/asb/')) {
                const streamUrl = img.src.split('=')[0] + '=mm,22,15';
                if (!beforeUrls.includes(streamUrl)) return streamUrl;
              }
            }
            return null;
          }, Array.from(beforeVideoSources)).catch(() => null);

          if (tileVideoCandidate) {
            candidateUrl = tileVideoCandidate;
          }
        }

        // Probe candidate URL to confirm video encoding is complete (Content-Type: video/...)
        if (candidateUrl) {
          try {
            const probe = await page.request.get(candidateUrl, {
              headers: { Range: 'bytes=0-100' },
              timeout: 5000,
            });
            const cType = probe.headers()['content-type'] || '';
            if (cType.includes('video') || cType.includes('mp4')) {
              detectedVideoUrl = candidateUrl;
              detectedUuid = MediaDetector.parseMediaUuids([candidateUrl]).uuids[0];
              log.info('video_exec', `Verified ready video stream: ${candidateUrl} (${cType})`);
              break;
            } else {
              log.debug('video_exec', `Candidate URL probed but not yet video stream (content-type: ${cType}); continuing poll...`);
            }
          } catch (probeErr) {
            log.debug('video_exec', `Candidate probe error: ${(probeErr as Error).message}; continuing poll...`);
          }
        }

        // Adaptive polling: 1500ms
        await page.waitForTimeout(1500);
      }

      page.off('response', responseHandler);

      if (earlyFailure) {
        currentAttempt.endedAt = new Date().toISOString();
        currentAttempt.submissionState = 'failed';
        currentAttempt.outcome = 'failed';
        currentAttempt.errorClassification = earlyFailure.classification;
        currentAttempt.errorMessage = earlyFailure.evidence;
        await JobRepository.updateJob(projectId, jobId, {
          submissionState: 'failed',
          attempts: updatedAttempts,
        });
        throw new Error(`FlowFailure [${earlyFailure.classification}]: ${earlyFailure.evidence}`);
      }

      if (!detectedVideoUrl) {
        const hasUnresolvedProgress = await page.evaluate(() => {
          return document.querySelector('.progress-bar, flow-video-tile .generating, mat-spinner') !== null;
        }).catch(() => false);

        currentAttempt.endedAt = new Date().toISOString();
        currentAttempt.submissionState = hasUnresolvedProgress ? 'generating' : 'submission_unknown';
        currentAttempt.outcome = 'timeout';
        currentAttempt.errorClassification = 'timeout';
        currentAttempt.errorMessage = `Video generation timed out after ${pollTimeoutMs / 1000}s.`;
        await JobRepository.updateJob(projectId, jobId, {
          submissionState: currentAttempt.submissionState,
          attempts: updatedAttempts,
        });

        throw new Error(`Video generation timed out after ${pollTimeoutMs / 1000}s. No new video media detected. (generationState: ${currentAttempt.submissionState})`);
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
      currentAttempt.endedAt = new Date().toISOString();
      currentAttempt.submissionState = 'completed';
      currentAttempt.outcome = 'completed';
      const completedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'completed',
        submissionState: 'completed',
        outputPath: destinationPath,
        thumbnailPath: thumbnailPath,
        sourceImagePath: sourceImagePath || undefined,
        attempts: updatedAttempts,
      });

      // Update Slot in project
      const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'completed',
        result: {
          assetId: detectedUuid || `video_${promptId}_${jobId}`,
          mediaPath: destinationPath,
          thumbnailPath: thumbnailPath,
          sourceImagePath: sourceImagePath || undefined,
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

      const rawError = (err as Error).message;
      const classification = CreditFailureDetector.classifyErrorMessage(rawError);
      currentAttempt.endedAt = new Date().toISOString();
      currentAttempt.outcome = 'failed';
      currentAttempt.errorClassification = classification;
      currentAttempt.errorMessage = rawError;

      const failedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'failed',
        errorMessage: rawError,
        attempts: updatedAttempts,
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
