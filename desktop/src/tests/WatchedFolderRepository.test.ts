import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { WatchedFolderRepository } from '../main/storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../main/storage/WatchedFolderHistoryRepository';
import type { CreateWatchedFolderParams } from '../shared/types';

describe('WatchedFolderRepository & WatchedFolderHistoryRepository Unit Tests', () => {
  let tmpBaseDir: string;
  let testWatchedDir1: string;
  let testWatchedDir2: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-watched-repo-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;

    testWatchedDir1 = path.join(tmpBaseDir, 'incoming_media_1');
    testWatchedDir2 = path.join(tmpBaseDir, 'incoming_media_2');
    fs.mkdirSync(testWatchedDir1, { recursive: true });
    fs.mkdirSync(testWatchedDir2, { recursive: true });

    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
  });

  afterEach(() => {
    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  describe('Path & Field Validation', () => {
    it('rejects creation with empty name', async () => {
      await expect(
        WatchedFolderRepository.create({
          name: '   ',
          folderPath: testWatchedDir1,
        })
      ).rejects.toThrow('Watcher name cannot be empty');
    });

    it('rejects creation with empty folder path', async () => {
      await expect(
        WatchedFolderRepository.create({
          name: 'My Watcher',
          folderPath: '   ',
        })
      ).rejects.toThrow('Folder path cannot be empty');
    });

    it('rejects non-existent folder paths', async () => {
      const nonExistent = path.join(tmpBaseDir, 'does_not_exist_xyz');
      await expect(
        WatchedFolderRepository.create({
          name: 'My Watcher',
          folderPath: nonExistent,
        })
      ).rejects.toThrow('does not exist on disk');
    });

    it('rejects a file path that is not a directory', async () => {
      const filePath = path.join(tmpBaseDir, 'some_file.mp4');
      fs.writeFileSync(filePath, 'dummy content');

      await expect(
        WatchedFolderRepository.create({
          name: 'My Watcher',
          folderPath: filePath,
        })
      ).rejects.toThrow('is a file, not a directory');
    });
  });

  describe('CRUD and Safe Defaults', () => {
    it('creates watched folder with safe defaults (deleteSourceOnSuccess=false, maxBatchSize=5)', async () => {
      const params: CreateWatchedFolderParams = {
        name: 'Daily Inbound',
        folderPath: testWatchedDir1,
      };

      const entity = await WatchedFolderRepository.create(params);

      expect(entity.id).toMatch(/^watch_/);
      expect(entity.name).toBe('Daily Inbound');
      expect(path.resolve(entity.folderPath)).toBe(path.resolve(testWatchedDir1));
      expect(entity.enabled).toBe(true);
      expect(entity.status).toBe('idle');
      expect(entity.cadence.mode).toBe('immediate');
      expect(entity.cadence.catchUpMissed).toBe(true);

      // CRITICAL INVARIANT: Source deletion is strictly false by default
      expect(entity.rules.deleteSourceOnSuccess).toBe(false);
      // Batch size safeguard default
      expect(entity.rules.maxBatchSize).toBe(5);
      expect(entity.rules.stabilityDurationMs).toBe(20000);
      expect(entity.rules.workflow).toBe('import_only');

      expect(entity.stats.totalDetected).toBe(0);
      expect(entity.stats.totalIngested).toBe(0);
      expect(entity.stats.totalErrors).toBe(0);

      // Verify re-loading from disk
      const reloaded = await WatchedFolderRepository.get(entity.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded?.id).toBe(entity.id);
      expect(reloaded?.rules.deleteSourceOnSuccess).toBe(false);
    });

    it('creates paused watched folder when enabled is false', async () => {
      const entity = await WatchedFolderRepository.create({
        name: 'Paused Watcher',
        folderPath: testWatchedDir1,
        enabled: false,
      });

      expect(entity.enabled).toBe(false);
      expect(entity.status).toBe('paused');
    });

    it('prevents duplicate watchers on the exact same folder path', async () => {
      await WatchedFolderRepository.create({
        name: 'Watcher 1',
        folderPath: testWatchedDir1,
      });

      await expect(
        WatchedFolderRepository.create({
          name: 'Watcher 2',
          folderPath: testWatchedDir1,
        })
      ).rejects.toThrow('A watcher already exists for folder');
    });

    it('updates watcher properties while respecting duplicate paths', async () => {
      const w1 = await WatchedFolderRepository.create({
        name: 'Watcher 1',
        folderPath: testWatchedDir1,
      });
      const w2 = await WatchedFolderRepository.create({
        name: 'Watcher 2',
        folderPath: testWatchedDir2,
      });

      // Updating w1 to point to w2's path should fail
      await expect(
        WatchedFolderRepository.update(w1.id, {
          folderPath: testWatchedDir2,
        })
      ).rejects.toThrow('Another watcher is already configured for folder');

      // Valid update
      const updated = await WatchedFolderRepository.update(w1.id, {
        name: 'Watcher 1 Renamed',
        rules: {
          maxBatchSize: 10,
        },
      });

      expect(updated.name).toBe('Watcher 1 Renamed');
      expect(updated.rules.maxBatchSize).toBe(10);
      expect(updated.rules.deleteSourceOnSuccess).toBe(false);
    });

    it('toggles pause and resume via setPaused', async () => {
      const w = await WatchedFolderRepository.create({
        name: 'Toggle Test',
        folderPath: testWatchedDir1,
      });

      const paused = await WatchedFolderRepository.setPaused(w.id, true);
      expect(paused.enabled).toBe(false);
      expect(paused.status).toBe('paused');

      const resumed = await WatchedFolderRepository.setPaused(w.id, false);
      expect(resumed.enabled).toBe(true);
      expect(resumed.status).toBe('idle');
    });

    it('updates status and statistics accurately', async () => {
      const w = await WatchedFolderRepository.create({
        name: 'Stats Test',
        folderPath: testWatchedDir1,
      });

      const updated = await WatchedFolderRepository.updateStatus(
        w.id,
        'processing',
        undefined,
        {
          totalDetected: 5,
          totalIngested: 2,
          lastIngestedFilename: 'clip1.mp4',
        }
      );

      expect(updated?.status).toBe('processing');
      expect(updated?.stats.totalDetected).toBe(5);
      expect(updated?.stats.totalIngested).toBe(2);
      expect(updated?.stats.lastIngestedFilename).toBe('clip1.mp4');
      expect(updated?.lastIngestedAt).toBeDefined();
    });

    it('safely deletes watcher config without deleting source directory or media', async () => {
      const testFile = path.join(testWatchedDir1, 'keep_me_safe.mp4');
      fs.writeFileSync(testFile, 'valuable footage');

      const w = await WatchedFolderRepository.create({
        name: 'To Delete',
        folderPath: testWatchedDir1,
      });

      // Record a history item
      await WatchedFolderHistoryRepository.recordFile(w.id, {
        filePath: testFile,
        filename: 'keep_me_safe.mp4',
        fileSizeBytes: 16,
        fileMtimeMs: Date.now(),
        hashSha256: 'abc123hash',
        status: 'ingested',
        detectedAt: new Date().toISOString(),
      });

      const historyBefore = await WatchedFolderHistoryRepository.getHistory(w.id);
      expect(historyBefore.length).toBe(1);

      // Delete watcher
      const deleted = await WatchedFolderRepository.delete(w.id);
      expect(deleted).toBe(true);

      // Verify watcher config is gone
      const check = await WatchedFolderRepository.get(w.id);
      expect(check).toBeNull();

      // Verify history is deleted
      const historyAfter = await WatchedFolderHistoryRepository.getHistory(w.id);
      expect(historyAfter.length).toBe(0);

      // CRITICAL: The physical source folder and file MUST STILL EXIST
      expect(fs.existsSync(testWatchedDir1)).toBe(true);
      expect(fs.existsSync(testFile)).toBe(true);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('valuable footage');
    });
  });

  describe('WatchedFolderHistoryRepository Deduplication Ledger', () => {
    it('records file and maintains O(1) hash lookup', async () => {
      const watcherId = 'watch_test_ledger';
      const fileHash = crypto.createHash('sha256').update('media_content_test').digest('hex');

      expect(await WatchedFolderHistoryRepository.hasHash(watcherId, fileHash)).toBe(false);

      await WatchedFolderHistoryRepository.recordFile(watcherId, {
        filePath: path.join(testWatchedDir1, 'sample.mp4'),
        filename: 'sample.mp4',
        fileSizeBytes: 1024,
        fileMtimeMs: 1700000000000,
        hashSha256: fileHash,
        status: 'ingested',
        detectedAt: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      });

      // Check hash existence
      expect(await WatchedFolderHistoryRepository.hasHash(watcherId, fileHash)).toBe(true);

      // Check metadata pre-check
      const hasMeta = await WatchedFolderHistoryRepository.hasFileMetadata(
        watcherId,
        path.join(testWatchedDir1, 'sample.mp4'),
        1024,
        1700000000000
      );
      expect(hasMeta).toBe(true);

      // Mismatched size should return false
      const mismatchedSize = await WatchedFolderHistoryRepository.hasFileMetadata(
        watcherId,
        path.join(testWatchedDir1, 'sample.mp4'),
        2048,
        1700000000000
      );
      expect(mismatchedSize).toBe(false);
    });

    it('survives cache clear and reloads from disk ledger', async () => {
      const watcherId = 'watch_test_recovery';
      const fileHash = 'feedbeef1234567890';

      await WatchedFolderHistoryRepository.recordFile(watcherId, {
        filePath: 'C:/media/video.mp4',
        filename: 'video.mp4',
        fileSizeBytes: 5000,
        fileMtimeMs: 123456,
        hashSha256: fileHash,
        status: 'ingested',
        detectedAt: new Date().toISOString(),
      });

      // Clear memory cache to simulate app restart
      WatchedFolderHistoryRepository.clearCache(watcherId);

      // Should recover from disk
      expect(await WatchedFolderHistoryRepository.hasHash(watcherId, fileHash)).toBe(true);
      const history = await WatchedFolderHistoryRepository.getHistory(watcherId);
      expect(history.length).toBe(1);
      expect(history[0].hashSha256).toBe(fileHash);
    });
  });

  describe('Concurrency & FileMutex Serialization', () => {
    it('handles concurrent watcher creation and status updates without corruption', async () => {
      const folders: string[] = [];
      for (let i = 0; i < 5; i++) {
        const p = path.join(tmpBaseDir, `concurrent_${i}`);
        fs.mkdirSync(p, { recursive: true });
        folders.push(p);
      }

      // Fire 5 creations simultaneously
      const results = await Promise.all(
        folders.map((folderPath, i) =>
          WatchedFolderRepository.create({
            name: `Concurrent Watcher ${i}`,
            folderPath,
          })
        )
      );

      expect(results.length).toBe(5);
      const all = await WatchedFolderRepository.getAll();
      expect(all.length).toBe(5);

      // Fire concurrent status updates
      await Promise.all(
        results.map((entity, i) =>
          WatchedFolderRepository.updateStatus(entity.id, 'processing', undefined, {
            totalDetected: i + 1,
          })
        )
      );

      // Verify all updates persisted cleanly
      for (let i = 0; i < 5; i++) {
        const reloaded = await WatchedFolderRepository.get(results[i].id);
        expect(reloaded?.status).toBe('processing');
        expect(reloaded?.stats.totalDetected).toBe(i + 1);
      }
    });
  });
});
