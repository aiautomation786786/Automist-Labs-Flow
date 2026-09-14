/**
 * PublishingHistoryRepository – Project-specific audit history for external video publishing.
 *
 * Guarantees:
 *  1. Preserves project.json performance: Detailed upload records, session URIs, byte metrics,
 *     and failure logs are persisted in <projectDir>/metadata/publishing_history.json.
 *  2. Concurrency-safe: Serializes updates through FileMutex.
 *  3. Atomic writes: Writes to temporary files before replacement.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { PublishingHistoryRecord } from '../../shared/types';
import { AssetManager } from '../storage/AssetManager';
import { fileMutex } from '../storage/FileMutex';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class PublishingHistoryRepository {
  private static getHistoryFilePath(projectId: string): string {
    const projectDir = AssetManager.getProjectDir(projectId);
    const metadataDir = path.join(projectDir, 'metadata');
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }
    return path.join(metadataDir, 'publishing_history.json');
  }

  private static readHistoryDirect(filePath: string): PublishingHistoryRecord[] {
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (!raw.trim()) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      logger.error('publishing_history', `Failed to read history from ${filePath}`, err as Error);
      return [];
    }
  }

  private static writeHistoryAtomic(filePath: string, records: PublishingHistoryRecord[]): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * Appends a new publishing history record.
   */
  static async record(
    projectId: string,
    entry: Omit<PublishingHistoryRecord, 'id' | 'createdAt'>
  ): Promise<PublishingHistoryRecord> {
    return await fileMutex.runExclusive(`pub_hist_${projectId}`, async () => {
      const filePath = this.getHistoryFilePath(projectId);
      const records = this.readHistoryDirect(filePath);

      const record: PublishingHistoryRecord = {
        ...entry,
        id: `pubrec_${crypto.randomBytes(6).toString('hex')}`,
        createdAt: new Date().toISOString(),
      };

      records.push(record);
      this.writeHistoryAtomic(filePath, records);

      logger.info('publishing_history', 'Recorded publishing event', {
        projectId,
        recordId: record.id,
        status: record.status,
      });

      return record;
    });
  }

  /**
   * Retrieves all publishing records for a project, sorted by createdAt descending.
   */
  static async getHistory(projectId: string): Promise<PublishingHistoryRecord[]> {
    return await fileMutex.runExclusive(`pub_hist_${projectId}`, async () => {
      const filePath = this.getHistoryFilePath(projectId);
      const records = this.readHistoryDirect(filePath);
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  /**
   * Retrieves the most recent publishing record for a project.
   */
  static async getLatest(projectId: string): Promise<PublishingHistoryRecord | null> {
    const history = await this.getHistory(projectId);
    return history.length > 0 ? history[0] : null;
  }

  /**
   * Updates an existing record (e.g. status transition or session URI update).
   */
  static async update(
    projectId: string,
    recordId: string,
    patch: Partial<Omit<PublishingHistoryRecord, 'id' | 'projectId' | 'createdAt'>>
  ): Promise<PublishingHistoryRecord | null> {
    return await fileMutex.runExclusive(`pub_hist_${projectId}`, async () => {
      const filePath = this.getHistoryFilePath(projectId);
      const records = this.readHistoryDirect(filePath);
      const index = records.findIndex((r) => r.id === recordId);
      if (index === -1) return null;

      records[index] = {
        ...records[index],
        ...patch,
      };

      this.writeHistoryAtomic(filePath, records);
      return records[index];
    });
  }
}
