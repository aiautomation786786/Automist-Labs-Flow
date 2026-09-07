import { describe, it, expect, vi } from 'vitest';
import { ProfileSession } from '../main/engine/ProfileSession';
import { FlowAutomationSession } from '../main/engine/FlowAutomationSession';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import type { ProfileConfig } from '../shared/types';

describe('Multi-Profile Isolation & Fair Scheduling', () => {
  function makeConfig(id: string, port: number): ProfileConfig {
    return {
      profileId: id,
      displayName: `Worker Profile ${id}`,
      userDataDir: `C:\\AppData\\Local\\GoogleFlowApp\\profiles\\${id}\\chrome-user-data`,
      chromeProfileName: 'Default',
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      cdpPort: port,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flowUrlLocale: null,
      detectedEmail: `${id}@example.com`,
      notes: '',
    };
  }

  it('proves Profile A and Profile B have isolated CDP ports, user directories, and separate sessions', () => {
    const configA = makeConfig('prof_alpha', 9222);
    const configB = makeConfig('prof_beta', 9223);

    // Assert strict configuration isolation
    expect(configA.cdpPort).not.toBe(configB.cdpPort);
    expect(configA.userDataDir).not.toBe(configB.userDataDir);
    expect(configA.profileId).not.toBe(configB.profileId);

    const sessionA = new ProfileSession(configA);
    const sessionB = new ProfileSession(configB);

    expect(sessionA.profileId).toBe('prof_alpha');
    expect(sessionB.profileId).toBe('prof_beta');
    expect(sessionA).not.toBe(sessionB);

    const autoA = new FlowAutomationSession(sessionA);
    const autoB = new FlowAutomationSession(sessionB);

    expect(autoA.profileId).toBe('prof_alpha');
    expect(autoB.profileId).toBe('prof_beta');
    expect(autoA).not.toBe(autoB);
  });

  it('enforces one-job-per-profile invariant and fair worker allocation in WorkerPool', async () => {
    const sessionA = new ProfileSession(makeConfig('prof_worker_1', 9222));
    const sessionB = new ProfileSession(makeConfig('prof_worker_2', 9223));

    // Mark sessions ready
    Object.defineProperty(sessionA, 'isReady', { get: () => true });
    Object.defineProperty(sessionB, 'isReady', { get: () => true });

    const workerA = new ProfileWorker(sessionA);
    const workerB = new ProfileWorker(sessionB);

    const mockSessionMgr = {
      getReadySessions: vi.fn().mockReturnValue([sessionA, sessionB]),
      getSession: vi.fn((id: string) => (id === 'prof_worker_1' ? sessionA : sessionB)),
    } as any;

    const pool = new WorkerPool();
    pool.registerWorker(workerA);
    pool.registerWorker(workerB);

    // Initial state: 2 workers, 0 busy
    expect(pool.size).toBe(2);
    expect(pool.busyCount).toBe(0);

    // Claim worker A
    const claimedA = pool.getAvailableWorker();
    expect(claimedA).toBeDefined();
    claimedA?.assignJob({ jobId: 'job_first_assign', projectId: 'p1', slotIndex: 0 } as any);
    expect(claimedA?.isBusy).toBe(true);
    expect(pool.busyCount).toBe(1);

    // Worker A cannot accept a second job while busy (one-job-per-profile invariant)
    expect(() => {
      claimedA?.assignJob({ jobId: 'job_double_assign_violation', projectId: 'p1', slotIndex: 1 } as any);
    }).toThrow(/One-job-per-profile violation prevented/i);

    // Only 1 worker available (Worker B)
    const claimedB = pool.getAvailableWorker();
    expect(claimedB).toBeDefined();
    expect(claimedB?.profileId).not.toBe(claimedA?.profileId);
    claimedB?.assignJob({ jobId: 'job_second_assign', projectId: 'p1', slotIndex: 2 } as any);
    expect(pool.busyCount).toBe(2);

    // Now 0 workers available
    expect(pool.getAvailableWorker()).toBeNull();

    // Release worker A
    claimedA?.release();
    expect(claimedA?.isBusy).toBe(false);
    expect(pool.busyCount).toBe(1);

    // Next available job goes to worker A
    const nextClaim = pool.getAvailableWorker();
    expect(nextClaim?.profileId).toBe(claimedA?.profileId);

    // Clean up
    claimedB?.release();
    pool.clear();
  });
});
