/**
 * WatchedFolderCadenceService – Orchestrates the cadence layer ("when should work be processed?").
 *
 * Guarantees:
 *  1. Zero Secondary Scheduler: Dispatches directly to existing WatchedFolderPipelineService,
 *     which feeds the standard ProjectRepository and GenerationScheduler.
 *  2. Supported Cadence Modes:
 *     - 'immediate': Stable/deduped files are ingested immediately without timers.
 *     - 'scheduled': Stable files are held in 'waiting_for_cadence' until daily local time (e.g. 18:00).
 *     - 'interval': Stable files are held and processed according to recurring intervalMinutes.
 *  3. Catch-Up Logic (catchUpMissed):
 *     - If app was closed or machine asleep during a scheduled window, runs once on startup if true.
 *     - If false, safely waits for the next upcoming slot.
 *  4. Publish Delay Separation:
 *     - publishDelayHours decouples media processing time from YouTube native scheduledPublishAt.
 *  5. Multi-Watcher Fairness:
 *     - Interleaves items round-robin across active watchers so no single watcher monopolizes I/O.
 *  6. Resource & State Safety:
 *     - Bounded timers (1 timer per watcher, no per-file timer storms).
 *     - Zero Chrome/browser process startup during cadence evaluation.
 *     - Persisted timestamps (lastCadenceRunAt, nextScheduledRunAt) survive app restarts.
 */

