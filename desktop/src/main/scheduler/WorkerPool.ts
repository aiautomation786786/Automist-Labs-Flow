/**
 * WorkerPool – Registry and manager for all active ProfileWorker instances.
 *
 * Coordinates dynamic worker discovery from ProfileSessionManager and provides
 * worker allocation (FIFO / least-busy).
 */

import { ProfileWorker } from './ProfileWorker';
import { ProfileSessionManager } from '../engine/ProfileSessionManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';

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
    logger.info('worker_pool', `Registered worker ${worker.profileId}`);
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
   */
  syncWithSessionManager(): void {
    if (!this.sessionManager) return;

    const allSnapshots = this.sessionManager.getAllProfiles();
    for (const snap of allSnapshots) {
      if (snap.status === 'ready' && !this.workers.has(snap.profileId)) {
        const session = this.sessionManager.getSession(snap.profileId);
        if (session) {
          const worker = new ProfileWorker(session);
          this.workers.set(snap.profileId, worker);
          logger.info('worker_pool', `Created ProfileWorker for active session: ${snap.profileId}`);
        }
      }
    }
  }

  /**
   * Returns the next available, idle, and connected worker.
   * Uses FIFO ordering based on registration.
   */
  getAvailableWorker(allowedProfileIds?: string[]): ProfileWorker | null {
    this.syncWithSessionManager();

    const allowedSet = allowedProfileIds && allowedProfileIds.length > 0 ? new Set(allowedProfileIds) : null;

    for (const worker of this.workers.values()) {
      if (allowedSet && !allowedSet.has(worker.profileId)) {
        continue;
      }
      if (worker.isAvailable) {
        return worker;
      }
    }

    return null;
  }

  /**
   * Returns all workers in the pool.
   */
  getAllWorkers(): ProfileWorker[] {
    return Array.from(this.workers.values());
  }

  /**
   * Returns count of currently busy workers.
   */
  get busyCount(): number {
    return Array.from(this.workers.values()).filter((w) => w.isBusy).length;
  }

  /**
   * Total number of workers registered.
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
