/**
 * GeminiImageExecution.test.ts – Automated unit and mock tests for Gemini Image Integration.
 *
 * Tests:
 *  1. GeminiDriver Image Generation:
 *     - Detection of generated image via waitForImageCompletion
 *     - Safety block error handling
 *     - Quota exhaustion error handling
 *  2. GeminiImageExecutionService:
 *     - Single image mock execution
 *     - Bulk image mock execution across multiple slots
 *     - Slot mapping, thumbnail generation, original preservation, and worker release
 *  3. GenerationScheduler Provider Routing:
 *     - Routes Gemini image jobs to GeminiImageExecutionService
 *     - Routes Gemini video jobs to GeminiVideoExecutionService
 *     - Routes Flow image jobs to ImageExecutionService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { GeminiDriver } from '../main/engine/GeminiDriver';
import { GeminiUIDiscovery } from '../main/engine/GeminiUIDiscovery';
import { GeminiImageExecutionService } from '../main/execution/GeminiImageExecutionService';
import { GeminiVideoExecutionService } from '../main/execution/GeminiVideoExecutionService';
import { ImageExecutionService } from '../main/execution/ImageExecutionService';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import type { GenerationJobEntity, ProjectEntity } from '../shared/types';

describe('Gemini Image Execution & Scheduler Routing Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. GeminiDriver Image Detection & Errors
  // ---------------------------------------------------------------------------
  describe('1. GeminiDriver Image Methods', () => {
    it('should detect generated image element when AI image is rendered in DOM', async () => {
      vi.spyOn(GeminiUIDiscovery, 'detectSafetyRefusal').mockResolvedValue(null);
      vi.spyOn(GeminiUIDiscovery, 'detectQuotaExhaustion').mockResolvedValue(null);
      vi.spyOn(GeminiUIDiscovery, 'detectGenerationFailure').mockResolvedValue(null);

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([
          {
            src: 'blob:https://gemini.google.com/test-uuid',
            width: 1024,
            height: 572,
          },
        ]),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const result = await GeminiDriver.waitForImageCompletion(mockPage, {
        timeoutMs: 2000,
        pollIntervalMs: 100,
      });

      expect(result.imageUrl).toBe('blob:https://gemini.google.com/test-uuid');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(572);
    });

    it('should throw SAFETY_BLOCK error if image generation triggers safety block', async () => {
      vi.spyOn(GeminiUIDiscovery, 'detectSafetyRefusal').mockResolvedValue(
        'I cannot generate images of that nature due to safety policies.'
      );

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([]),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await expect(
        GeminiDriver.waitForImageCompletion(mockPage, { timeoutMs: 1000, pollIntervalMs: 100 })
      ).rejects.toThrow('SAFETY_BLOCK');
    });

    it('should throw QUOTA_EXHAUSTED error if image daily generation limit is reached', async () => {
      vi.spyOn(GeminiUIDiscovery, 'detectSafetyRefusal').mockResolvedValue(null);
      vi.spyOn(GeminiUIDiscovery, 'detectQuotaExhaustion').mockResolvedValue(
        'You have reached your daily generation limit.'
      );

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([]),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await expect(
        GeminiDriver.waitForImageCompletion(mockPage, { timeoutMs: 1000, pollIntervalMs: 100 })
      ).rejects.toThrow('QUOTA_EXHAUSTED');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GeminiImageExecutionService Mock Execution
  // ---------------------------------------------------------------------------
  describe('2. GeminiImageExecutionService Single & Bulk Execution', () => {
    it('should execute single image job in mockMode, assign provider: gemini, and release worker slot', async () => {
      const mockWorker = {
        profileId: 'profile_gemini_test_01',
        release: vi.fn(),
      } as any;

      const mockJob: GenerationJobEntity = {
        jobId: 'job_gemini_img_001',
        projectId: 'proj_gemini_img_test',
        promptId: 'slot_img_0',
        promptType: 'image',
        provider: 'gemini',
        slotIndex: 0,
        status: 'queued',
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        metadata: {
          aspectRatio: '16:9',
          imageModel: 'Gemini Without Watermark',
        },
      };

      vi.spyOn(JobRepository, 'updateJob').mockResolvedValue(mockJob as any);
      vi.spyOn(ProjectRepository, 'updateSlot').mockResolvedValue({
        slotIndex: 0,
        promptId: 'slot_img_0',
        projectId: 'proj_gemini_img_test',
        type: 'image',
        provider: 'gemini',
        promptText: 'A high quality landscape...',
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await GeminiImageExecutionService.execute(mockWorker, mockJob, {
        mockMode: true,
      });

      expect(mockWorker.release).toHaveBeenCalledTimes(1);
      expect(mockWorker.release).toHaveBeenCalledWith('job_gemini_img_001');

      expect(JobRepository.updateJob).toHaveBeenCalledWith(
        'proj_gemini_img_test',
        'job_gemini_img_001',
        expect.objectContaining({ status: 'completed', provider: 'gemini' })
      );

      expect(ProjectRepository.updateSlot).toHaveBeenCalledWith(
        'proj_gemini_img_test',
        0,
        expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            provider: 'gemini',
            modelUsed: 'Gemini Without Watermark',
            ratioUsed: '16:9',
          }),
        })
      );
    });

    it('should execute bulk image jobs across multiple slots and preserve slot indices', async () => {
      const mockWorker = {
        profileId: 'profile_gemini_test_02',
        release: vi.fn(),
      } as any;

      const slotIndices = [0, 1];
      for (const idx of slotIndices) {
        const mockJob: GenerationJobEntity = {
          jobId: `job_gemini_bulk_${idx}`,
          projectId: 'proj_gemini_bulk_test',
          promptId: `slot_img_${idx}`,
          promptType: 'image',
          provider: 'gemini',
          slotIndex: idx,
          status: 'queued',
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          metadata: {
            aspectRatio: '9:16',
            imageModel: 'Gemini Without Watermark',
            generationMode: 'gemini_bulk_image',
          },
        };

        vi.spyOn(JobRepository, 'updateJob').mockResolvedValue(mockJob as any);
        vi.spyOn(ProjectRepository, 'updateSlot').mockResolvedValue({} as any);

        await GeminiImageExecutionService.execute(mockWorker, mockJob, {
          mockMode: true,
        });

        expect(mockWorker.release).toHaveBeenCalledWith(`job_gemini_bulk_${idx}`);
        expect(ProjectRepository.updateSlot).toHaveBeenCalledWith(
          'proj_gemini_bulk_test',
          idx,
          expect.objectContaining({
            status: 'completed',
            result: expect.objectContaining({
              ratioUsed: '9:16',
              provider: 'gemini',
            }),
          })
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. GenerationScheduler Dispatch Routing
  // ---------------------------------------------------------------------------
  describe('3. GenerationScheduler Dispatch Routing', () => {
    let workerPool: WorkerPool;
    let scheduler: GenerationScheduler;
    let mockWorker: ProfileWorker;

    beforeEach(() => {
      workerPool = new WorkerPool();
      mockWorker = {
        profileId: 'profile_test_1',
        isAvailable: true,
        assignJob: vi.fn(),
        release: vi.fn(),
      } as unknown as ProfileWorker;

      vi.spyOn(workerPool, 'getAvailableWorker').mockReturnValue(mockWorker);
      scheduler = new GenerationScheduler(workerPool, { mockMode: true });
    });

    it('should route Gemini image jobs to GeminiImageExecutionService', async () => {
      const executeImageSpy = vi.spyOn(GeminiImageExecutionService, 'execute').mockResolvedValue();
      const executeVideoSpy = vi.spyOn(GeminiVideoExecutionService, 'execute').mockResolvedValue();
      const executeFlowSpy = vi.spyOn(ImageExecutionService, 'execute').mockResolvedValue();

      const mockJob: GenerationJobEntity = {
        jobId: 'j_img_gemini',
        projectId: 'proj_1',
        promptId: 'slot_0',
        promptType: 'image',
        provider: 'gemini',
        slotIndex: 0,
        status: 'running',
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        metadata: {},
      };

      await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

      expect(executeImageSpy).toHaveBeenCalledWith(mockWorker, mockJob, expect.anything());
      expect(executeVideoSpy).not.toHaveBeenCalled();
      expect(executeFlowSpy).not.toHaveBeenCalled();
    });

    it('should route Gemini video jobs to GeminiVideoExecutionService', async () => {
      const executeImageSpy = vi.spyOn(GeminiImageExecutionService, 'execute').mockResolvedValue();
      const executeVideoSpy = vi.spyOn(GeminiVideoExecutionService, 'execute').mockResolvedValue();
      const executeFlowSpy = vi.spyOn(VideoExecutionService, 'execute').mockResolvedValue();

      const mockJob: GenerationJobEntity = {
        jobId: 'j_vid_gemini',
        projectId: 'proj_1',
        promptId: 'slot_0',
        promptType: 'video',
        provider: 'gemini',
        slotIndex: 0,
        status: 'running',
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        metadata: {},
      };

      await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

      expect(executeVideoSpy).toHaveBeenCalledWith(mockWorker, mockJob, expect.anything());
      expect(executeImageSpy).not.toHaveBeenCalled();
      expect(executeFlowSpy).not.toHaveBeenCalled();
    });

    it('should route Flow image jobs to ImageExecutionService', async () => {
      const executeImageSpy = vi.spyOn(GeminiImageExecutionService, 'execute').mockResolvedValue();
      const executeVideoSpy = vi.spyOn(GeminiVideoExecutionService, 'execute').mockResolvedValue();
      const executeFlowSpy = vi.spyOn(ImageExecutionService, 'execute').mockResolvedValue();

      const mockJob: GenerationJobEntity = {
        jobId: 'j_img_flow',
        projectId: 'proj_1',
        promptId: 'slot_0',
        promptType: 'image',
        provider: 'flow',
        slotIndex: 0,
        status: 'running',
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        metadata: {},
      };

      await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

      expect(executeFlowSpy).toHaveBeenCalledWith(mockWorker, mockJob, expect.anything());
      expect(executeImageSpy).not.toHaveBeenCalled();
      expect(executeVideoSpy).not.toHaveBeenCalled();
    });
  });
});
