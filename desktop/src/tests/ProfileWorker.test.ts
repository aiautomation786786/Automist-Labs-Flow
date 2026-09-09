/**
 * Tests for ProfileWorker & WorkerPool.
 *
 * Verifies:
 *  - Multi-slot concurrency: a worker can hold up to maxConcurrentJobs simultaneously.
 *  - Capacity enforcement: throws only when ALL slots are occupied.
 *  - Per-slot release: release(jobId) frees only the specified slot.
 *  - Worker state lifecycle: idle → busy → release / error → reset.
 *  - WorkerPool load-aware selection and capacity-based busyCount.
 */

import { describe, it, expect } from 'vitest';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileSession } from '../main/engine/ProfileSession';
import type { ProfileConfig, GenerationJobEntity } from '../shared/types';

function createMockProfileConfig(id: string): ProfileConfig {
  return {
    profileId: id,
    displayName: `Worker Profile ${id}`,
    userDataDir: `C:\\fake\\user_data\\${id}`,
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

function createMockJob(jobId: string, slotIndex = 0): GenerationJobEntity {
  return {
    jobId,
    projectId: 'proj_test',
    promptId: `prompt_${jobId}`,
    promptType: 'image',
    slotIndex,
    status: 'assigned',
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: 2,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// ProfileWorker Tests
// ---------------------------------------------------------------------------

describe('ProfileWorker', () => {
  it('should initialize with idle state and no active jobs', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);

    expect(worker.profileId).toBe('profile_1');
    expect(worker.isBusy).toBe(false);
    expect(worker.isAtCapacity).toBe(false);
    expect(worker.activeJobCount).toBe(0);
    expect(worker.currentJob).toBeNull();
    expect(worker.state).toBe('idle');
  });

  it('assignJob should make the worker busy with one active job', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);
    const job = createMockJob('job_1');

    worker.assignJob(job);

    expect(worker.isBusy).toBe(true);
    expect(worker.isAtCapacity).toBe(false); // cap=2, only 1 job → not at capacity yet
    expect(worker.activeJobCount).toBe(1);
    expect(worker.state).toBe('busy');
    expect(worker.currentJob).toBe(job);
  });

  it('MULTI-SLOT: worker can hold 2 concurrent jobs simultaneously (cap=2)', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 2); // explicit cap=2
    const job1 = createMockJob('job_1', 0);
    const job2 = createMockJob('job_2', 1);

    worker.assignJob(job1);
    worker.assignJob(job2); // second slot — must NOT throw

    expect(worker.activeJobCount).toBe(2);
    expect(worker.isBusy).toBe(true);
    expect(worker.isAtCapacity).toBe(true);
    expect(worker.isAvailable).toBe(false); // at capacity → no more assignments
    expect(worker.activeJobs).toHaveLength(2);
    expect(worker.state).toBe('busy');
  });

  it('CAPACITY ENFORCEMENT: assignJob throws when all slots are occupied (cap=2)', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 2); // explicit cap=2
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');
    const job3 = createMockJob('job_3');

    worker.assignJob(job1);
    worker.assignJob(job2); // fills capacity

    expect(() => worker.assignJob(job3)).toThrow(/at full capacity/);
    expect(worker.activeJobCount).toBe(2); // job3 not added
  });

  it('CAPACITY ENFORCEMENT: cap=1 throws on second assignment', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 1); // explicit cap=1
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');

    worker.assignJob(job1);

    expect(() => worker.assignJob(job2)).toThrow(/at full capacity/);
    expect(worker.currentJob).toBe(job1);
  });

  it('TARGETED RELEASE: release(jobId) frees only the specified slot', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 2); // explicit cap=2
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');

    worker.assignJob(job1);
    worker.assignJob(job2);
    expect(worker.activeJobCount).toBe(2);
    expect(worker.isAtCapacity).toBe(true);

    // Release only job1 — job2 must still be active
    worker.release('job_1');

    expect(worker.activeJobCount).toBe(1);
    expect(worker.isBusyWithJob('job_1')).toBe(false);
    expect(worker.isBusyWithJob('job_2')).toBe(true);
    expect(worker.isAtCapacity).toBe(false);
    expect(worker.isAvailable).toBe(false); // session.isReady is false in test; still 1 job
    expect(worker.state).toBe('busy'); // still has job2
  });

  it('TARGETED RELEASE: after releasing all individual slots, worker becomes idle', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 2); // explicit cap=2
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');

    worker.assignJob(job1);
    worker.assignJob(job2);

    worker.release('job_1');
    worker.release('job_2');

    expect(worker.activeJobCount).toBe(0);
    expect(worker.isBusy).toBe(false);
    expect(worker.isAtCapacity).toBe(false);
    expect(worker.currentJob).toBeNull();
    expect(worker.state).toBe('idle');
  });

  it('FULL RELEASE: release() with no args clears all active slots', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 2); // explicit cap=2
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');

    worker.assignJob(job1);
    worker.assignJob(job2);

    worker.release(); // emergency full clear

    expect(worker.activeJobCount).toBe(0);
    expect(worker.isBusy).toBe(false);
    expect(worker.state).toBe('idle');
  });

  it('markError and resetError should manage error state transitions', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);
    const job = createMockJob('job_1');

    worker.assignJob(job);
    worker.markError('Chrome CDP disconnected');

    expect(worker.state).toBe('error');
    expect(worker.lastError).toBe('Chrome CDP disconnected');
    expect(worker.activeJobCount).toBe(0); // markError clears all jobs
    expect(worker.currentJob).toBeNull();
    expect(worker.isAvailable).toBe(false); // error state blocks new assignments

    worker.resetError();
    expect(worker.state).toBe('idle');
    expect(worker.lastError).toBeNull();
  });

  it('isBusyWithJob returns true for assigned jobs and false after release', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');

    worker.assignJob(job1);
    worker.assignJob(job2);

    expect(worker.isBusyWithJob('job_1')).toBe(true);
    expect(worker.isBusyWithJob('job_2')).toBe(true);
    expect(worker.isBusyWithJob('job_unknown')).toBe(false);

    worker.release('job_1');
    expect(worker.isBusyWithJob('job_1')).toBe(false);
    expect(worker.isBusyWithJob('job_2')).toBe(true);
  });

  it('remainingCapacity reflects available slots correctly', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session, 3); // cap=3
    expect(worker.remainingCapacity).toBe(3);

    worker.assignJob(createMockJob('job_1'));
    expect(worker.remainingCapacity).toBe(2);

    worker.assignJob(createMockJob('job_2'));
    expect(worker.remainingCapacity).toBe(1);

    worker.assignJob(createMockJob('job_3'));
    expect(worker.remainingCapacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WorkerPool Tests
// ---------------------------------------------------------------------------

describe('WorkerPool', () => {
  it('should register and retrieve workers', () => {
    const pool = new WorkerPool();
    const s1 = new ProfileSession(createMockProfileConfig('profile_a'));
    const s2 = new ProfileSession(createMockProfileConfig('profile_b'));
    const w1 = new ProfileWorker(s1);
    const w2 = new ProfileWorker(s2);

    pool.registerWorker(w1);
    pool.registerWorker(w2);

    expect(pool.size).toBe(2);
    expect(pool.getWorker('profile_a')).toBe(w1);
    expect(pool.getWorker('profile_b')).toBe(w2);
    expect(pool.getWorker('profile_unknown')).toBeNull();
  });

  it('getAvailableWorker returns workers with available capacity (load-aware, randomized)', () => {
    const pool = new WorkerPool();
    const s1 = new ProfileSession(createMockProfileConfig('profile_a'));
    const s2 = new ProfileSession(createMockProfileConfig('profile_b'));

    Object.defineProperty(s1, 'isReady', { get: () => true });
    Object.defineProperty(s2, 'isReady', { get: () => true });

    const w1 = new ProfileWorker(s1, 2); // cap=2
    const w2 = new ProfileWorker(s2, 2); // cap=2

    pool.registerWorker(w1);
    pool.registerWorker(w2);

    // Both free → returns one of them (randomized)
    const firstPick = pool.getAvailableWorker();
    expect(firstPick === w1 || firstPick === w2).toBe(true);

    // Assign 1 job to w1 → w1 still has capacity (1 < 2), BOTH workers still available
    w1.assignJob(createMockJob('job_1'));
    // w2 has 0 active (less loaded) → should be preferred over w1 with 1 active
    // But w1 is also available (has remaining capacity). getAvailableWorker returns from least-loaded group.
    const afterOneAssign = pool.getAvailableWorker();
    expect(afterOneAssign).toBe(w2); // w2 is least-loaded (0 vs 1)
    expect(pool.busyCount).toBe(1); // 1 total active job

    // Fill w1 to capacity → w1 not available, w2 is only option
    w1.assignJob(createMockJob('job_2'));
    expect(pool.getAvailableWorker()).toBe(w2);
    expect(pool.busyCount).toBe(2); // 2 total active jobs

    // Assign 1 job to w2 → w2 still has capacity (1 < 2), both workers available again
    w2.assignJob(createMockJob('job_3'));
    // Now w1 is at capacity (2/2), w2 has 1/2 → w2 should be the only available
    expect(pool.getAvailableWorker()).toBe(w2);
    expect(pool.busyCount).toBe(3);

    // Fill w2 to capacity → none available
    w2.assignJob(createMockJob('job_4'));
    expect(pool.getAvailableWorker()).toBeNull();
    expect(pool.busyCount).toBe(4); // all 4 slots occupied

    // Release 1 slot from w1 → w1 available again
    w1.release('job_1');
    expect(pool.getAvailableWorker()).toBe(w1);
    expect(pool.busyCount).toBe(3);
  });

  it('busyCount reports total active job slots, not number of busy workers', () => {
    const pool = new WorkerPool();
    const s1 = new ProfileSession(createMockProfileConfig('profile_a'));
    const w1 = new ProfileWorker(s1, 3); // single worker, cap=3

    Object.defineProperty(s1, 'isReady', { get: () => true });
    pool.registerWorker(w1);

    w1.assignJob(createMockJob('job_1'));
    expect(pool.busyCount).toBe(1); // 1 active slot, not "1 busy worker"

    w1.assignJob(createMockJob('job_2'));
    expect(pool.busyCount).toBe(2); // 2 active slots

    w1.assignJob(createMockJob('job_3'));
    expect(pool.busyCount).toBe(3); // 3 active slots (at capacity)

    w1.release('job_2');
    expect(pool.busyCount).toBe(2);
  });

  it('totalCapacity reports sum of all worker maxConcurrentJobs', () => {
    const pool = new WorkerPool();
    const s1 = new ProfileSession(createMockProfileConfig('profile_a'));
    const s2 = new ProfileSession(createMockProfileConfig('profile_b'));
    const s3 = new ProfileSession(createMockProfileConfig('profile_c'));

    pool.registerWorker(new ProfileWorker(s1, 2));
    pool.registerWorker(new ProfileWorker(s2, 2));
    pool.registerWorker(new ProfileWorker(s3, 2));

    expect(pool.totalCapacity).toBe(6); // 3 profiles × cap 2 = 6 total slots
    expect(pool.size).toBe(3);
  });
});
