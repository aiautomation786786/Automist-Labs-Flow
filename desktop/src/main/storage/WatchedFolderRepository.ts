/**
 * WatchedFolderRepository – Concurrency-safe persistence for WatchedFolderEntity configurations.
 *
 * Guarantees:
 *  1. Concurrency-Safe: Serializes all mutations through FileMutex.
 *  2. Atomic Writes: Writes to .tmp file then renames, preventing corrupted JSON.
 *  3. Path & Directory Validation: Validates folder existence and directory type.
 *  4. Duplicate Prevention: Disallows watching the same physical folder multiple times.
 *  5. Safe Defaults:
 *     - deleteSourceOnSuccess strictly defaults to false (original user files never deleted).
 *     - maxBatchSize: 5 is purely an ingestion-scan safeguard (never a scheduler concurrency cap).
 *  6. Safe Deletion: Removing a watcher removes only its watcher config and history ledger;
 *     created projects, channels, and media remain completely untouched.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  WatchedFolderEntity,
  CreateWatchedFolderParams,
  UpdateWatchedFolderParams,
  WatchedFolderStatus,
} from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { WatchedFolderHistoryRepository } from './WatchedFolderHistoryRepository';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class WatchedFolderRepository {
  private static cache = new Map<string, { entity: WatchedFolderEntity; mtimeMs: number }>();
  private static readonly MAX_CACHE_ENTRIES = 50;

  private static setCache(id: string, entity: WatchedFolderEntity, mtimeMs: number): void {
    this.cache.delete(id);
    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(id, {
      entity: JSON.parse(JSON.stringify(entity)),
      mtimeMs,
    });
  }

  /**
   * Generates a deterministic, URL-safe watcher ID.
   */
  static generateWatcherId(): string {
    return `watch_${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Clears in-memory cache (for tests or memory cleanup).
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Returns all persisted watched folders.
   */
  static async getAll(): Promise<WatchedFolderEntity[]> {
    return await fileMutex.runExclusive('watched_folder_index', async () => {
      const rootDir = AssetManager.getWatchedFoldersRootDir();
      if (!fs.existsSync(rootDir)) {
        return [];
      }

      const entries = fs.readdirSync(rootDir, { withFileTypes: true });
      const watchers: WatchedFolderEntity[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('watch_')) {
          const watcher = await this.readWatcherInternal(entry.name);
          if (watcher) {
            watchers.push(watcher);
          }
        }
      }

      // Sort by creation date descending
      return watchers.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }

  /**
   * Retrieves a specific watched folder by ID.
   */
  static async get(id: string): Promise<WatchedFolderEntity | null> {
    if (!id || typeof id !== 'string') return null;
    return await fileMutex.runExclusive('watched_folder_index', async () => {
      return await this.readWatcherInternal(id);
    });
  }

  /**
   * Creates and persists a new WatchedFolderEntity.
   */
  static async create(params: CreateWatchedFolderParams): Promise<WatchedFolderEntity> {
    const trimmedName = params.name ? params.name.trim() : '';
    if (!trimmedName) {
      throw new Error('Watcher name cannot be empty.');
    }

    if (!params.folderPath || typeof params.folderPath !== 'string' || !params.folderPath.trim()) {
      throw new Error('Folder path cannot be empty.');
    }

    const resolvedPath = path.resolve(params.folderPath.trim());
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`The specified folder does not exist on disk: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`The specified path is a file, not a directory: ${resolvedPath}`);
    }

    return await fileMutex.runExclusive('watched_folder_index', async () => {
      // Guard against duplicate folder paths
      const existing = await this.getAllInternal();
      const duplicatePath = existing.find(
        (w) => path.resolve(w.folderPath).toLowerCase() === resolvedPath.toLowerCase()
      );
      if (duplicatePath) {
        throw new Error(`A watcher already exists for folder: ${resolvedPath} ("${duplicatePath.name}")`);
      }

      const id = this.generateWatcherId();
      const now = new Date().toISOString();

      AssetManager.ensureWatchedFolderDirectories(id);

      const entity: WatchedFolderEntity = {
        id,
        name: trimmedName,
        folderPath: resolvedPath,
        enabled: params.enabled !== false,
        status: params.enabled === false ? 'paused' : 'idle',
        cadence: {
          mode: params.cadence?.mode || 'immediate',
          dailyTime: params.cadence?.dailyTime,
          intervalMinutes: params.cadence?.intervalMinutes,
          catchUpMissed: params.cadence?.catchUpMissed ?? true,
          publishDelayHours: params.cadence?.publishDelayHours,
        },
        rules: {
          channelId: params.channelId || params.rules?.channelId,
          workflow: params.workflow || params.rules?.workflow || 'import_only',
          stabilityDurationMs: params.rules?.stabilityDurationMs ?? 20000,
          maxBatchSize: params.rules?.maxBatchSize ?? 5,
          ingestOrder: params.rules?.ingestOrder ?? 'oldest_first',
          // Strictly defaults to false — user source files are never deleted unless explicitly configured
          deleteSourceOnSuccess: params.rules?.deleteSourceOnSuccess ?? false,
          targetAspectRatio: params.rules?.targetAspectRatio,
        },
        createdAt: now,
        updatedAt: now,
        stats: {
          totalDetected: 0,
          totalIngested: 0,
          totalErrors: 0,
        },
      };

      await this.saveWatcherAtomic(entity);
      logger.info('watched_folder', `Created watched folder "${entity.name}" (${entity.id}) for path ${entity.folderPath}`);
      return entity;
    });
  }

  /**
   * Updates an existing WatchedFolderEntity.
   */
  static async update(id: string, patch: UpdateWatchedFolderParams): Promise<WatchedFolderEntity> {
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid watcher id.');
    }

    return await fileMutex.runExclusive('watched_folder_index', async () => {
      const existing = await this.readWatcherInternal(id);
      if (!existing) {
        throw new Error(`Watched folder with ID "${id}" does not exist.`);
      }

      let updatedPath = existing.folderPath;
      if (patch.folderPath && patch.folderPath.trim()) {
        const resolved = path.resolve(patch.folderPath.trim());
        if (!fs.existsSync(resolved)) {
          throw new Error(`The updated folder does not exist on disk: ${resolved}`);
        }
        if (!fs.statSync(resolved).isDirectory()) {
          throw new Error(`The updated path is not a directory: ${resolved}`);
        }

        // Check for collision with other watchers
        const allWatchers = await this.getAllInternal();
        const duplicate = allWatchers.find(
          (w) => w.id !== id && path.resolve(w.folderPath).toLowerCase() === resolved.toLowerCase()
        );
        if (duplicate) {
          throw new Error(`Another watcher is already configured for folder: ${resolved}`);
        }
        updatedPath = resolved;
      }

      const now = new Date().toISOString();
      const updated: WatchedFolderEntity = {
        ...existing,
        name: patch.name !== undefined ? patch.name.trim() : existing.name,
        folderPath: updatedPath,
        enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
        status:
          patch.enabled === false
            ? 'paused'
            : existing.status === 'paused' && patch.enabled === true
            ? 'idle'
            : existing.status,
        cadence: {
          ...existing.cadence,
          ...(patch.cadence || {}),
        },
        rules: {
          ...existing.rules,
          ...(patch.rules || {}),
          channelId: patch.channelId !== undefined ? patch.channelId : existing.rules.channelId,
          workflow: patch.workflow !== undefined ? patch.workflow : existing.rules.workflow,
          // Preserve deleteSourceOnSuccess safety invariant
          deleteSourceOnSuccess:
            patch.rules?.deleteSourceOnSuccess !== undefined
              ? patch.rules.deleteSourceOnSuccess
              : existing.rules.deleteSourceOnSuccess,
        },
        updatedAt: now,
      };

      await this.saveWatcherAtomic(updated);
      logger.info('watched_folder', `Updated watched folder "${updated.name}" (${updated.id})`);
      return updated;
    });
  }

  /**
   * Lightweight status update without mutating rules or triggering deep mutex overhead.
   */
  static async updateStatus(
    id: string,
    status: WatchedFolderStatus,
    error?: string,
    statUpdate?: Partial<WatchedFolderEntity['stats']>
  ): Promise<WatchedFolderEntity | null> {
    return await fileMutex.runExclusive('watched_folder_index', async () => {
      const existing = await this.readWatcherInternal(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const updated: WatchedFolderEntity = {
        ...existing,
        status,
        lastError: error !== undefined ? error : existing.lastError,
        lastPolledAt: status === 'watching' || status === 'idle' ? now : existing.lastPolledAt,
        lastIngestedAt: statUpdate?.lastIngestedFilename ? now : existing.lastIngestedAt,
        updatedAt: now,
        stats: {
          ...existing.stats,
          ...(statUpdate || {}),
        },
      };

      await this.saveWatcherAtomic(updated);
      return updated;
    });
  }

  /**
   * Safely pauses or resumes a watched folder.
   */
  static async setPaused(id: string, paused: boolean): Promise<WatchedFolderEntity> {
    return await this.update(id, {
      enabled: !paused,
    });
  }

  /**
   * Deletes a watched folder configuration and its deduplication ledger.
   * NEVER touches any created projects, channels, or output media.
   */
  static async delete(id: string): Promise<boolean> {
    if (!id || typeof id !== 'string') return false;

    return await fileMutex.runExclusive('watched_folder_index', async () => {
      const watcherDir = AssetManager.getWatchedFolderDir(id);
      if (!fs.existsSync(watcherDir)) {
        return false;
      }

      // 1. Delete history ledger first
      await WatchedFolderHistoryRepository.deleteHistory(id);

      // 2. Remove watcher directory
      try {
        fs.rmSync(watcherDir, { recursive: true, force: true });
        this.cache.delete(id);
        logger.info('watched_folder', `Deleted watched folder ${id}`);
        return true;
      } catch (err: any) {
        logger.error('watched_folder', `Failed to delete watched folder ${id}: ${err.message}`);
        return false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private static async getAllInternal(): Promise<WatchedFolderEntity[]> {
    const rootDir = AssetManager.getWatchedFoldersRootDir();
    if (!fs.existsSync(rootDir)) return [];

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const watchers: WatchedFolderEntity[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('watch_')) {
        const watcher = await this.readWatcherInternal(entry.name);
        if (watcher) watchers.push(watcher);
      }
    }
    return watchers;
  }

  private static async readWatcherInternal(id: string): Promise<WatchedFolderEntity | null> {
    const jsonPath = AssetManager.getWatchedFolderJsonPath(id);
    if (!fs.existsSync(jsonPath)) return null;

    try {
      const stat = fs.statSync(jsonPath);
      const cached = this.cache.get(id);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return JSON.parse(JSON.stringify(cached.entity));
      }

      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as WatchedFolderEntity;
      this.setCache(id, parsed, stat.mtimeMs);
      return parsed;
    } catch (err: any) {
      logger.error('watched_folder', `Error reading watcher ${id}: ${err.message}`);
      return null;
    }
  }

  private static async saveWatcherAtomic(entity: WatchedFolderEntity): Promise<void> {
    AssetManager.ensureWatchedFolderDirectories(entity.id);
    const targetPath = AssetManager.getWatchedFolderJsonPath(entity.id);
    const tmpPath = `${targetPath}.tmp.${Date.now()}`;

    fs.writeFileSync(tmpPath, JSON.stringify(entity, null, 2), 'utf-8');
    fs.renameSync(tmpPath, targetPath);

    const stat = fs.statSync(targetPath);
    this.setCache(entity.id, entity, stat.mtimeMs);
  }
}
