/**
 * WatchedFolderHistoryRepository – Concurrency-safe ledger of detected and ingested files.
 *
 * Guarantees:
 *  1. O(1) Deduplication: Maintains in-memory hash sets for instant duplicate detection across app restarts.
 *  2. Concurrency-Safe: Serializes mutations via FileMutex per watcher.
 *  3. Atomic Persistence: Writes to temporary files before atomic rename to prevent corruption.
 *  4. Bounded Storage: Caps in-memory and disk records to 5,000 entries per watcher for 8 GB RAM efficiency.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import type { WatchedFileRecord } from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class WatchedFolderHistoryRepository {
  private static readonly MAX_RECORDS = 5000;
  private static cache = new Map<string, WatchedFileRecord[]>();
  private static hashCache = new Map<string, Set<string>>();

  /**
   * Generates a collision-free record ID.
   */
  static generateRecordId(): string {
    return `wfrec_${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Clears in-memory caches (for tests or memory cleanup).
   */
  static clearCache(watcherId?: string): void {
    if (watcherId) {
      this.cache.delete(watcherId);
      this.hashCache.delete(watcherId);
    } else {
      this.cache.clear();
      this.hashCache.clear();
    }
  }

  /**
   * Loads all history records for a given watcher.
   */
  static async getHistory(watcherId: string, limit = 100): Promise<WatchedFileRecord[]> {
    const records = await this.loadRecords(watcherId);
    return records.slice(0, Math.max(1, limit));
  }

  /**
   * Checks if a cryptographic SHA-256 hash has already been ingested by this watcher.
   */
  static async hasHash(watcherId: string, hashSha256: string): Promise<boolean> {
    if (!hashSha256) return false;
    const hashes = await this.getHashIndex(watcherId);
    return hashes.has(hashSha256);
  }

  /**
   * Fast pre-check by file metadata (path, size, mtime) to avoid expensive hashing of unchanged files.
   */
  static async hasFileMetadata(
    watcherId: string,
    filePath: string,
    fileSizeBytes: number,
    fileMtimeMs: number
  ): Promise<boolean> {
    const records = await this.loadRecords(watcherId);
    return records.some(
      (r) =>
        r.filePath === filePath &&
        r.fileSizeBytes === fileSizeBytes &&
        Math.abs(r.fileMtimeMs - fileMtimeMs) < 1000 &&
        r.status === 'ingested'
    );
  }

  /**
   * Records or updates a file status in the watcher history ledger.
   */
  static async recordFile(
    watcherId: string,
    record: Omit<WatchedFileRecord, 'id' | 'watcherId'> & { id?: string }
  ): Promise<WatchedFileRecord> {
    return await fileMutex.runExclusive(`watch_hist_${watcherId}`, async () => {
      const records = await this.loadRecords(watcherId);
      const existingIndex = records.findIndex(
        (r) => r.hashSha256 === record.hashSha256 || (r.filePath === record.filePath && r.id === record.id)
      );

      const fullRecord: WatchedFileRecord = {
        id: record.id || (existingIndex >= 0 ? records[existingIndex].id : this.generateRecordId()),
        watcherId,
        filePath: record.filePath,
        filename: record.filename,
        fileSizeBytes: record.fileSizeBytes,
        fileMtimeMs: record.fileMtimeMs,
        hashSha256: record.hashSha256,
        status: record.status,
        detectedAt: record.detectedAt,
        ingestedAt: record.ingestedAt,
        projectId: record.projectId,
        error: record.error,
      };

      if (existingIndex >= 0) {
        records[existingIndex] = fullRecord;
      } else {
        records.unshift(fullRecord); // latest first
      }

      // Enforce bounds
      if (records.length > this.MAX_RECORDS) {
        records.length = this.MAX_RECORDS;
      }

      await this.saveRecordsAtomic(watcherId, records);

      // Update in-memory caches
      this.cache.set(watcherId, records);
      const hashSet = this.hashCache.get(watcherId) || new Set<string>();
      if (fullRecord.status === 'ingested' && fullRecord.hashSha256) {
        hashSet.add(fullRecord.hashSha256);
      }
      this.hashCache.set(watcherId, hashSet);

      return fullRecord;
    });
  }

  /**
   * Deletes the history ledger for a watcher (called when a watcher is removed).
   */
  static async deleteHistory(watcherId: string): Promise<void> {
    await fileMutex.runExclusive(`watch_hist_${watcherId}`, async () => {
      this.clearCache(watcherId);
      const filePath = AssetManager.getWatchedFolderHistoryJsonPath(watcherId);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err: any) {
          logger.warn('watch_history', `Failed to delete history file for watcher ${watcherId}: ${err.message}`);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private static async loadRecords(watcherId: string): Promise<WatchedFileRecord[]> {
    if (this.cache.has(watcherId)) {
      return this.cache.get(watcherId)!;
    }

    const filePath = AssetManager.getWatchedFolderHistoryJsonPath(watcherId);
    if (!fs.existsSync(filePath)) {
      this.cache.set(watcherId, []);
      this.hashCache.set(watcherId, new Set<string>());
      return [];
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.cache.set(watcherId, parsed);
        const hashSet = new Set<string>();
        for (const r of parsed) {
          if (r.status === 'ingested' && r.hashSha256) {
            hashSet.add(r.hashSha256);
          }
        }
        this.hashCache.set(watcherId, hashSet);
        return parsed;
      }
    } catch (err: any) {
      logger.error('watch_history', `Error reading history for watcher ${watcherId}: ${err.message}`);
    }

    this.cache.set(watcherId, []);
    this.hashCache.set(watcherId, new Set<string>());
    return [];
  }

  private static async getHashIndex(watcherId: string): Promise<Set<string>> {
    if (this.hashCache.has(watcherId)) {
      return this.hashCache.get(watcherId)!;
    }
    await this.loadRecords(watcherId);
    return this.hashCache.get(watcherId) || new Set<string>();
  }

  private static async saveRecordsAtomic(watcherId: string, records: WatchedFileRecord[]): Promise<void> {
    AssetManager.ensureWatchedFolderDirectories(watcherId);
    const targetPath = AssetManager.getWatchedFolderHistoryJsonPath(watcherId);
    const tmpPath = `${targetPath}.tmp.${Date.now()}`;

    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmpPath, targetPath);
  }
}
