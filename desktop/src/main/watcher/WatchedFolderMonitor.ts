/**
 * WatchedFolderMonitor – Autonomous per-folder background monitor and media stability detector.
 *
 * Guarantees:
 *  1. Lightweight Polling: Non-blocking setTimeout loop; zero Chrome/browser footprint.
 *  2. Media Detection: Filters for supported video extensions (.mp4, .mov, .mkv), ignoring junk/temp/downloads.
 *  3. File Stability Detection: Verifies file size & mtime remain unchanged for stabilityDurationMs (default 20s).
 *     Does NOT read entire file into RAM to determine stability.
 *  4. Strict Deduplication: Checks cheap metadata first, followed by streaming SHA-256 against Phase 4A ledger.
 *  5. Distinct Lifecycle States: Distinguishes 'stabilizing' -> 'ready' -> 'processing' -> 'ingested'.
 *  6. Race Protection: Guards files with an in-memory lock set so concurrent scans never ingest the same file twice.
 *  7. Bounded Error Backoff: Automatically backs off polling on folder access errors up to 60s max.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  WatchedFolderEntity,
  WatchedFileRecord,
} from '../../shared/types';
import { SUPPORTED_IMPORT_EXTENSIONS, MediaImportService } from '../import/MediaImportService';
import { WatchedFolderRepository } from '../storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../storage/WatchedFolderHistoryRepository';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export const TEMPORARY_FILE_EXTENSIONS = [
  '.tmp',
  '.crdownload',
  '.part',
  '.!ut',
  '.downloading',
  '.partial',
  '.aria2',
] as const;

export interface StabilityState {
  firstSeenMs: number;
  lastCheckedMs: number;
  size: number;
  mtimeMs: number;
}

export interface WatchedFolderMonitorOptions {
  pollIntervalMs?: number;
  onMediaReady?: (record: WatchedFileRecord, entity: WatchedFolderEntity) => Promise<void> | void;
  onEvent?: (eventName: string, payload: unknown) => void;
}

export class WatchedFolderMonitor {
  private entity: WatchedFolderEntity;
  private options: WatchedFolderMonitorOptions;
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private isRunning = false;
  private consecutiveErrors = 0;

  // In-memory stability tracking: filePath -> StabilityState
  private stabilityMap = new Map<string, StabilityState>();

  // In-flight processing lock to protect against race conditions
  private inFlightFiles = new Set<string>();

  constructor(entity: WatchedFolderEntity, options: WatchedFolderMonitorOptions = {}) {
    this.entity = { ...entity };
    this.options = {
      pollIntervalMs: 5000,
      ...options,
    };
  }

  get watcherId(): string {
    return this.entity.id;
  }

  get currentStatus(): WatchedFolderEntity['status'] {
    return this.entity.status;
  }

  get isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Updates monitor configuration in-place.
   */
  updateEntity(updated: WatchedFolderEntity): void {
    const prevFolder = this.entity.folderPath;
    this.entity = { ...updated };

    if (prevFolder !== updated.folderPath) {
      // Clear stability map if folder changed
      this.stabilityMap.clear();
      this.inFlightFiles.clear();
    }

    if (!this.entity.enabled || this.entity.status === 'paused') {
      this.stop();
    } else if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Starts monitoring the folder.
   */
  start(): void {
    if (this.isRunning) return;
    if (!this.entity.enabled || this.entity.status === 'paused') {
      logger.info('watcher_monitor', `Cannot start watcher "${this.entity.name}" (${this.watcherId}) because it is disabled or paused`);
      return;
    }

    this.isRunning = true;
    this.consecutiveErrors = 0;
    logger.info('watcher_monitor', `Starting watcher monitor for "${this.entity.name}" (${this.watcherId}) at ${this.entity.folderPath}`);

    // Update status to watching if currently idle
    if (this.entity.status === 'idle') {
      this.entity.status = 'watching';
      WatchedFolderRepository.updateStatus(this.watcherId, 'watching').catch(() => {});
    }

    // Schedule initial scan
    this.scheduleNextScan(100);
  }

  /**
   * Stops monitoring the folder.
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.isScanning = false;
    logger.info('watcher_monitor', `Stopped watcher monitor for "${this.entity.name}" (${this.watcherId})`);
  }

  /**
   * Executes a single scanning pass.
   * Can be invoked directly in unit tests.
   */
  async scanNow(): Promise<{ detected: number; ready: number; skippedDuplicates: number }> {
    if (this.isScanning) {
      return { detected: 0, ready: 0, skippedDuplicates: 0 };
    }

    this.isScanning = true;
    let detected = 0;
    let ready = 0;
    let skippedDuplicates = 0;

    try {
      const folderPath = path.resolve(this.entity.folderPath);

      // 1. Verify folder accessibility
      if (!fs.existsSync(folderPath)) {
        throw new Error(`Watched folder does not exist: ${folderPath}`);
      }
      const dirStat = fs.statSync(folderPath);
      if (!dirStat.isDirectory()) {
        throw new Error(`Watched folder path is a file, not a directory: ${folderPath}`);
      }

      // Reset error backoff on successful folder access
      if (this.consecutiveErrors > 0) {
        this.consecutiveErrors = 0;
        await WatchedFolderRepository.updateStatus(this.watcherId, 'watching', undefined);
      }

      // 2. Read directory entries
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      const currentFilePathsOnDisk = new Set<string>();
      const candidateFiles: { filePath: string; filename: string; stat: fs.Stats }[] = [];

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const filename = entry.name;
        const fullPath = path.join(folderPath, filename);
        currentFilePathsOnDisk.add(fullPath);

        // Ignore hidden and system files
        if (filename.startsWith('.') || filename.startsWith('~$') || filename === 'Thumbs.db' || filename === 'desktop.ini') {
          continue;
        }

        // Ignore temporary / incomplete download files
        const lowerName = filename.toLowerCase();
        if (TEMPORARY_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
          continue;
        }

        // Must match supported video extensions
        const ext = path.extname(filename).toLowerCase();
        if (!SUPPORTED_IMPORT_EXTENSIONS.includes(ext as any)) {
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          candidateFiles.push({ filePath: fullPath, filename, stat });
        } catch {
          // File might have been locked or deleted mid-iteration
          continue;
        }
      }

      // Prune stability tracking for files no longer on disk
      for (const trackedPath of this.stabilityMap.keys()) {
        if (!currentFilePathsOnDisk.has(trackedPath)) {
          this.stabilityMap.delete(trackedPath);
          this.inFlightFiles.delete(trackedPath);
        }
      }

      // 3. Sort candidates according to rules.ingestOrder (default 'oldest_first')
      const order = this.entity.rules.ingestOrder || 'oldest_first';
      candidateFiles.sort((a, b) => {
        return order === 'oldest_first'
          ? a.stat.mtimeMs - b.stat.mtimeMs
          : b.stat.mtimeMs - a.stat.mtimeMs;
      });

      // 4. Batch safeguarding: process at most maxBatchSize (default 5) newly ready items per scan
      const maxBatchSize = this.entity.rules.maxBatchSize || 5;
      const stabilityWindowMs = this.entity.rules.stabilityDurationMs ?? 20000;
      const now = Date.now();

      for (const candidate of candidateFiles) {
        if (ready >= maxBatchSize) {
          // Reached batch scan limit for this iteration; remaining files will be picked up on next scan
          break;
        }

        const { filePath, filename, stat } = candidate;

        // Skip if currently in-flight
        if (this.inFlightFiles.has(filePath)) {
          continue;
        }

        // Cheap metadata check first: has this exact file (path, size, mtime) already been ingested?
        const alreadyIngested = await WatchedFolderHistoryRepository.hasFileMetadata(
          this.watcherId,
          filePath,
          stat.size,
          stat.mtimeMs
        );
        if (alreadyIngested) {
          // Already successfully processed; clean up stability tracking
          this.stabilityMap.delete(filePath);
          continue;
        }

        detected++;

        // 5. Test File Readability (check if locked by write/copy stream)
        const isReadable = this.checkFileReadability(filePath);
        if (!isReadable) {
          // File is currently locked or inaccessible; reset stability clock
          this.stabilityMap.set(filePath, {
            firstSeenMs: now,
            lastCheckedMs: now,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
          continue;
        }

        // 6. Stability Evaluation
        let stability = this.stabilityMap.get(filePath);

        if (!stability) {
          // First time seeing this candidate
          stability = {
            firstSeenMs: now,
            lastCheckedMs: now,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          };
          this.stabilityMap.set(filePath, stability);

          // Record in history ledger as 'stabilizing'
          await WatchedFolderHistoryRepository.recordFile(this.watcherId, {
            filePath,
            filename,
            fileSizeBytes: stat.size,
            fileMtimeMs: stat.mtimeMs,
            hashSha256: '',
            status: 'stabilizing',
            detectedAt: new Date(now).toISOString(),
          });
          continue;
        }

        // Check if file size or mtime changed since last check
        if (stat.size !== stability.size || stat.mtimeMs !== stability.mtimeMs || stat.size === 0) {
          // File is still being modified/written
          stability.firstSeenMs = now;
          stability.lastCheckedMs = now;
          stability.size = stat.size;
          stability.mtimeMs = stat.mtimeMs;
          continue;
        }

        // Update last checked time
        stability.lastCheckedMs = now;

        // Has file remained stable for the full stability duration?
        const stableDuration = now - stability.firstSeenMs;
        if (stableDuration < stabilityWindowMs) {
          // Still waiting for stability window
          continue;
        }

        // 7. FILE IS VERIFIED STABLE!
        // Acquire in-flight lock to guarantee single ingestion
        this.inFlightFiles.add(filePath);

        try {
          // Compute streaming SHA-256 (does NOT load entire file into memory)
          const hashSha256 = await MediaImportService.computeFileSha256(filePath);

          // Check if hash has already been ingested
          const hashExists = await WatchedFolderHistoryRepository.hasHash(this.watcherId, hashSha256);
          if (hashExists) {
            // Duplicate content detected
            skippedDuplicates++;
            await WatchedFolderHistoryRepository.recordFile(this.watcherId, {
              filePath,
              filename,
              fileSizeBytes: stat.size,
              fileMtimeMs: stat.mtimeMs,
              hashSha256,
              status: 'skipped_duplicate',
              detectedAt: new Date(stability.firstSeenMs).toISOString(),
            });
            this.stabilityMap.delete(filePath);
            continue;
          }

          // Mark as 'ready' in history ledger
          const readyRecord = await WatchedFolderHistoryRepository.recordFile(this.watcherId, {
            filePath,
            filename,
            fileSizeBytes: stat.size,
            fileMtimeMs: stat.mtimeMs,
            hashSha256,
            status: 'ready',
            detectedAt: new Date(stability.firstSeenMs).toISOString(),
          });

          ready++;

          // Update repository stats
          await WatchedFolderRepository.updateStatus(this.watcherId, 'watching', undefined, {
            totalDetected: (this.entity.stats.totalDetected || 0) + 1,
            lastIngestedFilename: filename,
          });
          this.entity.stats.totalDetected = (this.entity.stats.totalDetected || 0) + 1;

          // Dispatch to onMediaReady hook (Phase 4C handoff seam)
          if (this.options.onMediaReady) {
            try {
              await this.options.onMediaReady(readyRecord, this.entity);
            } catch (err: any) {
              logger.error('watcher_monitor', `onMediaReady handler failed for ${filename}: ${err.message}`);
            }
          }

          // Clean up stability tracking once ready
          this.stabilityMap.delete(filePath);
        } finally {
          this.inFlightFiles.delete(filePath);
        }
      }

      return { detected, ready, skippedDuplicates };
    } catch (err: any) {
      this.consecutiveErrors++;
      const errorMessage = err.message || 'Unknown watcher error';
      logger.error('watcher_monitor', `Scan error on watcher "${this.entity.name}" (${this.watcherId}): ${errorMessage}`);

      // Transition to error status in repository
      this.entity.status = 'error';
      this.entity.lastError = errorMessage;
      await WatchedFolderRepository.updateStatus(this.watcherId, 'error', errorMessage);

      return { detected: 0, ready: 0, skippedDuplicates: 0 };
    } finally {
      this.isScanning = false;
      if (this.isRunning) {
        this.scheduleNextScan();
      }
    }
  }

  /**
   * Tests if a file can be opened for reading without error (detects copy locks).
   */
  private checkFileReadability(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, 'r');
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Schedules the next scan pass with exponential backoff on errors.
   */
  private scheduleNextScan(delayMs?: number): void {
    if (!this.isRunning) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    let interval = delayMs !== undefined ? delayMs : (this.options.pollIntervalMs || 5000);

    // Apply bounded exponential backoff if consecutive errors occurred
    if (this.consecutiveErrors > 0) {
      // 5s -> 10s -> 20s -> 40s -> max 60s
      interval = Math.min(60000, (this.options.pollIntervalMs || 5000) * Math.pow(2, this.consecutiveErrors - 1));
    }

    this.timer = setTimeout(() => {
      if (this.isRunning) {
        this.scanNow().catch((err) => {
          logger.error('watcher_monitor', `Unhandled scanNow error: ${err.message}`);
        });
      }
    }, interval);
  }
}
