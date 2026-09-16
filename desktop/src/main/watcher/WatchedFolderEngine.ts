/**
 * WatchedFolderEngine – Central lifecycle supervisor for watched folder background monitoring.
 *
 * Guarantees:
 *  1. Singleton Supervisor: Manages 1 WatchedFolderMonitor per enabled watched folder.
 *  2. Clean Lifecycle: Initializes on app startup; gracefully halts all timers on shutdown.
 *  3. Dynamic Synchronization: Automatically starts, updates, pauses, or stops monitors upon IPC events.
 *  4. Event Forwarding: Forwards detection and stability events to renderer via GenerationEventBus or IPC.
 *  5. Pipeline Seam: Provides a clean onMediaReady handoff hook for Phase 4C pipeline ingestion.
 */

import type {
  WatchedFolderEntity,
  WatchedFileRecord,
} from '../../shared/types';
import { WatchedFolderRepository } from '../storage/WatchedFolderRepository';
import { WatchedFolderMonitor, type WatchedFolderMonitorOptions } from './WatchedFolderMonitor';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export type MediaReadyHandler = (record: WatchedFileRecord, entity: WatchedFolderEntity) => Promise<void> | void;
export type WatcherEventHandler = (eventName: string, payload: unknown) => void;

export class WatchedFolderEngine {
  private static instance: WatchedFolderEngine | null = null;

  private monitors = new Map<string, WatchedFolderMonitor>();
  private mediaReadyHandler: MediaReadyHandler | null = null;
  private eventHandler: WatcherEventHandler | null = null;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): WatchedFolderEngine {
    if (!this.instance) {
      this.instance = new WatchedFolderEngine();
    }
    return this.instance;
  }

  /**
   * Resets the singleton instance (useful for unit tests).
   */
  static resetInstance(): void {
    if (this.instance) {
      this.instance.shutdown();
      this.instance = null;
    }
  }

  /**
   * Configures the handoff callback when media is stabilized and ready for pipeline ingestion.
   */
  setMediaReadyHandler(handler: MediaReadyHandler): void {
    this.mediaReadyHandler = handler;
  }

  /**
   * Configures event dispatcher to notify UI/renderer of watcher activities.
   */
  setEventHandler(handler: WatcherEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Initializes the engine on application startup.
   * Restores all enabled, non-paused watchers and starts their background monitors.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.info('watcher_engine', 'WatchedFolderEngine is already initialized');
      return;
    }

    logger.info('watcher_engine', 'Initializing WatchedFolderEngine...');
    this.isInitialized = true;

    try {
      const watchers = await WatchedFolderRepository.getAll();
      for (const watcher of watchers) {
        if (watcher.enabled && watcher.status !== 'paused') {
          this.startMonitor(watcher);
        }
      }
      logger.info('watcher_engine', `WatchedFolderEngine initialized. Active monitors: ${this.monitors.size}`);
    } catch (err: any) {
      logger.error('watcher_engine', `Failed to initialize watched folders: ${err.message}`);
    }
  }

  /**
   * Shuts down all running monitors and cancels all timers.
   */
  shutdown(): void {
    logger.info('watcher_engine', `Shutting down WatchedFolderEngine (${this.monitors.size} monitors)...`);
    for (const monitor of this.monitors.values()) {
      try {
        monitor.stop();
      } catch (err: any) {
        logger.warn('watcher_engine', `Error stopping monitor ${monitor.watcherId}: ${err.message}`);
      }
    }
    this.monitors.clear();
    this.isInitialized = false;
    logger.info('watcher_engine', 'WatchedFolderEngine shutdown complete');
  }

  /**
   * Synchronizes a watcher monitor when its entity is created or modified.
   */
  async syncWatcher(id: string): Promise<void> {
    const watcher = await WatchedFolderRepository.get(id);

    if (!watcher || !watcher.enabled || watcher.status === 'paused') {
      this.removeWatcher(id);
      return;
    }

    const existing = this.monitors.get(id);
    if (existing) {
      existing.updateEntity(watcher);
    } else {
      this.startMonitor(watcher);
    }
  }

  /**
   * Pauses or resumes a watcher monitor.
   */
  async setPaused(id: string, _paused: boolean): Promise<void> {
    await this.syncWatcher(id);
  }

  /**
   * Removes and stops a watcher monitor.
   */
  removeWatcher(id: string): void {
    const monitor = this.monitors.get(id);
    if (monitor) {
      monitor.stop();
      this.monitors.delete(id);
      logger.info('watcher_engine', `Removed monitor for watcher ${id}`);
    }
  }

  /**
   * Retrieves a specific running monitor.
   */
  getMonitor(id: string): WatchedFolderMonitor | undefined {
    return this.monitors.get(id);
  }

  /**
   * Returns list of currently active watcher IDs.
   */
  getRunningWatchers(): string[] {
    return Array.from(this.monitors.keys());
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private startMonitor(entity: WatchedFolderEntity): void {
    const options: WatchedFolderMonitorOptions = {
      pollIntervalMs: 5000,
      onMediaReady: async (record, watchedEntity) => {
        this.eventHandler?.('flow:watchedFolder:mediaReady', { record, watcherId: watchedEntity.id });
        if (this.mediaReadyHandler) {
          await this.mediaReadyHandler(record, watchedEntity);
        }
      },
      onEvent: (eventName, payload) => {
        this.eventHandler?.(eventName, payload);
      },
    };

    const monitor = new WatchedFolderMonitor(entity, options);
    this.monitors.set(entity.id, monitor);
    monitor.start();
  }
}
