import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { generationEventBus } from '../main/events/GenerationEventBus';
import type { ProfileConfig } from '../shared/types';

function createMockProfileConfig(id: string): ProfileConfig {
  return {
    profileId: id,
    displayName: `Worker ${id}`,
    userDataDir: `C:\\fake\\${id}`,
    chromeProfileName: 'Default',
    chromePath: 'C:\\fake\\chrome.exe',
    cdpPort: 9200 + parseInt(id.replace(/\D/g, '') || '0', 10),
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

describe('ParallelScheduler: Multi-Worker Concurrency & Dynamic Refill', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;
  let scheduler: GenerationScheduler | null = null;
  let pool: WorkerPool | null = null;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-parallel-scheduler-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    pool = new WorkerPool();
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
      scheduler = null;
    }
    if (pool) {
      pool.clear();
      pool = null;
    }
    vi.restoreAllMocks();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('assigns 2 queued jobs simultaneously to 2 available workers in a single dispatch pass', async () => {
    const worker1 = createMockWorker('worker_1');
    const worker2 = createMockWorker('worker_2');
    pool!.registerWorker(worker1);
    pool!.registerWorker(worker2);

    // Mock ImageExecutionService to keep workers busy until resolved
    let resolveJob1: () => void;
    let resolveJob2: () => void;
    const job1Promise = new Promise<void>((r) => { resolveJob1 = r; });
    const job2Promise = new Promise<void>((r) => { resolveJob2 = r; });

    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
      if (job.slotIndex === 0) {
        await job1Promise;
      } else {
        await job2Promise;
      }
    });

    const project = await ProjectRepository.create({
      name: 'Dual Parallel Project',
      generationMode: 'bulk_image',
      imageRatio: '16:9',
      imageModel: 'Nano Banana 2',
      processingOrder: 'automatic',
      maxRetries: 1,
      prompts: [
        { text: 'Image 1', type: 'image' },
        { text: 'Image 2', type: 'image' },
      ],
    });

    scheduler = new GenerationScheduler(pool!);
    await scheduler.enqueueProject(project.projectId);

    // Allow dispatchLoop setImmediate to run
    await new Promise((r) => setTimeout(r, 60));

    // Both workers should now be busy concurrently
    expect(worker1.isBusy).toBe(true);
    expect(worker2.isBusy).toBe(true);
    expect(pool!.busyCount).toBe(2);

    // Verify both jobs are assigned to their respective workers
    const jobs = await JobRepository.getJobsByProject(project.projectId);
    expect(jobs).toHaveLength(2);
    const assignedProfiles = jobs.map((j) => j.profileId).sort();
    expect(assignedProfiles).toEqual(['worker_1', 'worker_2']);

    // Complete jobs
    resolveJob1!();
    resolveJob2!();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('assigns 5 queued jobs simultaneously across 5 workers without serialization', async () => {
    const workers = [1, 2, 3, 4, 5].map((i) => createMockWorker(`worker_${i}`));
    workers.forEach((w) => pool!.registerWorker(w));

    const resolvers: Array<() => void> = [];
    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
      await new Promise<void>((res) => resolvers.push(res));
    });

    const project = await ProjectRepository.create({
      name: '5x Parallel Project',
      generationMode: 'bulk_image',
      imageRatio: '16:9',
      imageModel: 'Nano Banana 2',
      processingOrder: 'automatic',
      maxRetries: 1,
      prompts: [0, 1, 2, 3, 4].map((i) => ({
        text: `Prompt ${i}`,
        type: 'image' as const,
      })),
    });

    scheduler = new GenerationScheduler(pool!);
    await scheduler.enqueueProject(project.projectId);

    await new Promise((r) => setTimeout(r, 80));

    // All 5 workers must be busy at the same time
    expect(pool!.busyCount).toBe(5);
    workers.forEach((w) => {
      expect(w.isBusy).toBe(true);
    });

    // Clean up in-flight promises
    resolvers.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 50));
  });

  it('immediately refills a newly freed worker with the next queued job (dynamic refill)', async () => {
    const workerA = createMockWorker('worker_A');
    pool!.registerWorker(workerA);

    let completeJob0: () => void;
    let completeJob1: () => void;

    vi.spyOn(ImageExecutionService, 'execute').mockImplementation(async (worker, job) => {
      if (job.slotIndex === 0) {
        await new Promise<void>((res) => { completeJob0 = res; });
      } else {
        await new Promise<void>((res) => { completeJob1 = res; });
      }
      // Release worker as would happen after execution service completes
      worker.release();
      generationEventBus.emitTyped('worker:available', worker.profileId);
    });

    const project = await ProjectRepository.create({
      name: 'Refill Project',
      generationMode: 'bulk_image',
      imageRatio: '16:9',
      imageModel: 'Nano Banana 2',
      processingOrder: 'automatic',
      maxRetries: 1,
      prompts: [
        { text: 'Prompt 0', type: 'image' },
        { text: 'Prompt 1', type: 'image' },
      ],
    });

    scheduler = new GenerationScheduler(pool!);
    await scheduler.enqueueProject(project.projectId);

    await new Promise((r) => setTimeout(r, 60));

    // First job is assigned to workerA
    expect(workerA.isBusy).toBe(true);
    let jobs = await JobRepository.getJobsByProject(project.projectId);
    const assignedJob0 = jobs.find((j) => j.slotIndex === 0);
    expect(assignedJob0?.status).toBe('assigned');
    const queuedJob1 = jobs.find((j) => j.slotIndex === 1);
    expect(queuedJob1?.status).toBe('queued');

    // Complete job 0 -> releases workerA -> emits worker:available
    completeJob0!();

    await new Promise((r) => setTimeout(r, 80));

    // Worker A must have immediately picked up job 1 via dynamic refill
    expect(workerA.isBusy).toBe(true);
    jobs = await JobRepository.getJobsByProject(project.projectId);
    const assignedJob1 = jobs.find((j) => j.slotIndex === 1);
    expect(assignedJob1?.status).toBe('assigned');

    completeJob1!();
    await new Promise((r) => setTimeout(r, 50));
  });
});
