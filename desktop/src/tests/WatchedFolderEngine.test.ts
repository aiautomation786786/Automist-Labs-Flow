import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WatchedFolderRepository } from '../main/storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../main/storage/WatchedFolderHistoryRepository';
import { WatchedFolderMonitor } from '../main/watcher/WatchedFolderMonitor';
import { WatchedFolderEngine } from '../main/watcher/WatchedFolderEngine';
import type { WatchedFolderEntity, WatchedFileRecord } from '../shared/types';

describe('WatchedFolderEngine & WatchedFolderMonitor Unit & Safety Tests', () => {
  let tmpBaseDir: string;
  let testWatchedDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-watcher-engine-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;

    testWatchedDir = path.join(tmpBaseDir, 'inbox');
    fs.mkdirSync(testWatchedDir, { recursive: true });

    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
    WatchedFolderEngine.resetInstance();
  });

  afterEach(() => {
    WatchedFolderEngine.resetInstance();
    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  // Helper to create a configured test entity
  async function createTestWatcher(overrides: Partial<WatchedFolderEntity> = {}): Promise<WatchedFolderEntity> {
    return await WatchedFolderRepository.create({
      name: 'Inbox Watcher',
      folderPath: testWatchedDir,
      rules: {
        stabilityDurationMs: 200, // Fast 200ms window for unit testing
        maxBatchSize: 5,
        ingestOrder: 'oldest_first',
        deleteSourceOnSuccess: false,
        ...(overrides.rules || {}),
      },
      enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    });
  }

  describe('1. Media Detection & File Filtering', () => {
    it('detects supported video formats (.mp4, .mov, .mkv)', async () => {
      const entity = await createTestWatcher();
      const readyFiles: WatchedFileRecord[] = [];

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: (rec) => {
          readyFiles.push(rec);
        },
      });

      // Place 3 supported files
      fs.writeFileSync(path.join(testWatchedDir, 'clip1.mp4'), 'mp4_payload_bytes');
      fs.writeFileSync(path.join(testWatchedDir, 'clip2.mov'), 'mov_payload_bytes');
      fs.writeFileSync(path.join(testWatchedDir, 'clip3.mkv'), 'mkv_payload_bytes');

      // First scan: files are detected and entered into 'stabilizing' state
      const scan1 = await monitor.scanNow();
      expect(scan1.detected).toBe(3);
      expect(scan1.ready).toBe(0);

      // Verify history ledger records them as 'stabilizing', NOT 'ingested'
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history.length).toBe(3);
      expect(history.every((h) => h.status === 'stabilizing')).toBe(true);

      // Wait for stability duration (200ms)
      await new Promise((res) => setTimeout(res, 250));

      // Second scan: files should transition to 'ready'
      const scan2 = await monitor.scanNow();
      expect(scan2.ready).toBe(3);
      expect(readyFiles.length).toBe(3);

      // Verify ledger now has them as 'ready', but STILL NOT 'ingested'
      const historyAfter = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(historyAfter.every((h) => h.status === 'ready')).toBe(true);

      monitor.stop();
    });

    it('ignores unsupported file types (.txt, .jpg, .zip, .pdf)', async () => {
      const entity = await createTestWatcher();
      const monitor = new WatchedFolderMonitor(entity);

      fs.writeFileSync(path.join(testWatchedDir, 'notes.txt'), 'notes');
      fs.writeFileSync(path.join(testWatchedDir, 'thumb.jpg'), 'image');
      fs.writeFileSync(path.join(testWatchedDir, 'bundle.zip'), 'archive');
      fs.writeFileSync(path.join(testWatchedDir, 'doc.pdf'), 'pdf document');

      const result = await monitor.scanNow();
      expect(result.detected).toBe(0);
      expect(result.ready).toBe(0);

      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history.length).toBe(0);

      monitor.stop();
    });

    it('ignores temporary, partial, and browser download files', async () => {
      const entity = await createTestWatcher();
      const monitor = new WatchedFolderMonitor(entity);

      fs.writeFileSync(path.join(testWatchedDir, 'video.mp4.crdownload'), 'downloading');
      fs.writeFileSync(path.join(testWatchedDir, 'clip.tmp'), 'temp');
      fs.writeFileSync(path.join(testWatchedDir, 'stream.mp4.part'), 'partial');
      fs.writeFileSync(path.join(testWatchedDir, 'torrent.mp4.!ut'), 'utorrent');
      fs.writeFileSync(path.join(testWatchedDir, '.hidden_video.mp4'), 'hidden');
      fs.writeFileSync(path.join(testWatchedDir, 'Thumbs.db'), 'thumbdb');

      const result = await monitor.scanNow();
      expect(result.detected).toBe(0);
      expect(result.ready).toBe(0);

      monitor.stop();
    });
  });

  describe('2. File Stability & Copy-in-Progress Detection', () => {
    it('holds an unstable file whose size keeps changing', async () => {
      const entity = await createTestWatcher();
      const readyFiles: WatchedFileRecord[] = [];
      const monitor = new WatchedFolderMonitor(entity, {
        onMediaReady: (rec) => readyFiles.push(rec),
      });

      const filePath = path.join(testWatchedDir, 'large_transfer.mp4');
      fs.writeFileSync(filePath, 'chunk_1');

      // Scan 1: detected and marked stabilizing
      await monitor.scanNow();
      expect(readyFiles.length).toBe(0);

      // Wait 100ms, then append more data (simulating copy in progress)
      await new Promise((res) => setTimeout(res, 100));
      fs.appendFileSync(filePath, '_chunk_2_extra_data');

      // Scan 2: monitor should detect size modification and reset stability window
      await monitor.scanNow();
      expect(readyFiles.length).toBe(0);

      // Wait another 100ms (still within 200ms from the reset)
      await new Promise((res) => setTimeout(res, 100));
      await monitor.scanNow();
      expect(readyFiles.length).toBe(0);

      // Wait full 250ms with NO changes
      await new Promise((res) => setTimeout(res, 250));
      const scanDone = await monitor.scanNow();
      expect(scanDone.ready).toBe(1);
      expect(readyFiles.length).toBe(1);
      expect(readyFiles[0].filename).toBe('large_transfer.mp4');

      monitor.stop();
    });

    it('does not mark zero-byte files as ready', async () => {
      const entity = await createTestWatcher();
      const monitor = new WatchedFolderMonitor(entity);

      const emptyFile = path.join(testWatchedDir, 'empty.mp4');
      fs.writeFileSync(emptyFile, '');

      await monitor.scanNow();
      await new Promise((res) => setTimeout(res, 250));
      const scan = await monitor.scanNow();
      expect(scan.ready).toBe(0);

      monitor.stop();
    });
  });

  describe('3. Deduplication & Race Protection', () => {
    it('skips duplicate metadata without re-hashing', async () => {
      const entity = await createTestWatcher();
      const monitor = new WatchedFolderMonitor(entity);

      const filePath = path.join(testWatchedDir, 'already_done.mp4');
      fs.writeFileSync(filePath, 'same_content_here');
      const stat = fs.statSync(filePath);

      // Manually simulate a fully ingested record in history ledger
      await WatchedFolderHistoryRepository.recordFile(entity.id, {
        filePath,
        filename: 'already_done.mp4',
        fileSizeBytes: stat.size,
        fileMtimeMs: stat.mtimeMs,
        hashSha256: 'some_hash_123',
        status: 'ingested',
        detectedAt: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      });

      // Scan: should skip via cheap metadata check
      const scan = await monitor.scanNow();
      expect(scan.detected).toBe(0);
      expect(scan.ready).toBe(0);

      monitor.stop();
    });

    it('skips duplicate SHA-256 even if filename or path changes', async () => {
      const entity = await createTestWatcher();
      const readyFiles: WatchedFileRecord[] = [];
      const monitor = new WatchedFolderMonitor(entity, {
        onMediaReady: (rec) => readyFiles.push(rec),
      });

      const originalPath = path.join(testWatchedDir, 'clip_alpha.mp4');
      fs.writeFileSync(originalPath, 'identical_video_content_payload');

      // First pass: detect
      await monitor.scanNow();
      await new Promise((res) => setTimeout(res, 250));
      // Second pass: mark ready
      await monitor.scanNow();
      expect(readyFiles.length).toBe(1);

      // Simulate Phase 4C marking clip_alpha as 'ingested'
      await WatchedFolderHistoryRepository.recordFile(entity.id, {
        id: readyFiles[0].id,
        filePath: originalPath,
        filename: 'clip_alpha.mp4',
        fileSizeBytes: readyFiles[0].fileSizeBytes,
        fileMtimeMs: readyFiles[0].fileMtimeMs,
        hashSha256: readyFiles[0].hashSha256,
        status: 'ingested',
        detectedAt: readyFiles[0].detectedAt,
        ingestedAt: new Date().toISOString(),
      });

      // Now place the EXACT same content under a new name
      const copyPath = path.join(testWatchedDir, 'clip_beta.mp4');
      fs.writeFileSync(copyPath, 'identical_video_content_payload');

      // Detect beta
      await monitor.scanNow();
      await new Promise((res) => setTimeout(res, 250));
      // Second scan should catch hash duplicate
      const scanCopy = await monitor.scanNow();
      expect(scanCopy.skippedDuplicates).toBe(1);
      expect(scanCopy.ready).toBe(0);

      // Check beta is recorded as skipped_duplicate
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      const betaRec = history.find((h) => h.filename === 'clip_beta.mp4');
      expect(betaRec?.status).toBe('skipped_duplicate');

      monitor.stop();
    });

    it('protects against concurrent scan races so only one ready handoff occurs', async () => {
      const entity = await createTestWatcher();
      let readyDispatches = 0;
      const monitor = new WatchedFolderMonitor(entity, {
        onMediaReady: async () => {
          readyDispatches++;
          // Simulate slight async delay
          await new Promise((res) => setTimeout(res, 50));
        },
      });

      const videoFile = path.join(testWatchedDir, 'race_test.mp4');
      fs.writeFileSync(videoFile, 'race_content_bytes');

      await monitor.scanNow();
      await new Promise((res) => setTimeout(res, 250));

      // Trigger 2 scans concurrently
      await Promise.all([
        monitor.scanNow(),
        monitor.scanNow(),
      ]);

      expect(readyDispatches).toBe(1);

      monitor.stop();
    });
  });

  describe('4. FIFO & Batch Slicing Safety', () => {
    it('sorts candidates oldest-first and respects maxBatchSize without stalling next scans', async () => {
      // Create watcher with maxBatchSize: 2
      const entity = await WatchedFolderRepository.create({
        name: 'Batch Test Watcher',
        folderPath: testWatchedDir,
        rules: {
          stabilityDurationMs: 100,
          maxBatchSize: 2,
          ingestOrder: 'oldest_first',
          deleteSourceOnSuccess: false,
        },
        enabled: true,
      });

      const readyOrder: string[] = [];
      const monitor = new WatchedFolderMonitor(entity, {
        onMediaReady: (rec) => {
          readyOrder.push(rec.filename);
        },
      });

      // Create 4 files with staggered mtimes
      const now = Date.now();
      for (let i = 1; i <= 4; i++) {
        const filePath = path.join(testWatchedDir, `file_${i}.mp4`);
        fs.writeFileSync(filePath, `data_for_file_${i}`);
        // Set older timestamps for lower indices
        const fileTime = (now - (5000 - i * 1000)) / 1000;
        fs.utimesSync(filePath, fileTime, fileTime);
      }

      // Initial detection
      await monitor.scanNow();
      await new Promise((res) => setTimeout(res, 150));

      // First batch scan: should pick exactly 2 oldest files (file_1, file_2)
      const scan1 = await monitor.scanNow();
      expect(scan1.ready).toBe(2);
      expect(readyOrder).toEqual(['file_1.mp4', 'file_2.mp4']);

      // Simulate Phase 4C completing ingestion for file_1 and file_2
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      for (const rec of history.filter((h) => h.status === 'ready')) {
        await WatchedFolderHistoryRepository.recordFile(entity.id, {
          ...rec,
          status: 'ingested',
          ingestedAt: new Date().toISOString(),
        });
      }

      // Second batch scan: picks remaining 2 files (file_3, file_4)
      const scan2 = await monitor.scanNow();
      expect(scan2.ready).toBe(2);
      expect(readyOrder).toEqual(['file_1.mp4', 'file_2.mp4', 'file_3.mp4', 'file_4.mp4']);

      monitor.stop();
    });
  });

  describe('5. Error Handling & Inaccessible Folder Backoff', () => {
    it('sets error status and backs off cleanly when watched folder is deleted', async () => {
      const missingFolder = path.join(tmpBaseDir, 'deleted_folder');
      fs.mkdirSync(missingFolder);

      const entity = await WatchedFolderRepository.create({
        name: 'Volatile Folder',
        folderPath: missingFolder,
        enabled: true,
      });

      const monitor = new WatchedFolderMonitor(entity, { pollIntervalMs: 100 });

      // Delete the folder externally
      fs.rmSync(missingFolder, { recursive: true, force: true });

      // Scan should catch error
      const scanResult = await monitor.scanNow();
      expect(scanResult.ready).toBe(0);
      expect(monitor.currentStatus).toBe('error');

      const reloaded = await WatchedFolderRepository.get(entity.id);
      expect(reloaded?.status).toBe('error');
      expect(reloaded?.lastError).toContain('does not exist');

      monitor.stop();
    });
  });

  describe('6. WatchedFolderEngine Lifecycle & Restart Behavior', () => {
    it('initializes and restores enabled watchers upon application startup', async () => {
      // Create 2 enabled watchers and 1 paused watcher in repository
      const w1 = await createTestWatcher({ name: 'Active 1' } as any);
      const otherDir = path.join(tmpBaseDir, 'other_inbox');
      fs.mkdirSync(otherDir, { recursive: true });

      const w2 = await WatchedFolderRepository.create({
        name: 'Active 2',
        folderPath: otherDir,
        enabled: true,
      });

      const pausedDir = path.join(tmpBaseDir, 'paused_inbox');
      fs.mkdirSync(pausedDir, { recursive: true });
      await WatchedFolderRepository.create({
        name: 'Paused Watcher',
        folderPath: pausedDir,
        enabled: false,
      });

      // Initialize Engine (cold start simulation)
      const engine = WatchedFolderEngine.getInstance();
      await engine.initialize();

      const running = engine.getRunningWatchers();
      expect(running.length).toBe(2);
      expect(running).toContain(w1.id);
      expect(running).toContain(w2.id);

      // Shutdown cleanly
      engine.shutdown();
      expect(engine.getRunningWatchers().length).toBe(0);
    });

    it('dynamically reacts to pause, resume, and delete via syncWatcher', async () => {
      const entity = await createTestWatcher();
      const engine = WatchedFolderEngine.getInstance();
      await engine.initialize();

      expect(engine.getRunningWatchers()).toContain(entity.id);

      // Pause watcher
      await WatchedFolderRepository.setPaused(entity.id, true);
      await engine.syncWatcher(entity.id);
      expect(engine.getRunningWatchers()).not.toContain(entity.id);

      // Resume watcher
      await WatchedFolderRepository.setPaused(entity.id, false);
      await engine.syncWatcher(entity.id);
      expect(engine.getRunningWatchers()).toContain(entity.id);

      // Delete watcher
      await WatchedFolderRepository.delete(entity.id);
      engine.removeWatcher(entity.id);
      expect(engine.getRunningWatchers()).not.toContain(entity.id);

      engine.shutdown();
    });

    it('survives restart without duplicate ingestion or losing un-ingested files', async () => {
      const entity = await createTestWatcher();
      const filePath = path.join(testWatchedDir, 'restart_test.mp4');
      fs.writeFileSync(filePath, 'restart_test_data');

      // First run: detect and stabilize
      const monitor1 = new WatchedFolderMonitor(entity, { pollIntervalMs: 50 });
      await monitor1.scanNow();
      await new Promise((res) => setTimeout(res, 250));
      await monitor1.scanNow();

      // State is 'ready'
      const history1 = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history1.length).toBe(1);
      expect(history1[0].status).toBe('ready');

      // Stop monitor 1 (simulating abrupt app exit before ingestion handoff)
      monitor1.stop();

      // Clear memory caches to simulate cold boot
      WatchedFolderRepository.clearCache();
      WatchedFolderHistoryRepository.clearCache();

      // Restart: because file is NOT marked 'ingested', it must still be recoverable
      const monitor2 = new WatchedFolderMonitor(entity, { pollIntervalMs: 50 });
      // File has not changed on disk; stability check recognizes it and keeps it ready
      await monitor2.scanNow();

      const history2 = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history2.length).toBe(1);
      expect(history2[0].filename).toBe('restart_test.mp4');

      monitor2.stop();
    });
  });
});
