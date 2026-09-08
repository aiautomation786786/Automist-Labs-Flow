/**
 * ImageExecutionService – Coordinates the complete image generation lifecycle on a ProfileWorker.
 *
 * MANDATORY SAFETY GUARANTEES:
 *  1. Active Nano Banana 2 Enforcement: Fails safely before generating if model is not verified.
 *  2. Explicit Aspect Ratio: Enforces 16:9 or 9:16.
 *  3. Delta Media Association: Captures pre-generation snapshot (beforeMedia) and post-generation
 *     snapshot (afterMedia), calculating newMedia = afterMedia - beforeMedia to link the exact
 *     new asset with the active job.
 *  4. Non-Navigating Download: SafeDownloader downloads binary via APIRequestContext without page.goto.
 *  5. Output File Safety: Validates file exists, is non-empty, and belongs to target project.
 *  6. Worker Release: Worker is ALWAYS released in a finally block.
 *  7. Exact Slot Mapping: Updates the exact slotIndex in ProjectRepository. Never reorders slots.
 */

import type { GenerationJobEntity, SupportedAspectRatio } from '../../shared/types';
import { ProfileWorker } from '../scheduler/ProfileWorker';
import { ProjectRepository } from '../storage/ProjectRepository';
import { JobRepository } from '../storage/JobRepository';
import { AssetManager } from '../storage/AssetManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { FlowDriver } from '../engine/FlowDriver';
import { AppLogger } from '../utils/AppLogger';

export interface ExecutionOptions {
  triggerGenerationClick?: boolean; // Default true; false for dry-run/mock tests
  pollTimeoutMs?: number;           // Timeout waiting for generation
  mockDeltaUuids?: string[];        // For controlled testing of delta matching & ambiguity
  concurrencyLevel?: number;
}

