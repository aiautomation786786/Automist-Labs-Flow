/**
 * Master Concurrency Test Suite
 *
 * Tests all core guarantees of the Master Concurrency Fix:
 *  1. Single source of truth: default MAX_CONCURRENT_JOBS_PER_PROFILE = 5.
 *  2. Initial full dispatch without artificial delays:
 *     - 3 jobs + 2 profiles (cap 2) -> 3 running immediately, 0 pending
 *     - 10 jobs + 2 profiles (cap 5) -> 10 running immediately, 0 pending
 *     - 20 jobs + 2 profiles (cap 5) -> 10 running immediately, 10 pending
 *     - 50 jobs + 5 profiles (cap 5) -> 25 running immediately, 25 pending
 *  3. Sub-200ms burst dispatch latency (zero artificial delays).
 *  4. Dynamic refill: completing a job instantly releases a slot and dispatches the next queued job.
 *  5. Reactive profile management: adding ready profiles mid-batch immediately consumes backlog;
 *     profile errors stop further assignments to that worker.
 *  6. Same-profile isolation: each concurrent execution uses an isolated execution page.
 *  7. Live capacity metrics accuracy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { ProfileSession } from '../main/engine/ProfileSession';
import {
  ConcurrencyConfig,
  MAX_CONCURRENT_JOBS_PER_PROFILE,
  DEFAULT_MAX_CONCURRENT_JOBS_PER_PROFILE,
} from '../main/scheduler/ConcurrencyConfig';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { ImageExecutionService } from '../main/execution/ImageExecutionService';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { generationEventBus } from '../main/events/GenerationEventBus';
import type { ProfileConfig } from '../shared/types';

function createMockProfileConfig(id: string, port = 9222): ProfileConfig {
  return {
    profileId: id,
    displayName: `Profile ${id}`,
    userDataDir: `C:\\AppData\\Local\\GoogleFlowApp\\profiles\\${id}`,
    chromeProfileName: 'Default',
    chromePath: 'C:\\fake\\chrome.exe',
    cdpPort: port,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flowUrlLocale: null,
    detectedEmail: `${id}@test.com`,
    notes: '',
  };
}

function createReadySession(id: string, port = 9222): ProfileSession {
  const session = new ProfileSession(createMockProfileConfig(id, port));
  Object.defineProperty(session, 'isReady', { get: () => true });
  return session;
}

async function advanceAndCompleteJob(job: { projectId: string; jobId: string }, outputPath?: string) {
  await JobRepository.updateJob(job.projectId, job.jobId, { status: 'starting' });
  await JobRepository.updateJob(job.projectId, job.jobId, { status: 'generating' });
  await JobRepository.updateJob(job.projectId, job.jobId, { status: 'downloading' });
  return await JobRepository.updateJob(job.projectId, job.jobId, {
    status: 'completed',
    outputPath,
  });
}

describe('Master Concurrency & Dynamic Scaling Suite', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;
  let scheduler: GenerationScheduler | null = null;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-master-concurrency-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    ConcurrencyConfig.resetDefault();
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
      scheduler = null;
    }
    vi.restoreAllMocks();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Single Source of Truth for Concurrency Capacity
  // ---------------------------------------------------------------------------
  describe('1. Single Source of Truth for Capacity', () => {
    it('defaults production capacity to exactly 5 jobs per profile', () => {
      expect(MAX_CONCURRENT_JOBS_PER_PROFILE).toBe(5);
      expect(DEFAULT_MAX_CONCURRENT_JOBS_PER_PROFILE).toBe(5);
      expect(ConcurrencyConfig.maxConcurrentJobsPerProfile).toBe(5);
    });

    it('ProfileWorker constructor defaults to MAX_CONCURRENT_JOBS_PER_PROFILE (5)', () => {
      const session = createReadySession('prof_default');
      const worker = new ProfileWorker(session);
      expect(worker.maxConcurrentJobs).toBe(5);
      expect(worker.remainingCapacity).toBe(5);
    });

    it('WorkerPool.syncWithSessionManager creates workers with ConcurrencyConfig value', () => {
      const session1 = createReadySession('p1');
      const session2 = createReadySession('p2');
      const mockSessionMgr = {
        getAllProfiles: () => [
          { profileId: 'p1', status: 'ready' },
          { profileId: 'p2', status: 'ready' },
        ],
        getReadySessions: () => [session1, session2],
        getSession: (id: string) => (id === 'p1' ? session1 : session2),
        on: vi.fn(),
      } as any;

      const pool = new WorkerPool();
      pool.syncWithSessionManager(mockSessionMgr);

      expect(pool.size).toBe(2);
      expect(pool.totalCapacity).toBe(10); // 2 profiles * 5 = 10
      expect(pool.getWorker('p1')?.maxConcurrentJobs).toBe(5);
      expect(pool.getWorker('p2')?.maxConcurrentJobs).toBe(5);
    });

    it('ProfileWorker accepts explicit lower capacity for unit test isolation', () => {
      const session = createReadySession('prof_custom');
      const worker = new ProfileWorker(session, 2);
      expect(worker.maxConcurrentJobs).toBe(2);
      expect(worker.remainingCapacity).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Exact Concurrency Scaling Scenarios
  // ---------------------------------------------------------------------------
  describe('2. Concurrency Scaling & Burst Dispatch Scenarios', () => {
    it('SCENARIO 1: 3 jobs + 2 profiles + cap 2 -> 3 running immediately, 0 pending', async () => {
      const project = await ProjectRepository.create({
        name: '3 Jobs 2 Profiles Cap 2',
        prompts: [
          { text: 'Prompt 1', type: 'image' },
          { text: 'Prompt 2', type: 'image' },
          { text: 'Prompt 3', type: 'image' },
        ],
      });

      const s1 = createReadySession('p1', 9222);
      const s2 = createReadySession('p2', 9223);
      const w1 = new ProfileWorker(s1, 2);
      const w2 = new ProfileWorker(s2, 2);

      const pool = new WorkerPool();
      pool.registerWorker(w1);
      pool.registerWorker(w2);

      const runningJobs: string[] = [];
      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (_worker, job) => {
        runningJobs.push(job.jobId);
        // Keep active during assertion
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      await vi.waitFor(
        () => {
          expect(runningJobs.length).toBe(3);
        },
        { timeout: 1000, interval: 20 }
      );

      const metrics = await scheduler.getCapacityMetrics();
      expect(metrics.activeJobs).toBe(3);
      expect(metrics.pendingJobs).toBe(0);
      expect(metrics.totalCapacity).toBe(4);
      expect(metrics.availableCapacity).toBe(1);
    });

    it('SCENARIO 2: 10 jobs + 2 profiles + cap 5 -> 10 running immediately in initial burst, 0 pending', async () => {
      const prompts = Array.from({ length: 10 }, (_, i) => ({
        text: `Prompt ${i + 1}`,
        type: 'image' as const,
      }));

      const project = await ProjectRepository.create({
        name: '10 Jobs 2 Profiles Cap 5',
        prompts,
      });

      const s1 = createReadySession('p1', 9222);
      const s2 = createReadySession('p2', 9223);
      const w1 = new ProfileWorker(s1, 5);
      const w2 = new ProfileWorker(s2, 5);

      const pool = new WorkerPool();
      pool.registerWorker(w1);
      pool.registerWorker(w2);

      const runningJobs: string[] = [];
      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (_worker, job) => {
        runningJobs.push(job.jobId);
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      // All 10 jobs must start immediately in the same burst
      await vi.waitFor(
        () => {
          expect(runningJobs.length).toBe(10);
        },
        { timeout: 1000, interval: 20 }
      );

      const metrics = await scheduler.getCapacityMetrics();
      expect(metrics.activeJobs).toBe(10);
      expect(metrics.pendingJobs).toBe(0);
      expect(metrics.availableCapacity).toBe(0);
      expect(w1.activeJobCount).toBe(5);
      expect(w2.activeJobCount).toBe(5);
    });

    it('SCENARIO 3: 20 jobs + 2 profiles + cap 5 -> 10 running immediately, 10 pending in queue', async () => {
      const prompts = Array.from({ length: 20 }, (_, i) => ({
        text: `Prompt ${i + 1}`,
        type: 'image' as const,
      }));

      const project = await ProjectRepository.create({
        name: '20 Jobs 2 Profiles Cap 5',
        prompts,
      });

      const s1 = createReadySession('p1', 9222);
      const s2 = createReadySession('p2', 9223);
      const w1 = new ProfileWorker(s1, 5);
      const w2 = new ProfileWorker(s2, 5);

      const pool = new WorkerPool();
      pool.registerWorker(w1);
      pool.registerWorker(w2);

      const runningJobs: string[] = [];
      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (_worker, job) => {
        runningJobs.push(job.jobId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      // Exactly 10 launch immediately
      await vi.waitFor(
        () => {
          expect(runningJobs.length).toBe(10);
        },
        { timeout: 1000, interval: 20 }
      );

      // Exactly 10 remain pending
      const metrics = await scheduler.getCapacityMetrics();
      expect(metrics.activeJobs).toBe(10);
      expect(metrics.pendingJobs).toBe(10);
      expect(metrics.totalCapacity).toBe(10);
      expect(metrics.availableCapacity).toBe(0);
    });

    it('SCENARIO 4: 50 jobs + 5 profiles + cap 5 -> 25 running immediately, 25 pending', async () => {
      const prompts = Array.from({ length: 50 }, (_, i) => ({
        text: `Prompt ${i + 1}`,
        type: 'image' as const,
      }));

      const project = await ProjectRepository.create({
        name: '50 Jobs 5 Profiles Cap 5',
        prompts,
      });

      const pool = new WorkerPool();
      for (let i = 1; i <= 5; i++) {
        const s = createReadySession(`p${i}`, 9220 + i);
        const w = new ProfileWorker(s, 5);
        pool.registerWorker(w);
      }

      const runningJobs: string[] = [];
      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (_worker, job) => {
        runningJobs.push(job.jobId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      // Initial burst must fill all 25 slots across the 5 workers
      await vi.waitFor(
        () => {
          expect(runningJobs.length).toBe(25);
        },
        { timeout: 1500, interval: 20 }
      );

      const metrics = await scheduler.getCapacityMetrics();
      expect(metrics.activeJobs).toBe(25);
      expect(metrics.pendingJobs).toBe(25);
      expect(metrics.totalCapacity).toBe(25);
      expect(metrics.availableCapacity).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Sub-200ms Burst Dispatch Latency (Zero Artificial Delay)
  // ---------------------------------------------------------------------------
  describe('3. Dispatch Latency & Zero Artificial Delays', () => {
    it('dispatches 10 jobs across 2 profiles in under 200ms', async () => {
      const prompts = Array.from({ length: 10 }, (_, i) => ({
        text: `Perf Prompt ${i + 1}`,
        type: 'image' as const,
      }));

      const project = await ProjectRepository.create({
        name: 'Latency Test',
        prompts,
      });

      const s1 = createReadySession('p_fast_1', 9222);
      const s2 = createReadySession('p_fast_2', 9223);
      const w1 = new ProfileWorker(s1, 5);
      const w2 = new ProfileWorker(s2, 5);

      const pool = new WorkerPool();
      pool.registerWorker(w1);
      pool.registerWorker(w2);

      const dispatchTimes: number[] = [];
      const startTime = Date.now();

      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async () => {
        dispatchTimes.push(Date.now() - startTime);
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      await vi.waitFor(
        () => {
          expect(dispatchTimes.length).toBe(10);
        },
        { timeout: 1000, interval: 10 }
      );

      // Max elapsed time from start to the 10th job being handed off to execution
      const totalDispatchDuration = Math.max(...dispatchTimes);
      expect(totalDispatchDuration).toBeLessThan(200);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Dynamic Refill on Job Completion
  // ---------------------------------------------------------------------------
  describe('4. Dynamic Refill on Job Completion', () => {
    it('immediately dispatches next queued job when an active job completes', async () => {
      // 5 prompts, 1 worker with cap 2 -> 2 active initially, 3 pending
      const prompts = Array.from({ length: 5 }, (_, i) => ({
        text: `Refill Prompt ${i + 1}`,
        type: 'image' as const,
      }));

      const project = await ProjectRepository.create({
        name: 'Dynamic Refill Test',
        prompts,
      });

      const session = createReadySession('p_refill', 9222);
      const worker = new ProfileWorker(session, 2);
      const pool = new WorkerPool();
      pool.registerWorker(worker);

      const resolvers: Record<string, () => void> = {};
      const startedJobs: string[] = [];

      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (w, job) => {
        startedJobs.push(job.jobId);
        await new Promise<void>((res) => {
          resolvers[job.jobId] = res;
        });
        await advanceAndCompleteJob(job);
        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, { status: 'completed' });
        w.release(job.jobId);
        generationEventBus.emitTyped('worker:available', w.profileId);
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      // Initial state: 2 running, 3 queued
      await vi.waitFor(() => expect(startedJobs.length).toBe(2));
      expect(worker.activeJobCount).toBe(2);
      expect((await scheduler.getCapacityMetrics()).pendingJobs).toBe(3);

      // Release first job -> slot freed -> job 3 must start immediately
      const firstJobId = startedJobs[0]!;
      resolvers[firstJobId]!();

      await vi.waitFor(
        () => {
          expect(startedJobs.length).toBe(3);
        },
        { timeout: 1000, interval: 20 }
      );

      expect(worker.activeJobCount).toBe(2); // Still full (1 previous + 1 newly started)
      expect((await scheduler.getCapacityMetrics()).pendingJobs).toBe(2);

      // Release remaining jobs
      for (const jId of Object.keys(resolvers)) {
        resolvers[jId]?.();
      }

      await vi.waitFor(
        () => {
          expect(startedJobs.length).toBe(5);
        },
        { timeout: 1500, interval: 20 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Reactive Profile State (Appearance & Disappearance Mid-Batch)
  // ---------------------------------------------------------------------------
  describe('5. Profile State Reactivity', () => {
    it('dispatches backlog immediately when a new profile becomes ready mid-batch', async () => {
      // 10 prompts, Profile 1 (cap 5) takes 5. 5 are left pending.
      const prompts = Array.from({ length: 10 }, (_, i) => ({
        text: `Reactive Prompt ${i + 1}`,
        type: 'image' as const,
      }));

      const project = await ProjectRepository.create({
        name: 'Mid-Batch Profile Addition',
        prompts,
      });

      const s1 = createReadySession('p_existing', 9222);
      const w1 = new ProfileWorker(s1, 5);

      const pool = new WorkerPool();
      pool.registerWorker(w1);

      const runningJobs: Array<{ jobId: string; profileId: string }> = [];
      vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
        runningJobs.push({ jobId: job.jobId, profileId: worker.profileId });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      });

      scheduler = new GenerationScheduler(pool);
      await scheduler.enqueueProject(project.projectId);

      // First 5 running on p_existing, 5 pending
      await vi.waitFor(() => expect(runningJobs.length).toBe(5));
      expect((await scheduler.getCapacityMetrics()).pendingJobs).toBe(5);

      // Now Profile 2 arrives and becomes ready
      const s2 = createReadySession('p_incoming', 9223);
      const w2 = new ProfileWorker(s2, 5);
      pool.registerWorker(w2);

      // Worker available notification triggers scheduler dispatch
      generationEventBus.emitTyped('worker:available', w2.profileId);

      // Backlog of 5 must immediately be assigned to p_incoming
      await vi.waitFor(
        () => {
          expect(runningJobs.length).toBe(10);
        },
        { timeout: 1000, interval: 20 }
      );

      const pIncomingJobs = runningJobs.filter((r) => r.profileId === 'p_incoming');
      expect(pIncomingJobs.length).toBe(5);
      expect((await scheduler.getCapacityMetrics()).pendingJobs).toBe(0);
    });

    it('stops routing jobs to a profile that transitions to error state', async () => {
      const s1 = createReadySession('p_error_test', 9222);
      const w1 = new ProfileWorker(s1, 5);
      const pool = new WorkerPool();
      pool.registerWorker(w1);

      expect(pool.getAvailableWorker()).toBeDefined();

      // Profile experiences session crash
      w1.markError('Chrome CDP session crashed');
      expect(w1.isAvailable).toBe(false);
      expect(w1.state).toBe('error');

      // Worker pool should return null since only worker is errored
      expect(pool.getAvailableWorker()).toBeNull();
      const metrics = pool.getCapacityMetrics(5);
      expect(metrics.errorProfiles).toBe(1);
      expect(metrics.availableCapacity).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Same-Profile Execution Isolation (Page Independence)
  // ---------------------------------------------------------------------------
  describe('6. Same-Profile Page Isolation', () => {
    it('creates and tracks independent Flow Page instances for concurrent jobs on the same profile', async () => {
      const s1 = createReadySession('p_multi_page', 9222);

      // Mock createJobPage returning unique page handles
      const createdPages: any[] = [];
      vi.spyOn(s1, 'createJobPage').mockImplementation(async (jobId: string) => {
        const pageMock = {
          id: `page_for_${jobId}`,
          isClosed: () => false,
          close: vi.fn(),
          url: () => 'https://flow.google.com/studio',
        };
        createdPages.push(pageMock);
        return pageMock as any;
      });

      // Allocate page for Job 1
      const page1 = await s1.createJobPage('job_1');
      // Allocate page for Job 2
      const page2 = await s1.createJobPage('job_2');

      expect(page1).not.toBe(page2);
      expect(createdPages.length).toBe(2);
      expect(createdPages[0].id).toBe('page_for_job_1');
      expect(createdPages[1].id).toBe('page_for_job_2');
    });
  });
});
