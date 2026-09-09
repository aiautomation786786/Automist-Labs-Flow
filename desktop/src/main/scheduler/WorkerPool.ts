/**
 * WorkerPool – Registry and manager for all active ProfileWorker instances.
 *
 * MULTI-SLOT CONCURRENCY:
 *  Each ProfileWorker can hold up to MAX_CONCURRENT_JOBS_PER_PROFILE simultaneous jobs.
 *  getAvailableWorker() returns any worker that still has remaining capacity
 *  (activeJobCount < maxConcurrentJobs), enabling multiple jobs to run on the same
 *  profile simultaneously — each on its own isolated Flow Page.
 *
 *  Load-aware selection:
 *   - Among all eligible workers, those with the fewest active jobs are preferred.
 *   - Ties within the least-loaded group are broken by Fisher-Yates shuffle (uniform random).
 *   - This spreads load across profiles before overloading any single profile.
 *
 * busyCount:
 *  Returns the TOTAL number of active job slots across all workers, not a count of workers.
 *  This is the correct signal for concurrency-level reporting (e.g. slot utilisation).
 */

import { ProfileWorker } from './ProfileWorker';
import { ProfileSessionManager } from '../engine/ProfileSessionManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';
import { ConcurrencyConfig } from './ConcurrencyConfig';
import type { SchedulerCapacityMetrics, QuarantineRecord } from '../../shared/types';

const logger = new AppLogger({ mirrorToStderr: false });

export class WorkerPool {
  private workers: Map<string, ProfileWorker> = new Map();
  private sessionManager: ProfileSessionManager | null = null;
  private quarantinedProfiles: Map<string, QuarantineRecord> = new Map();

  constructor(sessionManager?: ProfileSessionManager) {
    if (sessionManager) {
      this.attachSessionManager(sessionManager);
    }
  }

  /**
   * Connects this pool to a ProfileSessionManager to auto-discover sessions.
   */
  attachSessionManager(sessionManager: ProfileSessionManager): void {
    this.sessionManager = sessionManager;

    this.sessionManager.on('session:ready', (profileId) => {
      this.syncWithSessionManager();
      generationEventBus.emitTyped('worker:available', profileId);
      logger.info('worker_pool', `session:ready received for ${profileId}; worker pool synced and worker:available emitted`);
    });

    this.sessionManager.on('session:status', (snapshot) => {
      if (snapshot.status === 'ready') {
        this.syncWithSessionManager();
        generationEventBus.emitTyped('worker:available', snapshot.profileId);
      } else if (snapshot.status === 'error' || snapshot.status === 'stopped' || snapshot.status === 'auth_required') {
        const worker = this.workers.get(snapshot.profileId);
        if (worker) {
          worker.markError(snapshot.errorMessage || `Session status: ${snapshot.status}`);
          logger.warn('worker_pool', `Profile ${snapshot.profileId} status changed to ${snapshot.status}; marked unavailable`);
        }
      }
    });

    this.sessionManager.on('session:error', (profileId, message) => {
      const worker = this.workers.get(profileId);
      if (worker) {
        worker.markError(message || 'Session error');
        logger.warn('worker_pool', `Profile ${profileId} encountered error; marked unavailable`);
      }
    });

    this.sessionManager.on('session:crash', (profileId) => {
      const worker = this.workers.get(profileId);
      if (worker) {
        worker.markError('Chrome browser process crashed');
        logger.warn('worker_pool', `Profile ${profileId} crashed; marked unavailable`);
      }
    });

    this.sessionManager.on('profile:deleted', (profileId) => {
      this.workers.delete(profileId);
      logger.info('worker_pool', `profile:deleted received for ${profileId}; removed worker from pool`);
    });

    this.syncWithSessionManager();
  }

  /**
   * Registers a worker instance directly (useful for tests and manual management).
   */
  registerWorker(worker: ProfileWorker): void {
    this.workers.set(worker.profileId, worker);
    logger.info('worker_pool', `Registered worker ${worker.profileId} (cap=${worker.maxConcurrentJobs})`);
  }

  /**
   * Retrieves a specific worker by profileId.
   */
  getWorker(profileId: string): ProfileWorker | null {
    return this.workers.get(profileId) ?? null;
  }

  /**
   * Synchronizes the pool with active sessions in ProfileSessionManager.
   * Discovers newly ready profiles and automatically adds them to the pool
   * with the single source of truth capacity from ConcurrencyConfig.
   */
  syncWithSessionManager(sessionManager?: ProfileSessionManager): void {
    if (sessionManager) {
      this.attachSessionManager(sessionManager);
    }
    if (!this.sessionManager) return;

    const allSnapshots = this.sessionManager.getAllProfiles();
    const targetCap = ConcurrencyConfig.maxConcurrentJobsPerProfile;

    for (const snap of allSnapshots) {
      if (snap.status === 'ready') {
        const existing = this.workers.get(snap.profileId);
        if (!existing) {
          const session = this.sessionManager.getSession(snap.profileId);
          if (session) {
            const worker = new ProfileWorker(session, targetCap);
            this.workers.set(snap.profileId, worker);
            logger.info('worker_pool', `Created ProfileWorker for active session: ${snap.profileId} (cap=${targetCap})`);
          }
        } else if (existing.state === 'error') {
          existing.resetError();
          logger.info('worker_pool', `Restored healthy ready state for ProfileWorker: ${snap.profileId}`);
        }
      }
    }
  }