import type {
  WatchedFolderEntity,
  WatchedFileRecord,
} from '../../shared/types';
import { WatchedFolderRepository } from '../storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../storage/WatchedFolderHistoryRepository';
import { WatchedFolderPipelineService } from '../pipeline/WatchedFolderPipelineService';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class WatchedFolderCadenceService {
  private static timers = new Map<string, NodeJS.Timeout>();
  private static inProgressWatchers = new Set<string>();
  private static isInitialized = false;

  /**
   * Resets internal timers and state (useful for tests).
   */
  static resetState(): void {
    this.shutdown();
  }

  /**
   * Initializes cadence service on application startup.
   * Restores active timers and evaluates missed schedules.
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.info('cadence_service', 'WatchedFolderCadenceService is already initialized');
      return;
    }

    logger.info('cadence_service', 'Initializing WatchedFolderCadenceService...');
    this.isInitialized = true;

    try {
      const watchers = await WatchedFolderRepository.getAll();
      for (const watcher of watchers) {
        if (watcher.enabled && watcher.status !== 'paused') {
          await this.syncWatcher(watcher.id);
        }
      }
      logger.info('cadence_service', `WatchedFolderCadenceService initialized. Active timers: ${this.timers.size}`);
    } catch (err: any) {
      logger.error('cadence_service', `Failed to initialize cadence service: ${err.message}`);
    }
  }

  /**
   * Shuts down all active cadence timers cleanly.
   */
  static shutdown(): void {
    logger.info('cadence_service', `Shutting down WatchedFolderCadenceService (${this.timers.size} timers)...`);
    for (const [id, timer] of this.timers.entries()) {
      clearTimeout(timer);
      logger.info('cadence_service', `Cleared cadence timer for watcher ${id}`);
    }
    this.timers.clear();
    this.inProgressWatchers.clear();
    this.isInitialized = false;
    logger.info('cadence_service', 'WatchedFolderCadenceService shutdown complete');
  }

  /**
   * Handles a stable, deduplicated media item emitted by WatchedFolderMonitor.
   */
  static async handleMediaReady(
    record: WatchedFileRecord,
    entity: WatchedFolderEntity
  ): Promise<void> {
    const mode = entity.cadence?.mode || 'immediate';

    if (mode === 'immediate') {
      logger.info('cadence_service', `Immediate mode for watcher "${entity.name}": ingesting "${record.filename}" immediately`);
      await WatchedFolderPipelineService.ingest(record, entity);
      return;
    }

    // For 'scheduled' and 'interval' modes: mark as 'waiting_for_cadence'
    logger.info('cadence_service', `Cadence mode "${mode}" for watcher "${entity.name}": holding "${record.filename}" in waiting_for_cadence`);
    await WatchedFolderHistoryRepository.recordFile(entity.id, {
      ...record,
      status: 'waiting_for_cadence',
    });

    // Ensure watcher timer is armed
    await this.ensureWatcherArmed(entity);
  }

  /**
   * Synchronizes or re-arms cadence scheduling when a watcher is created, modified, paused, or resumed.
   */
  static async syncWatcher(id: string): Promise<void> {
    this.clearWatcherTimer(id);

    const watcher = await WatchedFolderRepository.get(id);
    if (!watcher || !watcher.enabled || watcher.status === 'paused') {
      logger.info('cadence_service', `Watcher ${id} is disabled or paused; cadence timer not scheduled.`);
      return;
    }

    const mode = watcher.cadence?.mode || 'immediate';
    if (mode === 'immediate') {
      // Process any lingering waiting_for_cadence files immediately
      await this.processPendingFiles(id);
      return;
    }

    // Check missed schedule for cold start or resume
    const now = new Date();
    const missed = this.isScheduleMissed(watcher, now);

    if (missed) {
      if (watcher.cadence?.catchUpMissed !== false) {
        logger.info('cadence_service', `Catch-up triggered for watcher "${watcher.name}" (${watcher.id})`);
        await this.processPendingFiles(id);
      } else {
        logger.info('cadence_service', `Missed window skipped for watcher "${watcher.name}" (catchUpMissed is false). Scheduling next window.`);
      }
    }

    // Calculate and arm next scheduled run
    const nextRun = this.calculateNextRun(watcher, now);
    await WatchedFolderRepository.updateCadenceTimestamps(watcher.id, watcher.lastCadenceRunAt, nextRun.toISOString());
    this.armTimer(watcher.id, nextRun);
  }

  /**
   * Removes all cadence timers and state for a deleted watcher.
   */
  static removeWatcher(id: string): void {
    this.clearWatcherTimer(id);
    this.inProgressWatchers.delete(id);
    logger.info('cadence_service', `Removed cadence watcher ${id}`);
  }

  /**
   * Processes pending 'waiting_for_cadence' files for a given watcher.
   */
  static async processPendingFiles(watcherId: string): Promise<number> {
    if (this.inProgressWatchers.has(watcherId)) {
      logger.info('cadence_service', `Cadence execution already in progress for watcher ${watcherId}`);
      return 0;
    }

    this.inProgressWatchers.add(watcherId);

    try {
      const entity = await WatchedFolderRepository.get(watcherId);
      if (!entity || !entity.enabled || entity.status === 'paused') {
        return 0;
      }

      const pendingRecords = await WatchedFolderHistoryRepository.getPendingCadenceRecords(watcherId);
      if (pendingRecords.length === 0) {
        logger.info('cadence_service', `No pending cadence records for watcher "${entity.name}" (${watcherId})`);
        return 0;
      }

      // Sort pending files according to ingestOrder rule (default: oldest_first)
      const order = entity.rules?.ingestOrder || 'oldest_first';
      pendingRecords.sort((a, b) => {
        return order === 'oldest_first'
          ? a.fileMtimeMs - b.fileMtimeMs
          : b.fileMtimeMs - a.fileMtimeMs;
      });

      // Slice batch up to maxBatchSize (default 5)
      const maxBatchSize = entity.rules?.maxBatchSize || 5;
      const batch = pendingRecords.slice(0, maxBatchSize);

      logger.info('cadence_service', `Dispatching cadence batch of ${batch.length} files (out of ${pendingRecords.length} pending) for watcher "${entity.name}"`);

      let processedCount = 0;
      for (const record of batch) {
        try {
          const result = await WatchedFolderPipelineService.ingest(record, entity);
          if (result.success) {
            processedCount++;
          }
        } catch (err: any) {
          logger.error('cadence_service', `Error ingesting record "${record.filename}" in cadence: ${err.message}`);
        }
      }

      // Update lastCadenceRunAt timestamp
      const now = new Date();
      const nextRun = this.calculateNextRun(entity, now);
      await WatchedFolderRepository.updateCadenceTimestamps(watcherId, now.toISOString(), nextRun.toISOString());

      // Re-arm timer for subsequent run
      this.armTimer(watcherId, nextRun);

      return processedCount;
    } finally {
      this.inProgressWatchers.delete(watcherId);
    }
  }

  /**
   * Interleaves and fairly processes pending batches across multiple watchers.
   * Guarantees that no single watcher's backlog can starve other watchers or manual projects.
   */
  static async processMultipleWatchersFairly(watcherIds: string[]): Promise<number> {
    const watcherQueues = new Map<string, { entity: WatchedFolderEntity; records: WatchedFileRecord[] }>();

    for (const wid of watcherIds) {
      const entity = await WatchedFolderRepository.get(wid);
      if (entity && entity.enabled && entity.status !== 'paused') {
        const records = await WatchedFolderHistoryRepository.getPendingCadenceRecords(wid);
        const order = entity.rules?.ingestOrder || 'oldest_first';
        records.sort((a, b) => (order === 'oldest_first' ? a.fileMtimeMs - b.fileMtimeMs : b.fileMtimeMs - a.fileMtimeMs));
        const maxBatch = entity.rules?.maxBatchSize || 5;
        watcherQueues.set(wid, { entity, records: records.slice(0, maxBatch) });
      }
    }

    let totalProcessed = 0;
    let hasMore = true;

    // Round-robin interleaving: pop 1 item per watcher in cycles
    while (hasMore) {
      hasMore = false;
      for (const [wid, queue] of watcherQueues.entries()) {
        if (queue.records.length > 0) {
          hasMore = true;
          const record = queue.records.shift()!;
          try {
            await WatchedFolderPipelineService.ingest(record, queue.entity);
            totalProcessed++;
          } catch (err: any) {
            logger.error('cadence_service', `Fair dispatch error for watcher ${wid}: ${err.message}`);
          }
        }
      }
    }

    return totalProcessed;
  }

  // ---------------------------------------------------------------------------
  // Date & Scheduling Calculation Helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculates the next upcoming Date for a watcher's cadence.
   */
  static calculateNextRun(entity: WatchedFolderEntity, referenceDate: Date): Date {
    const mode = entity.cadence?.mode || 'immediate';

    if (mode === 'scheduled') {
      const dailyTime = entity.cadence?.dailyTime || '18:00';
      const [hours, minutes] = dailyTime.split(':').map(Number);
      const validH = isNaN(hours) ? 18 : Math.max(0, Math.min(23, hours));
      const validM = isNaN(minutes) ? 0 : Math.max(0, Math.min(59, minutes));

      const target = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        referenceDate.getDate(),
        validH,
        validM,
        0,
        0
      );

      // If today's slot has already passed, schedule for tomorrow
      if (target.getTime() <= referenceDate.getTime()) {
        target.setDate(target.getDate() + 1);
      }

      return target;
    }

    if (mode === 'interval') {
      const intervalMinutes = Math.max(1, entity.cadence?.intervalMinutes || 60);
      const intervalMs = intervalMinutes * 60 * 1000;

      if (entity.lastCadenceRunAt) {
        const lastRunMs = new Date(entity.lastCadenceRunAt).getTime();
        const nextMs = lastRunMs + intervalMs;
        if (nextMs > referenceDate.getTime()) {
          return new Date(nextMs);
        }
      }

      return new Date(referenceDate.getTime() + intervalMs);
    }

    // Default immediate: return now
    return referenceDate;
  }

  /**
   * Checks if a scheduled or interval run was missed while the system was offline.
   */
  static isScheduleMissed(entity: WatchedFolderEntity, now: Date): boolean {
    const mode = entity.cadence?.mode || 'immediate';

    if (mode === 'scheduled') {
      const dailyTime = entity.cadence?.dailyTime || '18:00';
      const [hours, minutes] = dailyTime.split(':').map(Number);
      const validH = isNaN(hours) ? 18 : Math.max(0, Math.min(23, hours));
      const validM = isNaN(minutes) ? 0 : Math.max(0, Math.min(59, minutes));

      const todaySlot = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        validH,
        validM,
        0,
        0
      );

      // Did today's slot already pass?
      if (now.getTime() >= todaySlot.getTime()) {
        // Was it already executed today?
        if (!entity.lastCadenceRunAt) {
          return true;
        }
        const lastRunTime = new Date(entity.lastCadenceRunAt).getTime();
        if (lastRunTime < todaySlot.getTime()) {
          return true;
        }
      }
      return false;
    }

    if (mode === 'interval') {
      if (!entity.lastCadenceRunAt) {
        return false;
      }
      const intervalMinutes = Math.max(1, entity.cadence?.intervalMinutes || 60);
      const intervalMs = intervalMinutes * 60 * 1000;
      const elapsed = now.getTime() - new Date(entity.lastCadenceRunAt).getTime();
      return elapsed >= intervalMs;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Internal Timer Arming
  // ---------------------------------------------------------------------------

  private static async ensureWatcherArmed(entity: WatchedFolderEntity): Promise<void> {
    if (this.timers.has(entity.id)) return;

    const now = new Date();
    const nextRun = this.calculateNextRun(entity, now);
    await WatchedFolderRepository.updateCadenceTimestamps(entity.id, entity.lastCadenceRunAt, nextRun.toISOString());
    this.armTimer(entity.id, nextRun);
  }

  private static armTimer(watcherId: string, targetDate: Date): void {
    this.clearWatcherTimer(watcherId);

    const now = Date.now();
    const delayMs = Math.max(10, targetDate.getTime() - now);

    // Bounded maximum setTimeout to avoid 32-bit integer overflow (max ~24.8 days)
    const safeDelay = Math.min(delayMs, 2147483647);

    logger.info('cadence_service', `Arming cadence timer for watcher ${watcherId} in ${Math.round(safeDelay / 1000)}s (target: ${targetDate.toISOString()})`);

    const timer = setTimeout(async () => {
      this.timers.delete(watcherId);
      try {
        await this.processPendingFiles(watcherId);
      } catch (err: any) {
        logger.error('cadence_service', `Unhandled error in cadence timer for watcher ${watcherId}: ${err.message}`);
      }
    }, safeDelay);

    this.timers.set(watcherId, timer);
  }

  private static clearWatcherTimer(watcherId: string): void {
    const existing = this.timers.get(watcherId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(watcherId);
    }
  }
}