export class ImageExecutionService {
  /**
   * Executes an image generation job on the designated ProfileWorker.
   */
  static async execute(
    worker: ProfileWorker,
    job: GenerationJobEntity,
    options: ExecutionOptions = {},
  ): Promise<void> {
    const { projectId, slotIndex, promptId, jobId } = job;
    const triggerClick = options.triggerGenerationClick ?? true;
    const pollTimeoutMs = options.pollTimeoutMs ?? 120000;
    const jobStartTime = new Date().toISOString();
    const startMs = Date.now();
    let generationClickTime = jobStartTime;

    const log = new AppLogger({ profileId: worker.profileId, mirrorToStderr: false });
    log.info('image_exec', `Starting image execution for Job ${jobId} (Slot ${slotIndex})`);

    try {
      // Step 1: Transition job status to starting
      await this.updateJobStatus(projectId, jobId, 'starting', 'Preparing browser for generation');

      const automation = worker.automation;

      // Step 2: Ensure Flow is loaded and authenticated
      const auth = await automation.checkAuthentication();
      if (auth.state === 'login_required' || auth.state === 'captcha') {
        throw new Error(`Authentication challenge encountered (${auth.state}). Manual login required.`);
      }

      // Step 3: Transition to configuring (ensuring project, model, ratio)
      // Read project settings to determine requested ratio and Flow project context
      const project = await ProjectRepository.get(projectId);
      const requestedRatio: SupportedAspectRatio = project?.settings.imageRatio ?? '16:9';
      const flowProjectId = (project?.settings as any)?.flowProjectId;

      // Ensure project context (anti-stickiness)
      await automation.ensureProject(flowProjectId ? { projectId: flowProjectId } : {});

      // Mandatory Nano Banana 2 enforcement
      const modelResult = await automation.selectNanoBanana2();
      if (!modelResult.verified) {
        throw new Error(
          `Mandatory model verification failed: could not verify "Nano Banana 2". ` +
          `Detected: "${modelResult.modelDetectedAfter}". ${modelResult.error ?? ''}`
        );
      }

      const ratioResult = await automation.selectRatio(requestedRatio);
      if (!ratioResult.verified) {
        throw new Error(
          `Aspect ratio verification failed: could not verify "${requestedRatio}". ${ratioResult.error ?? ''}`
        );
      }

      // Step 4: Capture Pre-Generation Media Snapshot (for delta matching)
      log.info('image_exec', 'Capturing pre-generation media snapshot...');
      const preGenMedia = await automation.detectGeneratedMedia();
      const beforeUuids = new Set<string>(preGenMedia.imageUuids);

      // Step 5: Fill prompt text into contenteditable / textarea
      const page = automation.getPage();
      const promptCandidates = [
        '[contenteditable="true"]:visible',
        'textarea:visible',
        '[contenteditable="true"]',
        'textarea',
      ];

      const promptInput = await FlowDriver.findFirstVisible(page, promptCandidates, 3000);
      if (!promptInput) {
        throw new Error('Prompt input field not found on Google Flow page.');
      }

      const slot = project?.slots.find((s) => s.slotIndex === slotIndex);
      const promptText = slot?.promptText ?? '';

      await FlowDriver.safeFill(page, promptInput, promptText);
      log.info('image_exec', 'Prompt filled successfully', { promptLength: promptText.length });

      // Step 6: Trigger Generation
      await this.updateJobStatus(projectId, jobId, 'generating', 'Triggering image generation');

      if (triggerClick) {
        const generateBtnCandidates = [
          'button[aria-label="Start generation"]',
          'button:has-text("arrow_forward")',
          'button:has-text("Generate")',
          'button:has-text("Créer")',
          '[aria-label*="generation" i]',
          '[aria-label*="generate" i]',
        ];
        const generateBtn = await FlowDriver.findFirstVisible(page, generateBtnCandidates, 2000);
        if (!generateBtn) {
          throw new Error('Generate button not found on Google Flow page.');
        }

        await generateBtn.click();
        generationClickTime = new Date().toISOString();
        log.info('image_exec', 'Clicked generate button');
      } else {
        generationClickTime = new Date().toISOString();
      }

      // Step 7: Transition to waiting_for_result and poll for delta media
      await this.updateJobStatus(projectId, jobId, 'waiting_for_result', 'Waiting for generated output');

      let newUuid: string | null = null;
      let lastDetectedMedia: import('../../shared/types').MediaDetectionResult | null = null;
      const pollStart = Date.now();

      while (Date.now() - pollStart < pollTimeoutMs) {
        await page.waitForTimeout(2500);

        const currentMedia = await automation.detectGeneratedMedia();
        lastDetectedMedia = currentMedia;
        const deltaUuids = options.mockDeltaUuids !== undefined
          ? options.mockDeltaUuids
          : currentMedia.imageUuids.filter((id) => !beforeUuids.has(id));

        if (deltaUuids.length === 1) {
          newUuid = deltaUuids[0]!;
          log.info('image_exec', `New generated media detected unambiguously: ${newUuid}`);
          break;
        } else if (deltaUuids.length > 1) {
          log.warn('image_exec', `Ambiguous media result: ${deltaUuids.length} new images appeared simultaneously.`);
          await this.updateJobStatus(
            projectId,
            jobId,
            'manual_action_required',
            `Ambiguous result: ${deltaUuids.length} new images detected simultaneously. Manual selection required.`
          );
          await ProjectRepository.updateSlot(projectId, slotIndex, {
            status: 'failed',
            error: {
              code: 'AMBIGUOUS_MEDIA_RESULT',
              message: `Multiple (${deltaUuids.length}) new images detected. Manual selection required.`,
              timestamp: new Date().toISOString(),
              retryCount: job.retryCount,
              profileId: worker.profileId,
            },
          });
          throw new Error(
            `Ambiguous media result: ${deltaUuids.length} new images detected. Manual action required.`
          );
        }
      }

      // In mocked/test mode where triggerClick is false and no mockDeltaUuids was given, allow fallback
      if (!newUuid && !triggerClick) {
        newUuid = `mock_${promptId}_${jobId}`;
      }

      if (!newUuid) {
        throw new Error(
          `Generation timed out after ${Math.round(pollTimeoutMs / 1000)}s: no new image detected in DOM.`
        );
      }

      // Step 8: Non-Navigating Background Download via SafeDownloader
      await this.updateJobStatus(projectId, jobId, 'downloading', 'Downloading generated image in background');

      let destinationPath = AssetManager.getImageDestinationPath(projectId, slotIndex, promptId, jobId);
      let detectedMimeType: string | undefined;

      if (triggerClick) {
        const fullMediaUrl = lastDetectedMedia?.mediaUrls.find((u) => u.includes(newUuid!)) ?? newUuid!;
        const downloadResult = await automation.downloadMedia(fullMediaUrl, destinationPath);
        if (downloadResult.destinationPath) {
          destinationPath = downloadResult.destinationPath;
        }
        detectedMimeType = downloadResult.mimeType;
      } else {
        // Write mock payload in dry-run tests
        const fs = await import('fs');
        const path = await import('path');
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.writeFileSync(destinationPath, Buffer.from('TEST_IMAGE_MOCK_PAYLOAD'));
        detectedMimeType = 'image/png';
      }

      // Step 9: Validate Output File Safety
      const fileCheck = AssetManager.verifyOutputFile(destinationPath, projectId);
      if (!fileCheck.valid) {
        throw new Error(`Output validation failed: ${fileCheck.error}`);
      }

      // Step 10: Complete Job & Update Exact Prompt Slot
      const completedJob = await JobRepository.updateJob(projectId, jobId, {
        status: 'completed',
        outputPath: destinationPath,
      });

      const completionTime = new Date().toISOString();
      const totalElapsedTimeMs = Date.now() - startMs;
      const concurrencyLevel = options.concurrencyLevel ?? 1;

      const updatedSlot = await ProjectRepository.updateSlot(projectId, slotIndex, {
        status: 'completed',
        result: {
          assetId: newUuid,
          mediaPath: destinationPath,
          modelUsed: 'Nano Banana 2',
          ratioUsed: requestedRatio,
          generationResolution: 'Original',
          downloadResolution: project?.settings?.imageDownloadQuality === '2k' ? '2K' : 'Original',
          jobStartTime,
          generationClickTime,
          completionTime,
          totalElapsedTimeMs,
          concurrencyLevel,
          completedAt: completionTime,
          fileSizeBytes: fileCheck.sizeBytes,
          mimeType: detectedMimeType,
        },
      });

      // Step 11: Emit completion events
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
        filePath: destinationPath,
        bytes: fileCheck.sizeBytes,
      });

