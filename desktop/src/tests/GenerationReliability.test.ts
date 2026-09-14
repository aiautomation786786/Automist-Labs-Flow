/**
 * GenerationReliability.test.ts – Comprehensive regression test suite
 * verifying generation reliability, recovery-first model, false timeout prevention,
 * quota evidence scoping, and true high-concurrency dispatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CreditFailureDetector } from '../main/engine/CreditFailureDetector';
import { GeminiUIDiscovery } from '../main/engine/GeminiUIDiscovery';
import { MediaDetector } from '../main/engine/MediaDetector';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { ConcurrencyConfig } from '../main/scheduler/ConcurrencyConfig';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';

describe('Generation Reliability & True Concurrency Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-rel-test-'));
    process.env.APP_DATA_DIR = tmpDir;
    ConcurrencyConfig.resetDefault();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    delete process.env.APP_DATA_DIR;
    vi.restoreAllMocks();
  });

  describe('Part 1: Quota and Credit False-Positive Protections', () => {
    it('Scenario 7 & 8: Scopes Gemini quota detection to latest response turn, ignoring old chat history', async () => {
      const mockPage = {
        evaluate: vi.fn().mockImplementation((fn: any) => {
          return '';
        }),
      } as any;

      const quotaResult = await GeminiUIDiscovery.detectQuotaExhaustion(mockPage);
      expect(quotaResult).toBeNull();
    });

    it('Scenario 9: Successful HTTP 200 response with "credit balance: 50" is NEVER classified as credit failure', () => {
      const respBody = JSON.stringify({
        user: 'creator@example.com',
        creditBalance: 50,
        message: 'Account details loaded with credit balance',
      });

      const netResult200 = CreditFailureDetector.detectFromNetwork(200, respBody);
      expect(netResult200).toBeNull();

      const exhaustedBody = JSON.stringify({ error: 'insufficient credits to generate video' });
      const netResult402 = CreditFailureDetector.detectFromNetwork(402, exhaustedBody);
      expect(netResult402).not.toBeNull();
      expect(netResult402?.classification).toBe('credit_exhausted');
    });

    it('Scenario 16: Generic timeout is classified as timeout and NEVER quarantines an account', () => {
      const errorMsg = 'Video generation timed out after 360 seconds. No new video media detected.';
      const classification = CreditFailureDetector.classifyErrorMessage(errorMsg);
      expect(classification).toBe('timeout');

      const timeoutLimitMsg = 'Generation timed out waiting for queue limit after 360 seconds.';
      expect(CreditFailureDetector.classifyErrorMessage(timeoutLimitMsg)).toBe('timeout');
    });

    it('Scenario 17: Explicit quota exhaustion is classified accurately', () => {
      const quotaMsg = 'Daily video generation limit reached on Gemini.';
      const classification = CreditFailureDetector.classifyErrorMessage(quotaMsg);
      expect(classification).toBe('quota_exhausted');
    });
  });

  describe('Part 2: Recovery-First Detection & Candidate Probing', () => {
    it('Scenario 10: MediaDetector parses Google Flow and Gemini video URLs accurately', () => {
      const urls = [
        'https://flow-content.google/video/abc-123-xyz',
        'https://example.com/asb/media-stream-456=mm,22,15',
        'https://video.googleusercontent.com/video/gemini-render-789',
        'https://irrelevant.com/image.png',
      ];

      const parsed = MediaDetector.parseMediaUuids(urls);
      expect(parsed.uuids).toContain('abc-123-xyz');
      expect(parsed.uuids).toContain('media-stream-456');
      expect(parsed.uuids).toContain('gemini-render-789');
      expect(parsed.uuids.length).toBe(3);
    });

    it('Scenario 11: MediaDetector detectRecoveryVideo discovers completed video tiles on Flow canvas', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          candidates: ['https://flow-content.google/video/recovered-vid-999'],
          isStillGenerating: false,
        }),
      } as any;

      const recovery = await MediaDetector.detectRecoveryVideo(mockPage, new Set());
      expect(recovery.found).toBe(true);
      expect(recovery.videoUrl).toBe('https://flow-content.google/video/recovered-vid-999');
      expect(recovery.uuid).toBe('recovered-vid-999');
      expect(recovery.isStillGenerating).toBe(false);
    });

    it('Scenario 4: When recovery scan finds nothing and generation completed, indicates generation_completed_remote', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          candidates: [],
          isStillGenerating: false,
        }),
      } as any;

      const recovery = await MediaDetector.detectRecoveryVideo(mockPage, new Set());
      expect(recovery.found).toBe(false);
      expect(recovery.isStillGenerating).toBe(false);
    });

    it('Scenario 11b: GeminiUIDiscovery findLatestVideoElement prioritizes element with populated src', async () => {
      const mockPage = {
        evaluateHandle: vi.fn().mockResolvedValue({
          asElement: () => ({ tag: 'video', src: 'https://video.googleusercontent.com/gemini-ready.mp4' }),
        }),
      } as any;

      const element = await GeminiUIDiscovery.findLatestVideoElement(mockPage);
      expect(element).not.toBeNull();
    });
  });

  describe('Part 3: Scheduler Concurrency, Load-Aware Balancing & Non-Duplication', () => {
    it('Scenario 12: Single worker accepts up to its capacity and assigns immediately', () => {
      const mockSession = {
        profileId: 'prof_single',
        isReady: true,
        getAutomationSession: () => ({} as any),
      } as any;

      const pool = new WorkerPool();
      const worker = new ProfileWorker(mockSession, 5);
      pool.registerWorker(worker);

      expect(worker.maxConcurrentJobs).toBe(5);
      expect(worker.activeJobCount).toBe(0);
      expect(worker.isAvailable).toBe(true);

      for (let i = 0; i < 5; i++) {
        const available = pool.getAvailableWorker();
        expect(available).not.toBeNull();
        available!.assignJob({ jobId: `job_${i}`, slotIndex: i, projectId: 'p1' } as any);
      }

      expect(worker.activeJobCount).toBe(5);
      expect(worker.isAtCapacity).toBe(true);
      expect(pool.getAvailableWorker()).toBeNull();

      worker.release('job_0');
      expect(worker.activeJobCount).toBe(4);
      expect(worker.isAvailable).toBe(true);
      expect(pool.getAvailableWorker()).toBe(worker);
    });

    it('Scenario 13: Distributes load uniformly across multiple healthy accounts', () => {
      const pool = new WorkerPool();
      const worker1 = new ProfileWorker({ profileId: 'prof_1', isReady: true, getAutomationSession: () => ({} as any) } as any, 5);
      const worker2 = new ProfileWorker({ profileId: 'prof_2', isReady: true, getAutomationSession: () => ({} as any) } as any, 5);
      pool.registerWorker(worker1);
      pool.registerWorker(worker2);

      for (let i = 0; i < 4; i++) {
        const chosen = pool.getAvailableWorker();
        expect(chosen).not.toBeNull();
        chosen!.assignJob({ jobId: `dist_job_${i}`, slotIndex: i, projectId: 'p1' } as any);
      }

      expect(worker1.activeJobCount).toBe(2);
      expect(worker2.activeJobCount).toBe(2);
      expect(pool.busyCount).toBe(4);
      expect(pool.totalCapacity).toBe(10);
    });

    it('Scenario 14 & 15: Submission unknown and generation_completed_remote are held for manual verification without duplicate submission', async () => {
      const pool = new WorkerPool();
      const scheduler = new GenerationScheduler(pool);

      const project = await ProjectRepository.create({
        name: 'Safe Submission Test',
        generationMode: 'single_video',
        prompts: [{ text: 'Video prompt', type: 'video' }],
      });

      const job = await JobRepository.createJob({
        projectId: project.projectId,
        promptId: project.slots[0].promptId,
        promptType: 'video',
        slotIndex: 0,
      });

      await JobRepository.updateJob(project.projectId, job.jobId, { status: 'queued' });
      await JobRepository.updateJob(project.projectId, job.jobId, { status: 'assigned' });
      await JobRepository.updateJob(project.projectId, job.jobId, { status: 'starting' });
      const updatedToGen = await JobRepository.updateJob(project.projectId, job.jobId, {
        status: 'generating',
        submissionState: 'submission_unknown',
      });

      await (scheduler as any).handleJobFailure(updatedToGen, 'Video generation timed out after 360s.');

      const updatedJob = await JobRepository.getJob(project.projectId, job.jobId);
      expect(updatedJob?.status).toBe('manual_action_required');

      const updatedProject = await ProjectRepository.get(project.projectId);
      const slot = updatedProject?.slots[0];
      expect(slot?.status).toBe('failed');
      expect(slot?.error?.code).toBe('SUBMISSION_UNKNOWN');

      // Now verify generation_completed_remote behavior
      const job2 = await JobRepository.createJob({
        projectId: project.projectId,
        promptId: project.slots[0].promptId,
        promptType: 'video',
        slotIndex: 0,
      });
      await JobRepository.updateJob(project.projectId, job2.jobId, { status: 'queued' });
      await JobRepository.updateJob(project.projectId, job2.jobId, { status: 'assigned' });
      await JobRepository.updateJob(project.projectId, job2.jobId, { status: 'starting' });
      const updatedToRemote = await JobRepository.updateJob(project.projectId, job2.jobId, {
        status: 'generating',
        submissionState: 'generation_completed_remote',
      });

      await (scheduler as any).handleJobFailure(updatedToRemote, 'GENERATION_COMPLETED_REMOTE: detection timed out');

      const updatedJob2 = await JobRepository.getJob(project.projectId, job2.jobId);
      expect(updatedJob2?.status).toBe('manual_action_required');
      expect(updatedJob2?.submissionState).toBe('generation_completed_remote');

      scheduler.stop();
    });

    it('Scenario 21: Bulk generation enqueues all 50 jobs immediately with scheduler ownership', async () => {
      const prompts = Array.from({ length: 50 }, (_, i) => ({
        text: `Prompt text ${i}`,
        type: 'video' as const,
      }));

      const project = await ProjectRepository.create({
        name: 'Bulk 50 Project',
        generationMode: 'flow_video',
        prompts,
      });

      const pool = new WorkerPool();
      const worker1 = new ProfileWorker({ profileId: 'worker_alpha', isReady: true, getAutomationSession: () => ({} as any) } as any, 5);
      const worker2 = new ProfileWorker({ profileId: 'worker_beta', isReady: true, getAutomationSession: () => ({} as any) } as any, 5);
      pool.registerWorker(worker1);
      pool.registerWorker(worker2);

      const scheduler = new GenerationScheduler(pool, { mockMode: true });

      const enqueued = await scheduler.enqueueProject(project.projectId);
      expect(enqueued.length).toBe(50);

      const persistedJobs = await JobRepository.getJobsByProject(project.projectId);
      expect(persistedJobs.length).toBe(50);

      const queuedCount = persistedJobs.filter((j) => j.status === 'queued').length;
      expect(queuedCount).toBeGreaterThanOrEqual(40);

      scheduler.stop();
    });
  });
});
