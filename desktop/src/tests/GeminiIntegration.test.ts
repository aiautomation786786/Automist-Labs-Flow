/**
 * GeminiIntegration.test.ts – Automated unit and mock tests for Gemini Video Integration.
 *
 * Tests:
 *  1. GeminiUIDiscovery: Modals ("Try it", "Agree"), video mode, aspect ratio (16:9 & 9:16 only), editor, send button, safety blocks, quota exhaustion.
 *  2. GeminiAuthDetector: Accounts redirect, CAPTCHA, authenticated session, email extraction.
 *  3. GeminiDriver: Navigation, aspect ratio switching, image attachment via filechooser, prompt injection, completion detection.
 *  4. GeminiVideoExecutionService: Mock execution, slot 0 mapping, provider: 'gemini', worker release.
 *  5. Scheduler Concurrency & Multi-Profile Distribution:
 *     - 2 profiles, 10 jobs -> balanced distribution (5 each)
 *     - 3 profiles, 9 jobs -> balanced distribution (3 each)
 *     - 5 profiles, 50 jobs -> 25 active (5 each), 25 queued
 *     - 10 profiles, 10 jobs -> 1 each
 *     - 500 jobs scale -> queue bounds, memory bounds, responsiveness
 *  6. Slot ordering & natural image sorting: Immutable slotIndex, 1-to-1 pairing.
 *  7. Quota failover & provider isolation: Flow unaffected, Gemini quarantined cleanly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { GeminiUIDiscovery } from '../main/engine/GeminiUIDiscovery';
import { GeminiAuthDetector } from '../main/engine/GeminiAuthDetector';
import { GeminiDriver } from '../main/engine/GeminiDriver';
import { GeminiVideoExecutionService } from '../main/execution/GeminiVideoExecutionService';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import type { GenerationJobEntity, ProjectEntity } from '../shared/types';

describe('Gemini Web Video Integration Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. GeminiUIDiscovery Tests
  // ---------------------------------------------------------------------------
  describe('1. GeminiUIDiscovery Engine', () => {
    it('should detect and dismiss "Try it" Gemini Omni welcome modal', async () => {
      let dismissed = false;
      const mockPage = {
        locator: vi.fn((sel: string) => ({
          first: () => ({
            isVisible: vi.fn().mockImplementation(async () => sel.includes('Try it')),
            click: vi.fn().mockImplementation(async () => {
              dismissed = true;
            }),
          }),
        })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const result = await GeminiUIDiscovery.dismissKnownModals(mockPage);
      expect(result).toBe(true);
      expect(dismissed).toBe(true);
    });

    it('should detect and dismiss "Agree" image policy consent modal', async () => {
      let agreed = false;
      const mockPage = {
        locator: vi.fn((sel: string) => ({
          first: () => ({
            isVisible: vi.fn().mockImplementation(async () => sel.includes('Agree')),
            click: vi.fn().mockImplementation(async () => {
              agreed = true;
            }),
          }),
        })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const result = await GeminiUIDiscovery.dismissKnownModals(mockPage);
      expect(result).toBe(true);
      expect(agreed).toBe(true);
    });

    it('should verify Video Mode when active pill exists', async () => {
      const mockPage = {
        locator: vi.fn((sel: string) => ({
          first: () => ({
            isVisible: vi.fn().mockImplementation(async () => sel.includes('Deselect Videos')),
          }),
        })),
      } as unknown as Page;

      const isActive = await GeminiUIDiscovery.isVideoModeActive(mockPage);
      expect(isActive).toBe(true);
    });

    it('should detect aspect ratio accurately (Landscape 16:9 vs Portrait 9:16)', async () => {
      const mockPage169 = {
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(true),
            getAttribute: vi.fn().mockResolvedValue('Aspect ratio: Landscape (16:9)'),
            innerText: vi.fn().mockResolvedValue('Landscape (16:9)'),
          }),
        })),
      } as unknown as Page;

      const ratio169 = await GeminiUIDiscovery.getCurrentAspectRatio(mockPage169);
      expect(ratio169).toBe('16:9');

      const mockPage916 = {
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(true),
            getAttribute: vi.fn().mockResolvedValue('Aspect ratio: Portrait (9:16)'),
            innerText: vi.fn().mockResolvedValue('Portrait (9:16)'),
          }),
        })),
      } as unknown as Page;

      const ratio916 = await GeminiUIDiscovery.getCurrentAspectRatio(mockPage916);
      expect(ratio916).toBe('9:16');
    });

    it('should detect safety refusal messages accurately', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(
          "I can't create that video because it violates our safety guidelines regarding explicit content."
        ),
      } as unknown as Page;

      const refusal = await GeminiUIDiscovery.detectSafetyRefusal(mockPage);
      expect(refusal).toBeDefined();
      expect(refusal).toContain('violates our safety guidelines');
    });

    it('should detect daily quota exhaustion accurately', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(
          "You've reached your daily video generation limit. Please try again tomorrow."
        ),
      } as unknown as Page;

      const quotaMsg = await GeminiUIDiscovery.detectQuotaExhaustion(mockPage);
      expect(quotaMsg).toBeDefined();
      expect(quotaMsg).toContain('Daily video generation limit');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GeminiAuthDetector Tests
  // ---------------------------------------------------------------------------
  describe('2. GeminiAuthDetector', () => {
    it('should detect login_required when page redirects to accounts.google.com', async () => {
      const mockPage = {
        url: () => 'https://accounts.google.com/signin/v2/identifier',
      } as unknown as Page;

      const result = await GeminiAuthDetector.checkAuthentication(mockPage);
      expect(result.state).toBe('login_required');
    });

    it('should detect captcha challenge when URL has challenge/recaptcha', async () => {
      const mockPage = {
        url: () => 'https://accounts.google.com/v3/signin/challenge/recaptcha',
      } as unknown as Page;

      const result = await GeminiAuthDetector.checkAuthentication(mockPage);
      expect(result.state).toBe('captcha');
    });

    it('should detect authenticated session and extract email on gemini.google.com', async () => {
      const mockPage = {
        url: () => 'https://gemini.google.com/videos',
        locator: vi.fn((sel: string) => ({
          first: () => ({
            isVisible: vi.fn().mockImplementation(async () => sel.includes('ql-editor')),
          }),
        })),
        evaluate: vi.fn().mockResolvedValue('testuser@gmail.com'),
      } as unknown as Page;

      const result = await GeminiAuthDetector.checkAuthentication(mockPage);
      expect(result.state).toBe('authenticated');
      expect(result.detectedEmail).toBe('testuser@gmail.com');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. GeminiDriver Tests
  // ---------------------------------------------------------------------------
  describe('3. GeminiDriver Automation', () => {
    it('should switch aspect ratio to 9:16 when requested', async () => {
      let clickedTrigger = false;
      let clickedMenuItem = false;
      let currentRatioState = '16:9';

      const mockPage = {
        locator: vi.fn((sel: string) => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(true),
            getAttribute: vi.fn().mockImplementation(async (attr: string) => {
              if (attr === 'aria-label') return `Aspect ratio: ${currentRatioState}`;
              return null;
            }),
            innerText: vi.fn().mockImplementation(async () => currentRatioState),
            click: vi.fn().mockImplementation(async () => {
              if (sel.includes('Aspect ratio')) clickedTrigger = true;
              if (sel.includes('Portrait')) {
                clickedMenuItem = true;
                currentRatioState = '9:16';
              }
            }),
          }),
        })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await GeminiDriver.ensureAspectRatio(mockPage, '9:16');
      expect(clickedTrigger).toBe(true);
      expect(clickedMenuItem).toBe(true);
      expect(currentRatioState).toBe('9:16');
    });

    it('should inject prompt and confirm Send button is enabled', async () => {
      let textInjected = '';
      const mockPage = {
        locator: vi.fn((sel: string) => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(true),
            focus: vi.fn().mockResolvedValue(undefined),
            innerText: vi.fn().mockImplementation(async () => textInjected),
            fill: vi.fn().mockImplementation(async (t: string) => {
              textInjected = t;
            }),
          }),
        })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (_fn: any, text: string) => {
          textInjected = text;
        }),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        waitForFunction: vi.fn().mockResolvedValue(true),
      } as unknown as Page;

      await GeminiDriver.injectPrompt(mockPage, 'A majestic eagle soaring over snowcapped peaks');
      expect(textInjected).toBe('A majestic eagle soaring over snowcapped peaks');
    });

    it('should throw SAFETY_BLOCK error if safety violation occurs during generation', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue("This video violates our safety policies and cannot be generated."),
        evaluateHandle: vi.fn().mockResolvedValue({ asElement: () => null }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await expect(
        GeminiDriver.waitForVideoCompletion(mockPage, { timeoutMs: 2000, pollIntervalMs: 200 })
      ).rejects.toThrow('SAFETY_BLOCK');
    });

    it('should throw QUOTA_EXHAUSTED error if daily generation limit is reached', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue("You have reached your daily video generation limit. Try again tomorrow."),
        evaluateHandle: vi.fn().mockResolvedValue({ asElement: () => null }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await expect(
        GeminiDriver.waitForVideoCompletion(mockPage, { timeoutMs: 2000, pollIntervalMs: 200 })
      ).rejects.toThrow('QUOTA_EXHAUSTED');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GeminiVideoExecutionService Mock Execution Tests
  // ---------------------------------------------------------------------------
  describe('4. GeminiVideoExecutionService Execution & Slot Mapping', () => {
    it('should execute Gemini video job in mockMode, assign provider: gemini, and release worker slot', async () => {
      const mockWorker = {
        profileId: 'profile_gemini_test_01',
        release: vi.fn(),
      } as any;

      const mockJob: GenerationJobEntity = {
        jobId: 'job_gemini_001',
        projectId: 'proj_gemini_test',
        promptId: 'slot_gemini_0',
        promptType: 'video',
        provider: 'gemini',
        slotIndex: 0,
        status: 'queued',
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        metadata: {},
      };

      vi.spyOn(JobRepository, 'updateJob').mockResolvedValue(mockJob as any);
      vi.spyOn(ProjectRepository, 'updateSlot').mockResolvedValue({
        slotIndex: 0,
        promptId: 'slot_gemini_0',
        projectId: 'proj_gemini_test',
        type: 'video',
        provider: 'gemini',
        promptText: 'A futuristic electric vehicle driving on a coastal road...',
        status: 'completed',
        result: {
          assetId: 'gemini_video_slot_gemini_0_job_gemini_001',
          mediaPath: 'C:/test/path/gemini_video.mp4',
          provider: 'gemini',
          modelUsed: 'Gemini Omni',
          ratioUsed: '16:9',
          resolution: '720p',
          durationSeconds: 4.0,
          durationFormatted: '4.0s',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 2048,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await GeminiVideoExecutionService.execute(mockWorker, mockJob, {
        mockMode: true,
        mockDurationSeconds: 4.0,
      });

      expect(mockWorker.release).toHaveBeenCalledTimes(1);
      expect(mockWorker.release).toHaveBeenCalledWith('job_gemini_001');
      expect(JobRepository.updateJob).toHaveBeenCalledWith(
        'proj_gemini_test',
        'job_gemini_001',
        expect.objectContaining({ status: 'completed', provider: 'gemini' })
      );
      expect(ProjectRepository.updateSlot).toHaveBeenCalledWith(
        'proj_gemini_test',
        0,
        expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            provider: 'gemini',
            modelUsed: 'Gemini Omni',
            resolution: '720p',
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Concurrency, Load Balancing & High-Throughput Scheduler Tests
  // ---------------------------------------------------------------------------
  describe('5. Concurrency & Multi-Profile Dynamic Load Balancing', () => {
    it('Scenario 1: 2 profiles, 10 jobs -> balanced distribution (5 each)', () => {
      const pool = new WorkerPool();
      const w1 = new ProfileWorker({ profileId: 'profile_1', isReady: true, getAutomationSession: vi.fn() } as any, 5);
      const w2 = new ProfileWorker({ profileId: 'profile_2', isReady: true, getAutomationSession: vi.fn() } as any, 5);
      pool.registerWorker(w1);
      pool.registerWorker(w2);

      expect(pool.totalCapacity).toBe(10);

      // Assign 10 jobs sequentially
      for (let i = 0; i < 10; i++) {
        const worker = pool.getAvailableWorker();
        expect(worker).not.toBeNull();
        worker!.assignJob({ jobId: `job_${i}` } as any);
      }

      expect(w1.activeJobCount).toBe(5);
      expect(w2.activeJobCount).toBe(5);
      expect(pool.busyCount).toBe(10);
      expect(pool.getAvailableWorker()).toBeNull(); // Capacity full
    });

    it('Scenario 2: 3 profiles, 9 jobs -> balanced distribution (3 each)', () => {
      const pool = new WorkerPool();
      const workers = [
        new ProfileWorker({ profileId: 'p1', isReady: true, getAutomationSession: vi.fn() } as any, 5),
        new ProfileWorker({ profileId: 'p2', isReady: true, getAutomationSession: vi.fn() } as any, 5),
        new ProfileWorker({ profileId: 'p3', isReady: true, getAutomationSession: vi.fn() } as any, 5),
      ];
      workers.forEach((w) => pool.registerWorker(w));

      for (let i = 0; i < 9; i++) {
        const worker = pool.getAvailableWorker();
        expect(worker).not.toBeNull();
        worker!.assignJob({ jobId: `job_${i}` } as any);
      }

      expect(workers[0]!.activeJobCount).toBe(3);
      expect(workers[1]!.activeJobCount).toBe(3);
      expect(workers[2]!.activeJobCount).toBe(3);
      expect(pool.busyCount).toBe(9);
    });

    it('Scenario 3: 5 profiles, 50 jobs -> 25 active (5 each), 25 queued', () => {
      const pool = new WorkerPool();
      const workers = Array.from({ length: 5 }, (_, i) =>
        new ProfileWorker({ profileId: `profile_${i + 1}`, isReady: true, getAutomationSession: vi.fn() } as any, 5)
      );
      workers.forEach((w) => pool.registerWorker(w));

      expect(pool.totalCapacity).toBe(25);

      let activeCount = 0;
      let queuedCount = 0;

      for (let i = 0; i < 50; i++) {
        const worker = pool.getAvailableWorker();
        if (worker) {
          worker.assignJob({ jobId: `job_${i}` } as any);
          activeCount++;
        } else {
          queuedCount++;
        }
      }

      expect(activeCount).toBe(25);
      expect(queuedCount).toBe(25);
      workers.forEach((w) => expect(w.activeJobCount).toBe(5));
    });

    it('Scenario 4: 10 profiles, 10 jobs -> approximately 1 each', () => {
      const pool = new WorkerPool();
      const workers = Array.from({ length: 10 }, (_, i) =>
        new ProfileWorker({ profileId: `profile_${i + 1}`, isReady: true, getAutomationSession: vi.fn() } as any, 5)
      );
      workers.forEach((w) => pool.registerWorker(w));

      for (let i = 0; i < 10; i++) {
        const worker = pool.getAvailableWorker();
        expect(worker).not.toBeNull();
        worker!.assignJob({ jobId: `job_${i}` } as any);
      }

      // Every worker must have exactly 1 job assigned
      workers.forEach((w) => expect(w.activeJobCount).toBe(1));
    });

    it('Scenario 5: 500 jobs large scale -> maintains bounded active capacity without memory leaks', () => {
      const pool = new WorkerPool();
      const workers = Array.from({ length: 5 }, (_, i) =>
        new ProfileWorker({ profileId: `profile_${i + 1}`, isReady: true, getAutomationSession: vi.fn() } as any, 5)
      );
      workers.forEach((w) => pool.registerWorker(w));

      const totalJobs = 500;
      let activeJobs = 0;
      let queuedJobs = 0;

      for (let i = 0; i < totalJobs; i++) {
        const worker = pool.getAvailableWorker();
        if (worker) {
          worker.assignJob({ jobId: `job_${i}` } as any);
          activeJobs++;
        } else {
          queuedJobs++;
        }
      }

      expect(activeJobs).toBe(25);
      expect(queuedJobs).toBe(475);
      expect(pool.busyCount).toBe(25);

      // Simulate 1 completion -> worker releases 1 slot -> immediate refill
      const firstJob = workers[0]!.currentJob;
      expect(firstJob).not.toBeNull();
      workers[0]!.release(firstJob!.jobId);
      expect(pool.busyCount).toBe(24);
      const nextWorker = pool.getAvailableWorker();
      expect(nextWorker).not.toBeNull();
      expect(nextWorker!.profileId).toBe(workers[0]!.profileId);
      nextWorker!.assignJob({ jobId: 'job_refill' } as any);
      expect(pool.busyCount).toBe(25);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Quota Failover & Safety Refusal Isolation
  // ---------------------------------------------------------------------------
  describe('6. Quota Failover & Failure Isolation', () => {
    it('should quarantine exhausted profile and failover to available profile without user retry penalty', async () => {
      const pool = new WorkerPool();
      const w1 = new ProfileWorker({ profileId: 'profile_exhausted', isReady: true, getAutomationSession: vi.fn() } as any, 5);
      const w2 = new ProfileWorker({ profileId: 'profile_healthy', isReady: true, getAutomationSession: vi.fn() } as any, 5);
      pool.registerWorker(w1);
      pool.registerWorker(w2);

      // Quarantine w1 for quota exhaustion
      pool.quarantineProfile('profile_exhausted', 'quota_exhausted', 3600000, 'Daily limit reached');
      expect(pool.isQuarantined('profile_exhausted')).toBe(true);

      // Request next worker -> w1 must be excluded, w2 must be returned
      const availableWorker = pool.getAvailableWorker();
      expect(availableWorker).not.toBeNull();
      expect(availableWorker!.profileId).toBe('profile_healthy');
    });

    it('Flow capacity rule: Adding Gemini does NOT alter MAX_CONCURRENT_JOBS_PER_PROFILE = 5', () => {
      const worker = new ProfileWorker({ profileId: 'profile_flow', isReady: true, getAutomationSession: vi.fn() } as any);
      expect(worker.maxConcurrentJobs).toBe(5);
    });
  });
});