      log.info('image_exec', `Successfully completed Job ${jobId} -> Slot ${slotIndex}`);
    } catch (err) {
      const errorMsg = (err as Error).message;
      log.error('image_exec', `Execution failed for Job ${jobId}`, err as Error);

      // Check if job was already marked with a specialized status (e.g. manual_action_required)
      const currentJob = await JobRepository.getJob(projectId, jobId).catch(() => null);
      const isManualAction = currentJob?.status === 'manual_action_required';

      if (!isManualAction) {
        // Mark job failed
        const failedJob = await JobRepository.updateJob(projectId, jobId, {
          status: 'failed',
          errorMessage: errorMsg,
        }).catch(() => null);

        // Mark slot failed
        await ProjectRepository.updateSlot(projectId, slotIndex, {
          status: 'failed',
          error: {
            code: 'GENERATION_ERROR',
            message: errorMsg,
            timestamp: new Date().toISOString(),
            retryCount: job.retryCount,
            profileId: worker.profileId,
          },
        }).catch(() => null);

        if (failedJob) {
          generationEventBus.emitTyped('job:failed', failedJob);
        }
      }

      throw err;
    } finally {
      // Step 12: Always release worker lock
      worker.release();
      generationEventBus.emitTyped('worker:available', worker.profileId);
    }
  }

  private static async updateJobStatus(
    projectId: string,
    jobId: string,
    status: GenerationJobEntity['status'],
    stepDescription: string,
  ): Promise<void> {
    const updated = await JobRepository.updateJob(projectId, jobId, { status });
    generationEventBus.emitTyped('job:progress', {
      jobId,
      projectId,
      promptId: updated.promptId,
      slotIndex: updated.slotIndex,
      profileId: updated.profileId,
      status,
      stepDescription,
      timestamp: new Date().toISOString(),
    });
  }
}
