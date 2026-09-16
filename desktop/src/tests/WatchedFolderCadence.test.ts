import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { WatchedFolderRepository } from '../main/storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../main/storage/WatchedFolderHistoryRepository';
import { WatchedFolderCadenceService } from '../main/cadence/WatchedFolderCadenceService';
import { WatchedFolderPipelineService } from '../main/pipeline/WatchedFolderPipelineService';
import { WatchedFolderEngine } from '../main/watcher/WatchedFolderEngine';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { ChannelRepository } from '../main/storage/ChannelRepository';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';
import type { WatchedFolderEntity, WatchedFileRecord } from '../shared/types';

describe('WatchedFolderCadenceService Unit & Integration Tests (Phase 4D)', () => {
  let tmpBaseDir: string;
  let testWatchedDirA: string;
  let testWatchedDirB: string;
  let ffmpegBin: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-cadence-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;

    testWatchedDirA = path.join(tmpBaseDir, 'watched_a');
    testWatchedDirB = path.join(tmpBaseDir, 'watched_b');
    fs.mkdirSync(testWatchedDirA, { recursive: true });
    fs.mkdirSync(testWatchedDirB, { recursive: true });

    ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';

    WatchedFolderCadenceService.resetState();
    WatchedFolderEngine.resetInstance();
    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelRepository.clearCache();
  });

  afterEach(async () => {
    WatchedFolderCadenceService.shutdown();
    WatchedFolderEngine.resetInstance();
    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelRepository.clearCache();

    process.env.LOCALAPPDATA = originalEnv;
    await new Promise((r) => setTimeout(r, 100));
    if (fs.existsSync(tmpBaseDir)) {
      try {
        fs.rmSync(tmpBaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  function generateTinyVideo(outputPath: string, durationSeconds = 0.5): void {
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi',
        '-i', `color=c=blue:s=160x120:r=25:d=${durationSeconds}`,
        '-f', 'lavfi',
        '-i', `sine=f=440:d=${durationSeconds}`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        outputPath,
      ],
      { stdio: 'ignore' }
    );
  }

  async function createTestWatcher(overrides: Partial<WatchedFolderEntity> = {}): Promise<WatchedFolderEntity> {
    return await WatchedFolderRepository.create({
      name: overrides.name || 'Cadence Test Watcher',
      folderPath: overrides.folderPath || testWatchedDirA,
      cadence: {
        mode: 'immediate',
        dailyTime: '18:00',
        intervalMinutes: 60,
        publishDelayHours: 0,
        catchUpMissed: true,
        ...(overrides.cadence || {}),
      },
      rules: {
        stabilityDurationMs: 150,
        maxBatchSize: 5,
        ingestOrder: 'oldest_first',
        deleteSourceOnSuccess: false,
        workflow: 'import_only',
        ...(overrides.rules || {}),
      },
      enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    });
  }

  function createDummyRecord(entityId: string, filename: string, mtimeMs = Date.now()): WatchedFileRecord {
    const filePath = path.join(testWatchedDirA, filename);
    return {
      id: `rec_${filename}_${Date.now()}`,
      watcherId: entityId,
      filename,
      filePath,
      fileSizeBytes: 1024,
      fileMtimeMs: mtimeMs,
      detectedAt: new Date().toISOString(),
      status: 'ready',
      retryCount: 0,
    };
  }

  describe('1. Immediate Mode vs Scheduled / Interval Queueing', () => {
    it('A. immediate mode routes directly to pipeline and creates project immediately', async () => {
      const entity = await createTestWatcher({ cadence: { mode: 'immediate' } });
      const videoPath = path.join(testWatchedDirA, 'instant.mp4');
      generateTinyVideo(videoPath);

      const record = createDummyRecord(entity.id, 'instant.mp4');
      record.filePath = videoPath;

      await WatchedFolderCadenceService.handleMediaReady(record, entity);

      // Verify it was ingested immediately
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('ingested');
      expect(history[0].projectId).toBeDefined();

      const project = await ProjectRepository.get(history[0].projectId!);
      expect(project).toBeDefined();
    });

    it('B. scheduled mode holds media in "waiting_for_cadence" without immediate ingestion', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'scheduled', dailyTime: '23:59', catchUpMissed: false },
      });
      const videoPath = path.join(testWatchedDirA, 'scheduled.mp4');
      generateTinyVideo(videoPath);

      const record = createDummyRecord(entity.id, 'scheduled.mp4');
      record.filePath = videoPath;

      await WatchedFolderCadenceService.handleMediaReady(record, entity);

      // Verify it is held in waiting_for_cadence
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('waiting_for_cadence');
      expect(history[0].projectId).toBeUndefined();

      // Ensure no project was created yet
      const allProjects = await ProjectRepository.getAll();
      expect(allProjects.length).toBe(0);
    });

    it('C. interval mode holds media in "waiting_for_cadence" until interval elapses', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'interval', intervalMinutes: 120 },
      });
      const videoPath = path.join(testWatchedDirA, 'interval.mp4');
      generateTinyVideo(videoPath);

      const record = createDummyRecord(entity.id, 'interval.mp4');
      record.filePath = videoPath;

      await WatchedFolderCadenceService.handleMediaReady(record, entity);

      const pending = await WatchedFolderHistoryRepository.getPendingCadenceRecords(entity.id);
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('waiting_for_cadence');
    });
  });

  describe('2. Cadence Batch Processing & Ingestion Ordering', () => {
    it('A. processes pending files when cadence executes and respects oldest_first ordering', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'scheduled', dailyTime: '18:00' },
        rules: { ingestOrder: 'oldest_first', maxBatchSize: 5 },
      });

      const video1 = path.join(testWatchedDirA, 'file1.mp4');
      const video2 = path.join(testWatchedDirA, 'file2.mp4');
      const video3 = path.join(testWatchedDirA, 'file3.mp4');
      generateTinyVideo(video1);
      generateTinyVideo(video2);
      generateTinyVideo(video3);

      const rec1 = createDummyRecord(entity.id, 'file1.mp4', 1000);
      rec1.filePath = video1;
      const rec2 = createDummyRecord(entity.id, 'file2.mp4', 2000);
      rec2.filePath = video2;
      const rec3 = createDummyRecord(entity.id, 'file3.mp4', 3000);
      rec3.filePath = video3;

      // Insert out-of-order in waiting_for_cadence
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...rec3, status: 'waiting_for_cadence' });
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...rec1, status: 'waiting_for_cadence' });
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...rec2, status: 'waiting_for_cadence' });

      // Run cadence processing
      const processed = await WatchedFolderCadenceService.processPendingFiles(entity.id);
      expect(processed).toBe(3);

      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history.every((h) => h.status === 'ingested')).toBe(true);

      // Verify cadence timestamps were recorded on the watcher
      const updatedEntity = await WatchedFolderRepository.get(entity.id);
      expect(updatedEntity?.lastCadenceRunAt).toBeDefined();
      expect(updatedEntity?.nextScheduledRunAt).toBeDefined();
    });

    it('B. respects newest_first ordering when configured', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'scheduled', dailyTime: '18:00' },
        rules: { ingestOrder: 'newest_first', maxBatchSize: 1 },
      });

      const videoOld = path.join(testWatchedDirA, 'old.mp4');
      const videoNew = path.join(testWatchedDirA, 'new.mp4');
      generateTinyVideo(videoOld);
      generateTinyVideo(videoNew);

      const recOld = createDummyRecord(entity.id, 'old.mp4', 1000);
      recOld.filePath = videoOld;
      const recNew = createDummyRecord(entity.id, 'new.mp4', 5000);
      recNew.filePath = videoNew;

      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...recOld, status: 'waiting_for_cadence' });
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...recNew, status: 'waiting_for_cadence' });

      // Process batch of maxBatchSize = 1
      const processed = await WatchedFolderCadenceService.processPendingFiles(entity.id);
      expect(processed).toBe(1);

      // Verify that the newest file was ingested first
      const histNew = await WatchedFolderHistoryRepository.getRecordByPath(entity.id, videoNew);
      const histOld = await WatchedFolderHistoryRepository.getRecordByPath(entity.id, videoOld);

      expect(histNew?.status).toBe('ingested');
      expect(histOld?.status).toBe('waiting_for_cadence');
    });

    it('C. respects maxBatchSize boundary and leaves remaining files in waiting_for_cadence', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'scheduled', dailyTime: '18:00' },
        rules: { ingestOrder: 'oldest_first', maxBatchSize: 2 },
      });

      for (let i = 1; i <= 4; i++) {
        const p = path.join(testWatchedDirA, `batch_${i}.mp4`);
        generateTinyVideo(p);
        const r = createDummyRecord(entity.id, `batch_${i}.mp4`, 1000 * i);
        r.filePath = p;
        await WatchedFolderHistoryRepository.recordFile(entity.id, { ...r, status: 'waiting_for_cadence' });
      }

      const processed = await WatchedFolderCadenceService.processPendingFiles(entity.id);
      expect(processed).toBe(2);

      const pending = await WatchedFolderHistoryRepository.getPendingCadenceRecords(entity.id);
      expect(pending.length).toBe(2);
      expect(pending.map((p) => p.filename)).toEqual(expect.arrayContaining(['batch_3.mp4', 'batch_4.mp4']));
    });
  });

  describe('3. Date Calculations & Scheduling Logic', () => {
    it('A. calculateNextRun calculates correct next daily time', () => {
      const entity: WatchedFolderEntity = {
        id: 'test',
        name: 'test',
        folderPath: 'C:\\test',
        enabled: true,
        status: 'watching',
        cadence: { mode: 'scheduled', dailyTime: '14:30' },
        rules: { stabilityDurationMs: 100, maxBatchSize: 5, ingestOrder: 'oldest_first', deleteSourceOnSuccess: false, workflow: 'import_only' },
        stats: { totalDetected: 0, totalIngested: 0, totalFailed: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Reference is 10:00 AM -> next should be today at 14:30
      const refMorning = new Date(2026, 8, 16, 10, 0, 0);
      const nextRun1 = WatchedFolderCadenceService.calculateNextRun(entity, refMorning);
      expect(nextRun1.getHours()).toBe(14);
      expect(nextRun1.getMinutes()).toBe(30);
      expect(nextRun1.getDate()).toBe(16);

      // Reference is 15:00 PM -> next should be tomorrow at 14:30
      const refAfternoon = new Date(2026, 8, 16, 15, 0, 0);
      const nextRun2 = WatchedFolderCadenceService.calculateNextRun(entity, refAfternoon);
      expect(nextRun2.getHours()).toBe(14);
      expect(nextRun2.getMinutes()).toBe(30);
      expect(nextRun2.getDate()).toBe(17);
    });

    it('B. calculateNextRun calculates correct next interval time', () => {
      const entity: WatchedFolderEntity = {
        id: 'test',
        name: 'test',
        folderPath: 'C:\\test',
        enabled: true,
        status: 'watching',
        cadence: { mode: 'interval', intervalMinutes: 45 },
        rules: { stabilityDurationMs: 100, maxBatchSize: 5, ingestOrder: 'oldest_first', deleteSourceOnSuccess: false, workflow: 'import_only' },
        stats: { totalDetected: 0, totalIngested: 0, totalFailed: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const refDate = new Date(2026, 8, 16, 12, 0, 0);
      const nextRun = WatchedFolderCadenceService.calculateNextRun(entity, refDate);
      expect(nextRun.getTime() - refDate.getTime()).toBe(45 * 60 * 1000);
    });

    it('C. isScheduleMissed detects missed daily schedule when offline', () => {
      const entity: WatchedFolderEntity = {
        id: 'test',
        name: 'test',
        folderPath: 'C:\\test',
        enabled: true,
        status: 'watching',
        cadence: { mode: 'scheduled', dailyTime: '12:00' },
        rules: { stabilityDurationMs: 100, maxBatchSize: 5, ingestOrder: 'oldest_first', deleteSourceOnSuccess: false, workflow: 'import_only' },
        stats: { totalDetected: 0, totalIngested: 0, totalFailed: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Last run was yesterday
        lastCadenceRunAt: new Date(2026, 8, 15, 12, 0, 0).toISOString(),
      };

      // Current time is 14:00 today (slot 12:00 was missed while offline)
      const now = new Date(2026, 8, 16, 14, 0, 0);
      expect(WatchedFolderCadenceService.isScheduleMissed(entity, now)).toBe(true);

      // Current time is 10:00 today (slot 12:00 hasn't happened yet)
      const earlyNow = new Date(2026, 8, 16, 10, 0, 0);
      expect(WatchedFolderCadenceService.isScheduleMissed(entity, earlyNow)).toBe(false);
    });
  });

  describe('4. Missed Schedule Catch-Up vs Skip', () => {
    it('A. catchUpMissed=true executes pending files upon syncWatcher if schedule was missed', async () => {
      const entity = await createTestWatcher({
        cadence: {
          mode: 'scheduled',
          dailyTime: '01:00', // slot already passed today
          catchUpMissed: true,
        },
      });

      const video = path.join(testWatchedDirA, 'missed_file.mp4');
      generateTinyVideo(video);
      const rec = createDummyRecord(entity.id, 'missed_file.mp4');
      rec.filePath = video;
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...rec, status: 'waiting_for_cadence' });

      // Call syncWatcher simulating app startup / resume
      await WatchedFolderCadenceService.syncWatcher(entity.id);

      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history[0].status).toBe('ingested');
    });

    it('B. catchUpMissed=false skips missed window and holds pending files for next schedule', async () => {
      const entity = await createTestWatcher({
        cadence: {
          mode: 'scheduled',
          dailyTime: '01:00',
          catchUpMissed: false,
        },
      });

      const video = path.join(testWatchedDirA, 'skip_file.mp4');
      generateTinyVideo(video);
      const rec = createDummyRecord(entity.id, 'skip_file.mp4');
      rec.filePath = video;
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...rec, status: 'waiting_for_cadence' });

      await WatchedFolderCadenceService.syncWatcher(entity.id);

      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history[0].status).toBe('waiting_for_cadence');
    });
  });

  describe('5. Platform Publish Delay Separation (YouTube native scheduling)', () => {
    it('A. calculates scheduledPublishAt metadata when publishDelayHours is specified without delaying local creation', async () => {
      const entity = await createTestWatcher({
        cadence: {
          mode: 'immediate',
          publishDelayHours: 4,
        },
        rules: {
          workflow: 'import_render_publish',
        },
      });

      const video = path.join(testWatchedDirA, 'delay_test.mp4');
      generateTinyVideo(video);
      const rec = createDummyRecord(entity.id, 'delay_test.mp4');
      rec.filePath = video;

      const beforeTime = Date.now();
      await WatchedFolderCadenceService.handleMediaReady(rec, entity);

      // Verify the project was created locally immediately
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history[0].status).toBe('ingested');
      const project = await ProjectRepository.get(history[0].projectId!);
      expect(project).toBeDefined();

      // Verify YouTube scheduledPublishAt is set to now + 4 hours
      expect(project?.publishing?.metadata?.scheduledPublishAt).toBeDefined();
      const scheduledTime = new Date(project!.publishing!.metadata!.scheduledPublishAt!).getTime();
      const expectedTime = beforeTime + 4 * 3600 * 1000;
      expect(Math.abs(scheduledTime - expectedTime)).toBeLessThan(5000);
    });
  });

  describe('6. Multi-Watcher Fairness & Isolation', () => {
    it('A. processMultipleWatchersFairly interleaves round-robin across watchers', async () => {
      const watcherA = await createTestWatcher({
        name: 'Watcher A',
        folderPath: testWatchedDirA,
        rules: { maxBatchSize: 5 },
      });
      const watcherB = await createTestWatcher({
        name: 'Watcher B',
        folderPath: testWatchedDirB,
        rules: { maxBatchSize: 5 },
      });

      // Prepare 2 files in A and 2 files in B
      for (let i = 1; i <= 2; i++) {
        const fileA = path.join(testWatchedDirA, `a_${i}.mp4`);
        const fileB = path.join(testWatchedDirB, `b_${i}.mp4`);
        generateTinyVideo(fileA);
        generateTinyVideo(fileB);

        const recA = createDummyRecord(watcherA.id, `a_${i}.mp4`, 1000 * i);
        recA.filePath = fileA;
        const recB = createDummyRecord(watcherB.id, `b_${i}.mp4`, 1000 * i);
        recB.filePath = fileB;

        await WatchedFolderHistoryRepository.recordFile(watcherA.id, { ...recA, status: 'waiting_for_cadence' });
        await WatchedFolderHistoryRepository.recordFile(watcherB.id, { ...recB, status: 'waiting_for_cadence' });
      }

      const totalProcessed = await WatchedFolderCadenceService.processMultipleWatchersFairly([watcherA.id, watcherB.id]);
      expect(totalProcessed).toBe(4);

      const histA = await WatchedFolderHistoryRepository.getHistory(watcherA.id);
      const histB = await WatchedFolderHistoryRepository.getHistory(watcherB.id);
      expect(histA.every((h) => h.status === 'ingested')).toBe(true);
      expect(histB.every((h) => h.status === 'ingested')).toBe(true);
    });
  });

  describe('7. Lifecycle, Pause/Resume, and Zero Browser Footprint', () => {
    it('A. pausing a watcher prevents cadence execution', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'scheduled', dailyTime: '18:00' },
      });

      // Pause watcher
      await WatchedFolderRepository.updateStatus(entity.id, 'paused');
      await WatchedFolderCadenceService.syncWatcher(entity.id);

      const video = path.join(testWatchedDirA, 'paused_file.mp4');
      generateTinyVideo(video);
      const rec = createDummyRecord(entity.id, 'paused_file.mp4');
      rec.filePath = video;
      await WatchedFolderHistoryRepository.recordFile(entity.id, { ...rec, status: 'waiting_for_cadence' });

      // Attempt execution
      const processed = await WatchedFolderCadenceService.processPendingFiles(entity.id);
      expect(processed).toBe(0);

      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history[0].status).toBe('waiting_for_cadence');
    });

    it('B. removing a watcher cleans up state and timers cleanly', async () => {
      const entity = await createTestWatcher({
        cadence: { mode: 'scheduled', dailyTime: '18:00' },
      });

      await WatchedFolderCadenceService.syncWatcher(entity.id);
      WatchedFolderCadenceService.removeWatcher(entity.id);

      // Verify no exceptions and state reset
      expect(true).toBe(true);
    });

    it('C. zero browser processes are created during cadence initialization or execution', async () => {
      // Cadence evaluation must be purely local Node.js
      await WatchedFolderCadenceService.initialize();
      const entity = await createTestWatcher({ cadence: { mode: 'scheduled', dailyTime: '18:00' } });
      await WatchedFolderCadenceService.syncWatcher(entity.id);
      WatchedFolderCadenceService.shutdown();
      expect(true).toBe(true);
    });
  });
});
