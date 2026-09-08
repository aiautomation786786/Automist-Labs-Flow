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
import { MAX_CONCURRENT_JOBS_PER_PROFILE } from './ConcurrencyConfig';

const logger = new AppLogger({ mirrorToStderr: false });

export class WorkerPool {
  private workers: Map<string, ProfileWorker> = new Map();
  private sessionManager: ProfileSessionManager | null = null;

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
   * Synchronizes the pool with the active sessions in ProfileSessionManager.
   * Instantiates a ProfileWorker for any newly started profile session.
   * Workers are created with the global MAX_CONCURRENT_JOBS_PER_PROFILE cap.
   */
  syncWithSessionManager(): void {
    if (!this.sessionManager) return;

    const allSnapshots = this.sessionManager.getAllProfiles();
    for (const snap of allSnapshots) {
      if (snap.status === 'ready' && !this.workers.has(snap.profileId)) {
        const session = this.sessionManager.getSession(snap.profileId);
        if (session) {
          const worker = new ProfileWorker(session, MAX_CONCURRENT_JOBS_PER_PROFILE);
          this.workers.set(snap.profileId, worker);
          logger.info('worker_pool', `Created ProfileWorker for active session: ${snap.profileId} (cap=${MAX_CONCURRENT_JOBS_PER_PROFILE})`);
        }
      }
    }
  }

  /**
   * Returns a worker that has remaining capacity, using load-aware randomized selection.
   *
   * SELECTION STRATEGY:
   *  1. Build the set of eligible workers: those where `isAvailable` is true
   *     (activeJobCount < maxConcurrentJobs, not in error, session ready).
   *  2. Among eligible workers, identify the minimum current active job count (least loaded).
   *  3. Restrict candidates to the least-loaded group (spread load before piling up).
   *  4. Apply Fisher-Yates shuffle within the least-loaded group for uniform random selection.
   *  5. Return the first element from the shuffled group.
   *
   * This ensures:
   *  - A profile with 0 active jobs is always preferred over one with 1 active job.
   *  - Among equally-loaded profiles, selection is uniform random (no sticky preference).
   *  - The same profile CAN be returned twice in successive calls (if it still has capacity).
   */
  getAvailableWorker(allowedProfileIds?: string[]): ProfileWorker | null {
    this.syncWithSessionManager();

    const allowedSet = allowedProfileIds && allowedProfileIds.length > 0 ? new Set(allowedProfileIds) : null;

    // Step 1: Build eligible list (workers with remaining capacity)
    const eligible: ProfileWorker[] = [];
    for (const worker of this.workers.values()) {
      if (allowedSet && !allowedSet.has(worker.profileId)) continue;
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
   * Clears all workers (used for teardown / test resets).
   */
  clear(): void {
    this.workers.clear();
  }
}
