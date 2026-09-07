/**
 * Tests for ProfileWorker & WorkerPool.
 *
 * Verifies:
 *  - One-job-per-profile hard constraint (throws if assigned while busy).
 *  - Worker state lifecycle: idle -> busy -> release / error -> reset.
 *  - Multi-worker registration and FIFO worker allocation in WorkerPool.
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

describe('ProfileWorker', () => {
  it('should initialize with idle state and not busy', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);

    expect(worker.profileId).toBe('profile_1');
    expect(worker.isBusy).toBe(false);
    expect(worker.currentJob).toBeNull();
    expect(worker.state).toBe('idle');
  });

  it('assignJob should set busy state and currentJob', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);
    const job = createMockJob('job_1');

    worker.assignJob(job);

    expect(worker.isBusy).toBe(true);
    expect(worker.state).toBe('busy');
    expect(worker.currentJob).toBe(job);
  });

  it('HARD CONCURRENCY GUARANTEE: assignJob throws when already busy', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);
    const job1 = createMockJob('job_1');
    const job2 = createMockJob('job_2');

    worker.assignJob(job1);

    expect(() => worker.assignJob(job2)).toThrow(/One-job-per-profile violation prevented/);
    expect(worker.currentJob).toBe(job1);
  });

  it('release should clear currentJob and restore idle state', () => {
    const session = new ProfileSession(createMockProfileConfig('profile_1'));
    const worker = new ProfileWorker(session);
    const job = createMockJob('job_1');

    worker.assignJob(job);
    expect(worker.isBusy).toBe(true);

    worker.release();
    expect(worker.isBusy).toBe(false);
    expect(worker.currentJob).toBeNull();
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
    expect(worker.currentJob).toBeNull();

    worker.resetError();
    expect(worker.state).toBe('idle');
    expect(worker.lastError).toBeNull();
  });
});

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

  it('getAvailableWorker should return next idle and ready worker in FIFO order', () => {
    const pool = new WorkerPool();
    const s1 = new ProfileSession(createMockProfileConfig('profile_a'));
    const s2 = new ProfileSession(createMockProfileConfig('profile_b'));

    // Mock session readiness
    Object.defineProperty(s1, 'isReady', { get: () => true });
    Object.defineProperty(s2, 'isReady', { get: () => true });

    const w1 = new ProfileWorker(s1);
    const w2 = new ProfileWorker(s2);

    pool.registerWorker(w1);
    pool.registerWorker(w2);

    // Both free -> returns first (w1)
    expect(pool.getAvailableWorker()).toBe(w1);

    // Assign job to w1 -> returns w2
    w1.assignJob(createMockJob('job_1'));
    expect(pool.getAvailableWorker()).toBe(w2);
    expect(pool.busyCount).toBe(1);

    // Assign job to w2 -> returns null (all busy)
    w2.assignJob(createMockJob('job_2'));
    expect(pool.getAvailableWorker()).toBeNull();
    expect(pool.busyCount).toBe(2);

    // Release w1 -> returns w1 again
    w1.release();
    expect(pool.getAvailableWorker()).toBe(w1);
    expect(pool.busyCount).toBe(1);
  });
});
