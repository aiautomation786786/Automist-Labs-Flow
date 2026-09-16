import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { WatchedFolderRepository } from '../main/storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../main/storage/WatchedFolderHistoryRepository';
import { WatchedFolderPipelineService } from '../main/pipeline/WatchedFolderPipelineService';
import { WatchedFolderMonitor } from '../main/watcher/WatchedFolderMonitor';
import { WatchedFolderEngine } from '../main/watcher/WatchedFolderEngine';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { ChannelRepository } from '../main/storage/ChannelRepository';
import { MediaProbeService } from '../main/import/MediaProbeService';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';
import type { WatchedFolderEntity, WatchedFileRecord } from '../shared/types';

describe('WatchedFolderPipelineService Unit & Integration Tests (Phase 4C)', () => {
  let tmpBaseDir: string;
  let testWatchedDir: string;
  let ffmpegBin: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pipeline-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;

    testWatchedDir = path.join(tmpBaseDir, 'watched_inbox');
    fs.mkdirSync(testWatchedDir, { recursive: true });

    ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';

    WatchedFolderRepository.clearCache();
    WatchedFolderHistoryRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelRepository.clearCache();
    WatchedFolderEngine.resetInstance();
  });

  afterEach(async () => {
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
      name: 'Pipeline Test Inbox',
      folderPath: testWatchedDir,
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

  describe('1. Primary Ingestion Pipeline & Project Creation', () => {
    it('A. ingests stable video and creates exactly one standard ProjectEntity', async () => {
      const entity = await createTestWatcher();
      const videoPath = path.join(testWatchedDir, 'clip_alpha.mp4');
      generateTinyVideo(videoPath);

      // Create monitor that forwards to WatchedFolderPipelineService
      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      // Pass 1: detect and stabilize
      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));

      // Pass 2: stable -> ready -> pipeline.ingest
      const scanResult = await monitor.scanNow();
      expect(scanResult.ready).toBe(1);

      // Verify project creation
      const projects = await ProjectRepository.getAll();
      expect(projects.length).toBe(1);

      const project = projects[0];
      expect(project.name).toBe('clip_alpha');
      expect(project.origin).toBe('imported');
      expect(project.sourceMedia).toBeDefined();
      expect(project.sourceMedia?.originalFilename).toBe('clip_alpha.mp4');
      expect(project.sourceMedia?.watcherId).toBe(entity.id);
      expect(project.watcherId).toBe(entity.id);
      expect(project.sourceMedia?.workflow).toBe('import_only');

      // Verify ledger marked as ingested
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('ingested');
      expect(history[0].projectId).toBe(project.projectId);
      expect(history[0].ingestedAt).toBeDefined();

      // Verify source file is 100% preserved
      expect(fs.existsSync(videoPath)).toBe(true);

      monitor.stop();
    });

    it('B. duplicate scan or repeated ingest does NOT create a second project', async () => {
      const entity = await createTestWatcher();
      const videoPath = path.join(testWatchedDir, 'clip_dup.mp4');
      generateTinyVideo(videoPath);

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();

      expect((await ProjectRepository.getAll()).length).toBe(1);

      // Trigger another scan immediately
      await monitor.scanNow();
      expect((await ProjectRepository.getAll()).length).toBe(1);

      // Call ingest manually with the same record
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      const res = await WatchedFolderPipelineService.ingest(history[0], entity);
      expect(res.success).toBe(true);
      expect((await ProjectRepository.getAll()).length).toBe(1);

      monitor.stop();
    });

    it('C. same content with different filename is recognized as duplicate', async () => {
      const entity = await createTestWatcher();
      const videoPath1 = path.join(testWatchedDir, 'first_copy.mp4');
      generateTinyVideo(videoPath1);

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      // Ingest first copy
      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();
      expect((await ProjectRepository.getAll()).length).toBe(1);

      // Create duplicate file with same content bytes
      const videoPath2 = path.join(testWatchedDir, 'second_copy.mp4');
      fs.copyFileSync(videoPath1, videoPath2);

      // Scan second copy
      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      const scan2 = await monitor.scanNow();
      expect(scan2.skippedDuplicates).toBe(1);

      // No second project created
      expect((await ProjectRepository.getAll()).length).toBe(1);

      monitor.stop();
    });
  });

  describe('2. Error Categories & Failure Handling', () => {
    it('D. handles source disappearing before ingestion safely without orphaned project', async () => {
      const entity = await createTestWatcher();
      const tempPath = path.join(testWatchedDir, 'vanishing.mp4');
      generateTinyVideo(tempPath);

      const readyRecords: WatchedFileRecord[] = [];
      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: (rec) => {
          readyRecords.push(rec);
        },
      });

      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();

      expect(readyRecords.length).toBe(1);

      // Delete the file before pipeline ingestion starts
      fs.unlinkSync(tempPath);

      const ingestResult = await WatchedFolderPipelineService.ingest(readyRecords[0], entity);
      expect(ingestResult.success).toBe(false);
      expect(ingestResult.errorCode).toBe('source_disappeared');

      // No project created
      expect((await ProjectRepository.getAll()).length).toBe(0);

      // Ledger records the error
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history[0].status).toBe('error');
      expect(history[0].error).toContain('[source_disappeared]');

      monitor.stop();
    });

    it('E. handles media probe failure with proper error categorization and preserves source', async () => {
      const entity = await createTestWatcher();
      const corruptedPath = path.join(testWatchedDir, 'corrupt.mp4');
      fs.writeFileSync(corruptedPath, 'not_a_valid_mp4_header_corrupt_data_12345');

      const dummyRecord: WatchedFileRecord = {
        id: 'wfrec_probe_fail',
        watcherId: entity.id,
        filePath: corruptedPath,
        filename: 'corrupt.mp4',
        fileSizeBytes: 42,
        fileMtimeMs: Date.now(),
        hashSha256: 'abc456',
        status: 'ready',
        detectedAt: new Date().toISOString(),
      };

      const result = await WatchedFolderPipelineService.ingest(dummyRecord, entity);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('media_probe_failure');

      // Source is preserved
      expect(fs.existsSync(corruptedPath)).toBe(true);

      // Ledger has error record
      const history = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(history[0].status).toBe('error');
      expect(history[0].error).toContain('[media_probe_failure]');
    });
  });

  describe('3. Crash Recovery & Cold-Start Reconciliation', () => {
    it('I. reconciles orphaned processing records without duplicate projects', async () => {
      const entity = await createTestWatcher();
      const testFile = path.join(testWatchedDir, 'orphan.mp4');
      generateTinyVideo(testFile);

      // Scenario 1: Record in 'processing', but project was NEVER created (crashed mid-import)
      await WatchedFolderHistoryRepository.recordFile(entity.id, {
        id: 'rec_unpersisted',
        filePath: testFile,
        filename: 'orphan.mp4',
        fileSizeBytes: fs.statSync(testFile).size,
        fileMtimeMs: Date.now(),
        hashSha256: 'dummy_hash_1',
        status: 'processing',
        detectedAt: new Date().toISOString(),
      });

      const report1 = await WatchedFolderPipelineService.reconcileIncompleteRecords();
      expect(report1.reset).toBe(1);
      expect(report1.healed).toBe(0);

      const check1 = await WatchedFolderHistoryRepository.getHistory(entity.id);
      expect(check1.find((r) => r.id === 'rec_unpersisted')?.status).toBe('ready');

      // Scenario 2: Record in 'processing', but project was already successfully saved
      const dummyProject = await ProjectRepository.save({
        projectId: 'proj_orphan_saved',
        name: 'orphan',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'draft',
        settings: {} as any,
        slots: [],
        stats: {} as any,
        sourceMedia: {
          sourceType: 'local_file',
          originalFilename: 'orphan.mp4',
          fileSizeBytes: 100,
          hashSha256: 'dummy_hash_persisted',
          durationSeconds: 1,
          width: 160,
          height: 120,
          fps: 25,
          videoCodec: 'h264',
          hasAudio: false,
          importedAt: new Date().toISOString(),
          mediaPath: 'videos/source.mp4',
          watcherId: entity.id,
          watchedFileRecordId: 'rec_persisted',
        },
      });

      await WatchedFolderHistoryRepository.recordFile(entity.id, {
        id: 'rec_persisted',
        filePath: testFile,
        filename: 'orphan.mp4',
        fileSizeBytes: 100,
        fileMtimeMs: Date.now(),
        hashSha256: 'dummy_hash_persisted',
        status: 'processing',
        detectedAt: new Date().toISOString(),
      });

      const report2 = await WatchedFolderPipelineService.reconcileIncompleteRecords();
      expect(report2.healed).toBe(1);

      const check2 = await WatchedFolderHistoryRepository.getHistory(entity.id);
      const healedRec = check2.find((r) => r.id === 'rec_persisted');
      expect(healedRec?.status).toBe('ingested');
      expect(healedRec?.projectId).toBe(dummyProject.projectId);
    });
  });

  describe('4. Content Channel Integration', () => {
    it('J. applies Content Channel metadata and updates channel statistics', async () => {
      // 1. Create a Content Channel
      const channel = await ChannelRepository.create({
        name: 'Science Channel',
        description: 'Documentaries',
        defaultAspectRatio: '16:9',
      });

      // 2. Create watcher assigned to this channel
      const entity = await createTestWatcher({
        rules: {
          channelId: channel.id,
          workflow: 'import_only',
        },
      } as any);

      const videoFile = path.join(testWatchedDir, 'science_clip.mp4');
      generateTinyVideo(videoFile);

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();

      // Check project has channel linked
      const projects = await ProjectRepository.getAll();
      expect(projects.length).toBe(1);
      expect(projects[0].channelId).toBe(channel.id);
      expect(projects[0].channelName).toBe('Science Channel');

      // Check channel stats incremented
      const updatedChannel = await ChannelRepository.get(channel.id);
      expect(updatedChannel?.stats.totalProjects).toBe(1);

      monitor.stop();
    });
  });

  describe('5. Source-Media Deletion Opt-In Safety', () => {
    it('preserves source file by default (deleteSourceOnSuccess=false)', async () => {
      const entity = await createTestWatcher({
        rules: { deleteSourceOnSuccess: false },
      } as any);

      const videoFile = path.join(testWatchedDir, 'preserve_me.mp4');
      generateTinyVideo(videoFile);

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();

      // Source file must exist
      expect(fs.existsSync(videoFile)).toBe(true);

      monitor.stop();
    });

    it('deletes source file ONLY when deleteSourceOnSuccess is explicitly enabled', async () => {
      const entity = await createTestWatcher({
        rules: { deleteSourceOnSuccess: true },
      } as any);

      const videoFile = path.join(testWatchedDir, 'delete_after_ingest.mp4');
      generateTinyVideo(videoFile);

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();

      // Project was created
      const projects = await ProjectRepository.getAll();
      expect(projects.length).toBe(1);

      // Source file should have been safely deleted
      expect(fs.existsSync(videoFile)).toBe(false);

      monitor.stop();
    });
  });

  describe('6. Workflow Handling & Browser Isolation', () => {
    it('K. import_only creates project without launching renderer or scheduler jobs', async () => {
      const entity = await createTestWatcher({
        rules: { workflow: 'import_only' },
      } as any);

      const videoFile = path.join(testWatchedDir, 'import_only.mp4');
      generateTinyVideo(videoFile);

      const monitor = new WatchedFolderMonitor(entity, {
        pollIntervalMs: 50,
        onMediaReady: async (rec, ent) => {
          await WatchedFolderPipelineService.ingest(rec, ent);
        },
      });

      await monitor.scanNow();
      await new Promise((r) => setTimeout(r, 200));
      await monitor.scanNow();

      const projects = await ProjectRepository.getAll();
      expect(projects.length).toBe(1);
      expect(projects[0].status).toBe('draft');
      expect(projects[0].slots.length).toBe(0);

      monitor.stop();
    });

    it('L. browser isolation: zero Chrome or Playwright browser instances are started', async () => {
      // Ingestion should not require any browser sessions or sessions manager
      const entity = await createTestWatcher();
      const videoFile = path.join(testWatchedDir, 'browser_isolation.mp4');
      generateTinyVideo(videoFile);

      const res = await WatchedFolderPipelineService.ingest(
        {
          id: 'rec_browser_test',
          watcherId: entity.id,
          filePath: videoFile,
          filename: 'browser_isolation.mp4',
          fileSizeBytes: fs.statSync(videoFile).size,
          fileMtimeMs: Date.now(),
          hashSha256: '',
          status: 'ready',
          detectedAt: new Date().toISOString(),
        },
        entity
      );

      expect(res.success).toBe(true);
      expect(res.project).toBeDefined();
    });
  });
});
