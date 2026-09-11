/**
 * ChannelHistoryRepository – Delivery tracking and bounded query engine.
 *
 * Persists all delivery records to: %LOCALAPPDATA%\GoogleFlowApp\history\delivery_history.json
 *
 * GUARANTEES:
 *  1. Concurrency-Safe: Serializes all mutations through FileMutex.
 *  2. Atomic Writes: Writes to .tmp file then renames, preventing corrupt JSON.
 *  3. In-memory caching with mtime checking for fast reads.
 *  4. Bounded querying with channel filtering, status filtering, and search.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import type {
  DeliveryHistoryRecord,
  ChannelHistoryQuery,
  ChannelHistoryResult,
} from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class ChannelHistoryRepository {
  private static cachedRecords: DeliveryHistoryRecord[] | null = null;
  private static cachedMtimeMs = 0;

  /**
   * Clears the in-memory cache.
   */
  static clearCache(): void {
    this.cachedRecords = null;
    this.cachedMtimeMs = 0;
  }

  /**
   * Records a new delivery attempt (successful or failed) in history.
   */
  static async record(
    entry: Omit<DeliveryHistoryRecord, 'id' | 'deliveredAt'> & { id?: string; deliveredAt?: string },
  ): Promise<DeliveryHistoryRecord> {
    const id = entry.id || `deliv_${crypto.randomBytes(6).toString('hex')}`;
    const deliveredAt = entry.deliveredAt || new Date().toISOString();

    const record: DeliveryHistoryRecord = {
      ...entry,
      id,
      deliveredAt,
    };

    await fileMutex.runExclusive('delivery_history', async () => {
      const records = await this.readAllRaw();
      // Prepend so latest is first
      records.unshift(record);
      await this.writeAllAtomic(records);
      logger.info('channel_history_repo', 'Recorded delivery history', {
        id: record.id,
        projectId: record.projectId,
        channelId: record.channelId,
        status: record.status,
      });
    });

    return record;
  }

  /**
   * Retrieves a single delivery record by ID.
   */
  static async getById(id: string): Promise<DeliveryHistoryRecord | null> {
    return await fileMutex.runExclusive('delivery_history', async () => {
      const records = await this.readAllRaw();
      return records.find((r) => r.id === id) || null;
    });
  }

  /**
   * Queries delivery history with optional filtering, search, and pagination.
   */
  static async query(query: ChannelHistoryQuery = {}): Promise<ChannelHistoryResult> {
    return await fileMutex.runExclusive('delivery_history', async () => {
      const allRecords = await this.readAllRaw();

      let filtered = allRecords;

      if (query.channelId) {
        filtered = filtered.filter((r) => r.channelId === query.channelId);
      }

      if (query.status) {
        filtered = filtered.filter((r) => r.status === query.status);
      }

      if (query.searchQuery) {
        const q = query.searchQuery.trim().toLowerCase();
        filtered = filtered.filter((r) => {
          return (
            r.projectName.toLowerCase().includes(q) ||
            r.channelName.toLowerCase().includes(q) ||
            r.deliveredVideoPath.toLowerCase().includes(q) ||
            (r.error && r.error.toLowerCase().includes(q))
          );
        });
      }

      const total = filtered.length;
      const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
      const offset = Math.max(0, query.offset ?? 0);

      const records = filtered.slice(offset, offset + limit);

      return {
        records,
        total,
        limit,
        offset,
      };
    });
  }

  /**
   * Clears all history (primarily for tests or resets).
   */
  static async clear(): Promise<void> {
    await fileMutex.runExclusive('delivery_history', async () => {
      await this.writeAllAtomic([]);
      this.clearCache();
    });
  }

  /**
   * Reads all delivery records with mtime cache validation.
   */
  private static async readAllRaw(): Promise<DeliveryHistoryRecord[]> {
    const historyPath = AssetManager.getDeliveryHistoryPath();
    if (!fs.existsSync(historyPath)) {
      this.cachedRecords = [];
      this.cachedMtimeMs = 0;
      return [];
    }

    try {
      const stat = fs.statSync(historyPath);
      if (this.cachedRecords && this.cachedMtimeMs === stat.mtimeMs) {
        return [...this.cachedRecords];
      }

      const content = fs.readFileSync(historyPath, 'utf-8');
      const records = JSON.parse(content) as DeliveryHistoryRecord[];
      this.cachedRecords = Array.isArray(records) ? records : [];
      this.cachedMtimeMs = stat.mtimeMs;
      return [...this.cachedRecords];
    } catch (err) {
      logger.error('channel_history_repo', 'Failed to read delivery history', err as Error);
      return [];
    }
  }

  /**
   * Atomically writes all records to delivery_history.json.
   */
  private static async writeAllAtomic(records: DeliveryHistoryRecord[]): Promise<void> {
    AssetManager.ensureHistoryDirectories();
    const historyPath = AssetManager.getDeliveryHistoryPath();
    const tmpPath = `${historyPath}.tmp.${Date.now()}`;

    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmpPath, historyPath);

    const stat = fs.statSync(historyPath);
    this.cachedRecords = [...records];
    this.cachedMtimeMs = stat.mtimeMs;
  }
}