  /**
   * Quarantines a profile due to credit or quota exhaustion.
   * Excludes it from new assignments while allowing running jobs to complete.
   */
  quarantineProfile(
    profileId: string,
    reason: 'credit_exhausted' | 'quota_exhausted',
    ttlMs = 3600000,
    detail?: string
  ): void {
    const now = Date.now();
    this.quarantinedProfiles.set(profileId, {
      profileId,
      reason,
      quarantinedAt: now,
      quarantineUntil: now + ttlMs,
      detail,
    });
    logger.warn('worker_pool', `Quarantined profile ${profileId} for ${ttlMs / 1000}s due to ${reason}: ${detail || 'no details'}`);
  }

  /**
   * Checks if a profile is actively quarantined.
   * When quarantine expires, verifies session health before lifting.
   */
  isQuarantined(profileId: string): boolean {
    const record = this.quarantinedProfiles.get(profileId);
    if (!record) return false;
    if (Date.now() > record.quarantineUntil) {
      const worker = this.workers.get(profileId);
      if (worker && worker.state !== 'error') {
        this.quarantinedProfiles.delete(profileId);
        logger.info('worker_pool', `Quarantine expired for profile ${profileId}; verified healthy and returned to eligibility`);
        return false;
      }
      return true;
    }
    return true;
  }

  /**
   * Manually lifts quarantine for a profile.
   */
  liftQuarantine(profileId: string): void {
    this.quarantinedProfiles.delete(profileId);
    logger.info('worker_pool', `Quarantine manually lifted for profile ${profileId}`);
  }

  /**
   * Returns all active quarantine records.
   */
  getQuarantinedProfiles(): QuarantineRecord[] {
    for (const id of Array.from(this.quarantinedProfiles.keys())) {
      this.isQuarantined(id);
    }
    return Array.from(this.quarantinedProfiles.values());
  }

  /**
   * Returns a worker that has remaining capacity, using load-aware randomized selection.
   *
   * SELECTION STRATEGY:
   *  1. Build the set of eligible workers: those where `isAvailable` is true
   *     (activeJobCount < maxConcurrentJobs, not in error, session ready, and NOT quarantined).
   *  2. Among eligible workers, identify the minimum current active job count (least loaded).
   *  3. Restrict candidates to the least-loaded group (spread load before piling up).
   *  4. Apply Fisher-Yates shuffle within the least-loaded group for uniform random selection.
   *  5. Return the first element from the shuffled group.
   */
  getAvailableWorker(allowedProfileIds?: string[]): ProfileWorker | null {
    this.syncWithSessionManager();

    const overrideProfileId = process.env.FLOW_TEST_PROFILE_OVERRIDE;
    const effectiveAllowed = overrideProfileId ? [overrideProfileId] : allowedProfileIds;
    const allowedSet = effectiveAllowed && effectiveAllowed.length > 0 ? new Set(effectiveAllowed) : null;

    // Step 1: Build eligible list (workers with remaining capacity and NOT quarantined)
    const eligible: ProfileWorker[] = [];
    for (const worker of this.workers.values()) {
      if (allowedSet && !allowedSet.has(worker.profileId)) continue;
      if (this.isQuarantined(worker.profileId)) continue;
      if (worker.isAvailable) eligible.push(worker);
    }

    if (eligible.length === 0) return null;

    // Step 2: Find minimum load (prefer workers with fewest active jobs)
    const minLoad = Math.min(...eligible.map((w) => w.activeJobCount));

    // Step 3: Restrict to least-loaded group
    const leastLoaded = eligible.filter((w) => w.activeJobCount === minLoad);

    // Step 4: Fisher-Yates shuffle within least-loaded group
    for (let i = leastLoaded.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [leastLoaded[i], leastLoaded[j]] = [leastLoaded[j]!, leastLoaded[i]!];
    }

    return leastLoaded[0]!;
  }

  /**
   * Returns all workers in the pool.
   */
  getAllWorkers(): ProfileWorker[] {
    return Array.from(this.workers.values());
  }

  /**
   * Total count of active job slots across all workers.
   * This reflects true concurrent execution count, not merely the number of busy workers.
   *
   * Example: 2 profiles × 2 active jobs each → busyCount = 4
   */
  get busyCount(): number {
    return Array.from(this.workers.values()).reduce((sum, w) => sum + w.activeJobCount, 0);
  }

  /**
   * Total configured capacity across all workers (sum of maxConcurrentJobs).
   */
  get totalCapacity(): number {
    return Array.from(this.workers.values()).reduce((sum, w) => sum + w.maxConcurrentJobs, 0);
  }

  /**
   * Total number of worker profiles registered.
   */
  get size(): number {
    return this.workers.size;
  }

  /**
   * Returns live capacity metrics across all profiles and execution contexts.
   */
  getCapacityMetrics(pendingJobs = 0): SchedulerCapacityMetrics {
    this.syncWithSessionManager();
    const allWorkers = Array.from(this.workers.values());
    const totalProfiles = this.sessionManager ? this.sessionManager.getAllProfiles().length : allWorkers.length;
    const readyProfiles = allWorkers.filter((w) => (w.isAvailable || (w.isBusy && !w.lastError)) && w.state !== 'error').length;
    const busyProfiles = allWorkers.filter((w) => w.isBusy).length;
    const errorProfiles = allWorkers.filter((w) => w.state === 'error').length;
    const totalCapacity = allWorkers
      .filter((w) => w.state !== 'error')
      .reduce((sum, w) => sum + w.maxConcurrentJobs, 0);
    const activeJobs = allWorkers.reduce((sum, w) => sum + w.activeJobCount, 0);
    const availableCapacity = Math.max(0, totalCapacity - activeJobs);

    return {
      totalProfiles,
      readyProfiles,
      busyProfiles,
      errorProfiles,
      totalCapacity,
      activeJobs,
      availableCapacity,
      pendingJobs,
    };
  }

  /**
   * Clears all workers (used for teardown / test resets).
   */
  clear(): void {
    this.workers.clear();
  }
}
