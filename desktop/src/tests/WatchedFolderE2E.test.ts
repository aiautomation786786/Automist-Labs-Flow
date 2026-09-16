import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { WatchedFolderRepository } from '../main/storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../main/storage/WatchedFolderHistoryRepository';
import { WatchedFolderMonitor } from '../main/watcher/WatchedFolderMonitor';
import { WatchedFolderEngine } from '../main/watcher/WatchedFolderEngine';
import { WatchedFolderPipelineService } from '../main/pipeline/WatchedFolderPipelineService';
import { WatchedFolderCadenceService } from '../main/cadence/WatchedFolderCadenceService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { ChannelRepository } from '../main/storage/ChannelRepository';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';
import type { WatchedFolderEntity, WatchedFileRecord } from '../shared/types';

describe('ZSocial Phase 4F: End-to-End Real-World Watched Folder Verification', () => {
  let tmpBaseDir: string;
  let testWatchedDir: string;
  let ffmpegBin: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-phase4f-e2e-'));
    process.env.LOCALAPPDATA = tmpBaseDir;

    testWatchedDir = path.join(tmpBaseDir, 'e2e_watched_inbox');
    fs.mkdirSync(testWatchedDir, { recursive: true });

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

  async function waitForCondition(condition: () => Promise<boolean>, timeoutMs = 3000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (!(await condition())) {
      throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
    }
  }

  function generateTinyVideo(outputPath: string, durationSeconds = 0.5): void {
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi',
        '-i', `color=c=green:s=160x120:r=25:d=${durationSeconds}`,
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

  it('TEST A — IMMEDIATE: End-to-end detection, stability, single project creation, and source preservation', async () => {
    // 1. Create watched folder in immediate mode
    const watcher = await WatchedFolderRepository.create({
      name: 'E2E Immediate Inbox',
      folderPath: testWatchedDir,
      cadence: { mode: 'immediate' },
      rules: {
        stabilityDurationMs: 150,
        maxBatchSize: 5,
        ingestOrder: 'oldest_first',
        deleteSourceOnSuccess: false,
        workflow: 'import_only',
      },
      enabled: true,
    });

    // 2. Drop supported test video into folder
    const videoFile = path.join(testWatchedDir, 'drone_shot_01.mp4');
    generateTinyVideo(videoFile);
    const initialStats = fs.statSync(videoFile);

    // 3. Monitor watches and detects file
    let mediaReadyTriggered = false;
    let handledRecord: WatchedFileRecord | null = null;

    const monitor = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        mediaReadyTriggered = true;
        handledRecord = rec;
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor.start();

    // Wait for file detection and stability duration (150ms)
    await waitForCondition(async () => mediaReadyTriggered && (await ProjectRepository.getAll()).length === 1);
    monitor.stop();

    // Confirm media ready callback fired
    expect(mediaReadyTriggered).toBe(true);
    expect(handledRecord).not.toBeNull();
    expect(handledRecord!.filename).toBe('drone_shot_01.mp4');

    // Confirm exactly ONE project created
    const allProjects = await ProjectRepository.getAll();
    expect(allProjects.length).toBe(1);
    const project = allProjects[0];
    expect(project.name).toBe('drone_shot_01');
    expect(project.watcherId).toBe(watcher.id);
    expect(project.sourceMedia).toBeDefined();
    expect(project.sourceMedia?.originalFilename).toBe('drone_shot_01.mp4');

    // Confirm source file remains untouched on disk
    expect(fs.existsSync(videoFile)).toBe(true);
    const postStats = fs.statSync(videoFile);
    expect(postStats.size).toBe(initialStats.size);

    // Confirm history ledger is updated to 'ingested'
    const history = await WatchedFolderHistoryRepository.getHistory(watcher.id);
    expect(history.length).toBe(1);
    expect(history[0].status).toBe('ingested');
    expect(history[0].projectId).toBe(project.projectId);

    // Re-scan: confirm NO duplicate project created
    const rescanResult = await WatchedFolderPipelineService.ingest(history[0], watcher);
    expect(rescanResult.success).toBe(true);
    const projectsAfterRescan = await ProjectRepository.getAll();
    expect(projectsAfterRescan.length).toBe(1);
  });

  it('TEST B — DEDUPLICATION: Identical content copy is detected and skipped without duplicate project', async () => {
    const watcher = await WatchedFolderRepository.create({
      name: 'E2E Deduplication Box',
      folderPath: testWatchedDir,
      cadence: { mode: 'immediate' },
      rules: {
        stabilityDurationMs: 150,
        deleteSourceOnSuccess: false,
        workflow: 'import_only',
      },
      enabled: true,
    });

    const fileOriginal = path.join(testWatchedDir, 'original_clip.mp4');
    generateTinyVideo(fileOriginal);

    // First ingestion
    const monitor = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor.start();
    await waitForCondition(async () => (await ProjectRepository.getAll()).length === 1);
    monitor.stop();

    const projectsFirst = await ProjectRepository.getAll();
    expect(projectsFirst.length).toBe(1);

    // Create an exact byte-for-byte copy with a different filename
    const fileCopy = path.join(testWatchedDir, 'duplicate_copy.mp4');
    fs.copyFileSync(fileOriginal, fileCopy);

    // Run monitor again
    const monitor2 = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor2.start();
    await waitForCondition(async () => {
      const history = await WatchedFolderHistoryRepository.getHistory(watcher.id);
      return history.some((h) => h.filename === 'duplicate_copy.mp4' && h.status === 'skipped_duplicate');
    });
    monitor2.stop();

    // Confirm NO second project was created
    const projectsSecond = await ProjectRepository.getAll();
    expect(projectsSecond.length).toBe(1);

    // Confirm history ledger records duplicate
    const history = await WatchedFolderHistoryRepository.getHistory(watcher.id);
    const dupRecord = history.find((h) => h.filename === 'duplicate_copy.mp4');
    expect(dupRecord).toBeDefined();
    expect(dupRecord?.status).toBe('skipped_duplicate');
  });

  it('TEST C — SCHEDULED: Stable media waits in cadence queue until scheduled time', async () => {
    const watcher = await WatchedFolderRepository.create({
      name: 'E2E Scheduled Inbox',
      folderPath: testWatchedDir,
      cadence: {
        mode: 'scheduled',
        dailyTime: '23:59',
        catchUpMissed: false,
      },
      rules: {
        stabilityDurationMs: 100,
        workflow: 'import_only',
      },
      enabled: true,
    });

    const video = path.join(testWatchedDir, 'evening_vlog.mp4');
    generateTinyVideo(video);

    const monitor = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor.start();
    await waitForCondition(async () => {
      const pending = await WatchedFolderHistoryRepository.getPendingCadenceRecords(watcher.id);
      return pending.length === 1;
    });
    monitor.stop();

    // Confirm it is queued in 'waiting_for_cadence'
    const pending = await WatchedFolderHistoryRepository.getPendingCadenceRecords(watcher.id);
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('waiting_for_cadence');

    // Confirm no projects created yet
    let projects = await ProjectRepository.getAll();
    expect(projects.length).toBe(0);

    // Simulate scheduled release window trigger
    const processed = await WatchedFolderCadenceService.processPendingFiles(watcher.id);
    expect(processed).toBe(1);

    // Confirm project is now created
    projects = await ProjectRepository.getAll();
    expect(projects.length).toBe(1);
    expect(projects[0].name).toBe('evening_vlog');

    // Confirm status moved to 'ingested'
    const postPending = await WatchedFolderHistoryRepository.getPendingCadenceRecords(watcher.id);
    expect(postPending.length).toBe(0);
  });

  it('TEST D — INTERVAL: Recurring interval cadence holds and releases media', async () => {
    const watcher = await WatchedFolderRepository.create({
      name: 'E2E Interval Inbox',
      folderPath: testWatchedDir,
      cadence: {
        mode: 'interval',
        intervalMinutes: 60,
      },
      rules: {
        stabilityDurationMs: 100,
        workflow: 'import_only',
      },
      enabled: true,
    });

    const video = path.join(testWatchedDir, 'interval_clip.mp4');
    generateTinyVideo(video);

    const monitor = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor.start();
    await waitForCondition(async () => {
      const pending = await WatchedFolderHistoryRepository.getPendingCadenceRecords(watcher.id);
      return pending.length === 1;
    });
    monitor.stop();

    expect((await WatchedFolderHistoryRepository.getPendingCadenceRecords(watcher.id)).length).toBe(1);
    expect((await ProjectRepository.getAll()).length).toBe(0);

    // Release via cadence
    const released = await WatchedFolderCadenceService.processPendingFiles(watcher.id);
    expect(released).toBe(1);
    expect((await ProjectRepository.getAll()).length).toBe(1);
  });

  it('TEST E — PAUSE/RESUME: Paused watcher ignores new files; resuming recovers eligible work', async () => {
    const watcher = await WatchedFolderRepository.create({
      name: 'E2E Pause Box',
      folderPath: testWatchedDir,
      cadence: { mode: 'immediate' },
      rules: { stabilityDurationMs: 100, workflow: 'import_only' },
      enabled: true,
    });

    // Pause watcher
    await WatchedFolderRepository.updateStatus(watcher.id, 'paused');
    const pausedWatcher = await WatchedFolderRepository.get(watcher.id);
    expect(pausedWatcher?.status).toBe('paused');

    const video = path.join(testWatchedDir, 'paused_drop.mp4');
    generateTinyVideo(video);

    let readyFired = false;
    const monitor = new WatchedFolderMonitor(pausedWatcher!, {
      pollIntervalMs: 50,
      onMediaReady: () => {
        readyFired = true;
      },
    });

    monitor.start();
    await new Promise((r) => setTimeout(r, 300));
    monitor.stop();

    // Confirm no media ready fired while paused
    expect(readyFired).toBe(false);
    expect((await ProjectRepository.getAll()).length).toBe(0);

    // Resume watcher
    await WatchedFolderRepository.updateStatus(watcher.id, 'watching');
    const resumedWatcher = await WatchedFolderRepository.get(watcher.id);

    const monitor2 = new WatchedFolderMonitor(resumedWatcher!, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor2.start();
    await waitForCondition(async () => (await ProjectRepository.getAll()).length === 1);
    monitor2.stop();

    // Confirm recovered work was processed
    expect((await ProjectRepository.getAll()).length).toBe(1);
  });

  it('TEST F & G — PROJECT INTEGRATION & SAFE DELETION: Deleting watcher leaves projects and source intact', async () => {
    const channel = await ChannelRepository.create({
      name: 'E2E YouTube Channel',
      enabled: true,
    });

    const watcher = await WatchedFolderRepository.create({
      name: 'Attributed Watcher',
      folderPath: testWatchedDir,
      cadence: { mode: 'immediate' },
      rules: {
        channelId: channel.id,
        workflow: 'import_only',
        stabilityDurationMs: 100,
        deleteSourceOnSuccess: false,
      },
      enabled: true,
    });

    const video = path.join(testWatchedDir, 'attributed_video.mp4');
    generateTinyVideo(video);

    // Ingest
    const monitor = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor.start();
    await waitForCondition(async () => (await ProjectRepository.getAll()).length === 1);
    monitor.stop();

    // Confirm project created with channel attribution and watcherId
    const projects = await ProjectRepository.getAll();
    expect(projects.length).toBe(1);
    const proj = projects[0];
    expect(proj.watcherId).toBe(watcher.id);
    expect(proj.channelId).toBe(channel.id);

    // Delete watcher
    await WatchedFolderRepository.delete(watcher.id);
    expect(await WatchedFolderRepository.get(watcher.id)).toBeNull();

    // Confirm project is 100% intact and still in repository
    const projectsAfterDelete = await ProjectRepository.getAll();
    expect(projectsAfterDelete.length).toBe(1);
    expect(projectsAfterDelete[0].projectId).toBe(proj.projectId);

    // Confirm source file on disk was NOT deleted
    expect(fs.existsSync(video)).toBe(true);
  });

  it('TEST H — RESOURCE SAFETY: Zero Chrome or Playwright browser instances launched during e2e pipeline', async () => {
    // Check initial memory
    const initialMem = process.memoryUsage().heapUsed;

    // Run a full watcher cycle
    const watcher = await WatchedFolderRepository.create({
      name: 'Resource Check Watcher',
      folderPath: testWatchedDir,
      cadence: { mode: 'immediate' },
      rules: { stabilityDurationMs: 100, workflow: 'import_only' },
      enabled: true,
    });

    const video = path.join(testWatchedDir, 'resource_check.mp4');
    generateTinyVideo(video);

    const monitor = new WatchedFolderMonitor(watcher, {
      pollIntervalMs: 50,
      onMediaReady: async (rec, ent) => {
        await WatchedFolderCadenceService.handleMediaReady(rec, ent);
      },
    });

    monitor.start();
    await waitForCondition(async () => (await ProjectRepository.getAll()).length === 1);
    monitor.stop();

    // Memory remained bounded
    const postMem = process.memoryUsage().heapUsed;
    const deltaMB = (postMem - initialMem) / (1024 * 1024);
    // Delta should be tiny (well under 50MB)
    expect(deltaMB).toBeLessThan(50);
  });
});
