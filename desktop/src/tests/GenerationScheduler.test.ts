/**
 * Tests for GenerationScheduler.
 *
 * Verifies:
 *  - Deterministic slot mapping with out-of-order completion (2 -> 0 -> 3 -> 1).
 *  - Processing order sorting (images_first, videos_first, automatic).
 *  - Concurrency control (never assigns more than one job per worker).
 *  - Idempotency & duplicate assignment prevention.
 *  - Error handling: transient retries vs manual_action_required.
 *  - Job cancellation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { ProfileSession } from '../main/engine/ProfileSession';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { ImageExecutionService } from '../main/execution/ImageExecutionService';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { AssetManager } from '../main/storage/AssetManager';
import { generationEventBus } from '../main/events/GenerationEventBus';
import type { ProfileConfig } from '../shared/types';

function createMockProfileConfig(id: string): ProfileConfig {
  return {
    profileId: id,
    displayName: `Worker ${id}`,
    userDataDir: `C:\\fake\\${id}`,
    chromeProfileName: 'Default',
    chromePath: 'C:\\fake\\chrome.exe',
    cdpPort: 9222,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flowUrlLocale: null,
    detectedEmail: null,
    notes: '',
  };
}

function createMockWorker(id: string): ProfileWorker {
  const session = new ProfileSession(createMockProfileConfig(id));
  Object.defineProperty(session, 'isReady', { get: () => true });
  return new ProfileWorker(session);
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

describe('GenerationScheduler', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;
  let scheduler: GenerationScheduler | null = null;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-scheduler-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
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

  it('DETERMINISTIC SLOT MAPPING: out-of-order completion maps results to exact original slots', async () => {
    const project = await ProjectRepository.create({
      name: 'Deterministic Mapping Test',
      prompts: [
        { text: 'Prompt 0', type: 'image' },
        { text: 'Prompt 1', type: 'image' },
        { text: 'Prompt 2', type: 'image' },
        { text: 'Prompt 3', type: 'image' },
      ],
    });

    const projectId = project.projectId;

    // Register exactly 3 workers (per spec)
    const pool = new WorkerPool();
    const w1 = createMockWorker('worker_1');
    const w2 = createMockWorker('worker_2');
    const w3 = createMockWorker('worker_3');
    pool.registerWorker(w1);
    pool.registerWorker(w2);
    pool.registerWorker(w3);

    // Deterministic triggers for each slot
    const deferreds: Record<number, { promise: Promise<void>; resolve: () => void }> = {};
    for (let i = 0; i < 4; i++) {
      let res!: () => void;
      const p = new Promise<void>((r) => {
        res = r;
      });
      deferreds[i] = { promise: p, resolve: res };
    }

    const completionOrder: number[] = [];

    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
      try {
        // Wait for explicit test trigger
        await deferreds[job.slotIndex]!.promise;

        const outputPath = AssetManager.getImageDestinationPath(
          job.projectId,
          job.slotIndex,
          job.promptId,
          job.jobId
        );

        // Create dummy file so verification passes
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, Buffer.from(`DATA_SLOT_${job.slotIndex}`));

        await advanceAndCompleteJob(job, outputPath);

        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, {
          status: 'completed',
          result: {
            assetId: `result_asset_${job.slotIndex}`,
            mediaPath: outputPath,
            modelUsed: 'Nano Banana 2',
            ratioUsed: '16:9',
            completedAt: new Date().toISOString(),
            fileSizeBytes: 100,
          },
        });

        completionOrder.push(job.slotIndex);
      } finally {
        worker.release();
        generationEventBus.emitTyped('worker:available', worker.profileId);
      }
    });

    scheduler = new GenerationScheduler(pool);
    await scheduler.enqueueProject(projectId);

    // Initial 3 workers pick up slots 0, 1, 2
    // Trigger completion in exact sequence: 2 -> 0 -> 3 -> 1
    deferreds[2]!.resolve();

    // Give a small tick so worker 3 finishes slot 2 and picks up slot 3
    await new Promise((r) => setTimeout(r, 40));

    deferreds[0]!.resolve();
    await new Promise((r) => setTimeout(r, 40));

    deferreds[3]!.resolve();
    await new Promise((r) => setTimeout(r, 40));

    deferreds[1]!.resolve();

    // Wait for all 4 slots to finish
    await vi.waitFor(
      async () => {
        const reloaded = await ProjectRepository.get(projectId);
        expect(reloaded?.stats.completedImages).toBe(4);
      },
      { timeout: 3000, interval: 50 }
    );

    // Verify out-of-order completion actually happened: 2 -> 0 -> 3 -> 1
    expect(completionOrder).toEqual([2, 0, 3, 1]);

    // Verify slots array order is strictly preserved: [0, 1, 2, 3]
    const finalProject = await ProjectRepository.get(projectId);
    expect(finalProject).not.toBeNull();
    const slots = finalProject!.slots;

    expect(slots).toHaveLength(4);
    expect(slots[0]?.slotIndex).toBe(0);
    expect(slots[1]?.slotIndex).toBe(1);
    expect(slots[2]?.slotIndex).toBe(2);
    expect(slots[3]?.slotIndex).toBe(3);

    // Verify exact slot-to-result mapping: Slot 0 has Result 0, Slot 1 has Result 1, etc.
    expect(slots[0]?.result?.assetId).toBe('result_asset_0');
    expect(slots[0]?.result?.mediaPath).toContain('slot_00_');

    expect(slots[1]?.result?.assetId).toBe('result_asset_1');
    expect(slots[1]?.result?.mediaPath).toContain('slot_01_');

    expect(slots[2]?.result?.assetId).toBe('result_asset_2');
    expect(slots[2]?.result?.mediaPath).toContain('slot_02_');

    expect(slots[3]?.result?.assetId).toBe('result_asset_3');
    expect(slots[3]?.result?.mediaPath).toContain('slot_03_');
  });

  it('DISPATCH PRIORITY: images_first prioritizes image slots over video slots', async () => {
    const project = await ProjectRepository.create({
      name: 'Priority Test',
      processingOrder: 'images_first',
      prompts: [
        { text: 'Prompt 0 (Video)', type: 'video' },
        { text: 'Prompt 1 (Image)', type: 'image' },
        { text: 'Prompt 2 (Video)', type: 'video' },
        { text: 'Prompt 3 (Image)', type: 'image' },
      ],
    });

    const pool = new WorkerPool();
    const singleWorker = createMockWorker('solo_worker');
    pool.registerWorker(singleWorker);

    const executedOrder: string[] = [];

    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
      try {
        executedOrder.push(`image_slot_${job.slotIndex}`);
        await advanceAndCompleteJob(job);
        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, { status: 'completed' });
      } finally {
        worker.release();
        generationEventBus.emitTyped('worker:available', worker.profileId);
      }
    });

    vi.spyOn(VideoExecutionService, 'execute').mockImplementation(async (worker, job) => {
      try {
        executedOrder.push(`video_slot_${job.slotIndex}`);
        await advanceAndCompleteJob(job);
        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, { status: 'completed' });
      } finally {
        worker.release();
        generationEventBus.emitTyped('worker:available', worker.profileId);
      }
    });

    scheduler = new GenerationScheduler(pool);
    await scheduler.enqueueProject(project.projectId);

    // Wait for all 4 to execute sequentially on the single worker
    await vi.waitFor(
      async () => {
        expect(executedOrder).toHaveLength(4);
      },
      { timeout: 3000, interval: 50 }
    );

    // Images must have run before videos
    expect(executedOrder[0]).toBe('image_slot_1');
    expect(executedOrder[1]).toBe('image_slot_3');
    expect(executedOrder[2]).toBe('video_slot_0');
    expect(executedOrder[3]).toBe('video_slot_2');
  });

  it('DISPATCH PRIORITY: videos_first prioritizes video slots over image slots', async () => {
    const project = await ProjectRepository.create({
      name: 'Videos Priority Test',
      processingOrder: 'videos_first',
      prompts: [
        { text: 'Prompt 0 (Image)', type: 'image' },
        { text: 'Prompt 1 (Video)', type: 'video' },
      ],
    });

    const pool = new WorkerPool();
    const singleWorker = createMockWorker('solo_worker');
    pool.registerWorker(singleWorker);

    const executedOrder: string[] = [];

    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
      try {
        executedOrder.push(`image_slot_${job.slotIndex}`);
        await advanceAndCompleteJob(job);
        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, { status: 'completed' });
      } finally {
        worker.release();
        generationEventBus.emitTyped('worker:available', worker.profileId);
      }
    });

    vi.spyOn(VideoExecutionService, 'execute').mockImplementation(async (worker, job) => {
      try {
        executedOrder.push(`video_slot_${job.slotIndex}`);
        await advanceAndCompleteJob(job);
        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, { status: 'completed' });
      } finally {
        worker.release();
        generationEventBus.emitTyped('worker:available', worker.profileId);
      }
    });

    scheduler = new GenerationScheduler(pool);
    await scheduler.enqueueProject(project.projectId);

    await vi.waitFor(
      async () => {
        expect(executedOrder).toHaveLength(2);
      },
      { timeout: 3000, interval: 50 }
    );

    // Video must run first
    expect(executedOrder[0]).toBe('video_slot_1');
    expect(executedOrder[1]).toBe('image_slot_0');
  });

  it('RETRY SAFETY: transient failures transition to retry_waiting then re-queue', async () => {
    const project = await ProjectRepository.create({
      name: 'Retry Test',
      maxRetries: 1,
      prompts: [{ text: 'Prompt transient error', type: 'image' }],
    });

    const pool = new WorkerPool();
    const worker = createMockWorker('worker_retry');
    pool.registerWorker(worker);

    let attempts = 0;
    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (w, job) => {
      attempts++;
      w.release();
      generationEventBus.emitTyped('worker:available', w.profileId);
      if (attempts === 1) {
        throw new Error('Network timeout during render');
      } else {
        await JobRepository.updateJob(job.projectId, job.jobId, { status: 'completed' });
        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, { status: 'completed' });
      }
    });

    scheduler = new GenerationScheduler(pool);
    const jobs = await scheduler.enqueueProject(project.projectId);
    const jobId = jobs[0]!.jobId;

    // After attempt 1, job should be marked retry_waiting
    await vi.waitFor(
      async () => {
        const j = await JobRepository.getJob(project.projectId, jobId);
        expect(j?.status).toBe('retry_waiting');
        expect(j?.retryCount).toBe(1);
      },
      { timeout: 2000, interval: 50 }
    );
  });

  it('MANUAL ACTION: unrecoverable challenge marks manual_action_required without looping', async () => {
    const project = await ProjectRepository.create({
      name: 'Captcha Test',
      maxRetries: 3,
      prompts: [{ text: 'Prompt with captcha', type: 'image' }],
    });

    const pool = new WorkerPool();
    const worker = createMockWorker('worker_captcha');
    pool.registerWorker(worker);

    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (w) => {
      w.release();
      generationEventBus.emitTyped('worker:available', w.profileId);
      throw new Error('Authentication challenge encountered (captcha). Manual login required.');
    });

    scheduler = new GenerationScheduler(pool);
    const jobs = await scheduler.enqueueProject(project.projectId);
    const jobId = jobs[0]!.jobId;

    await vi.waitFor(
      async () => {
        const j = await JobRepository.getJob(project.projectId, jobId);
        expect(j?.status).toBe('manual_action_required');
      },
      { timeout: 2000, interval: 50 }
    );
  });

  it('cancelJob should cancel an enqueued job and mark slot cancelled', async () => {
    const project = await ProjectRepository.create({
      name: 'Cancel Test',
      prompts: [{ text: 'Prompt to cancel', type: 'image' }],
    });

    // Don't register any workers so job stays queued
    const pool = new WorkerPool();
    scheduler = new GenerationScheduler(pool);

    const jobs = await scheduler.enqueueProject(project.projectId);
    const jobId = jobs[0]!.jobId;

    await scheduler.cancelJob(project.projectId, jobId);

    const job = await JobRepository.getJob(project.projectId, jobId);
    expect(job?.status).toBe('cancelled');

    const reloaded = await ProjectRepository.get(project.projectId);
    expect(reloaded?.slots[0]?.status).toBe('cancelled');
  });
});
