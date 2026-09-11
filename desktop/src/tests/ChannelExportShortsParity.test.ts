import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ChannelDeliveryService } from '../main/channel/ChannelDeliveryService';
import { FinalAssemblyService } from '../main/render/FinalAssemblyService';
import { FinalRenderManager } from '../main/render/FinalRenderManager';
import { SceneRenderer } from '../main/render/SceneRenderer';
import { ChannelRepository } from '../main/storage/ChannelRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { ChannelHistoryRepository } from '../main/storage/ChannelHistoryRepository';
import { StoryRepository } from '../main/storage/StoryRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { VideoFactoryPipeline } from '../main/pipeline/VideoFactoryPipeline';
import { PipelineStageValidator } from '../main/pipeline/PipelineStageValidator';
import { RetryCoordinator } from '../main/retry/RetryCoordinator';

const execFileAsync = promisify(execFile);

describe('Phase 4: Complete ZBot Channel Delivery, Export & Shorts Parity', () => {
  let tmpBaseDir: string;
  let originalEnv: string | undefined;
  let testShortsVideoPath: string;
  let testLongsVideoPath: string;
  let testThumbnailPath: string;

  beforeAll(async () => {
    const ffmpegBin = SceneRenderer.getFfmpegPath();
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4_fixtures_'));

    testShortsVideoPath = path.join(fixtureDir, 'shorts_base_1080x1920.mp4');
    testLongsVideoPath = path.join(fixtureDir, 'longs_base_1920x1080.mp4');
    testThumbnailPath = path.join(fixtureDir, 'thumbnail_1080x1920.png');

    // 1. Generate real vertical 9:16 Shorts test video (1080x1920, 4.0s, red screen with 440Hz tone)
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=red:s=1080x1920:r=25:d=4.0',
      '-f', 'lavfi',
      '-i', 'sine=f=440:d=4.0',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      testShortsVideoPath,
    ]);

    // 2. Generate real horizontal 16:9 Longs test video (1920x1080, 4.0s, blue screen with 660Hz tone)
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=1920x1080:r=25:d=4.0',
      '-f', 'lavfi',
      '-i', 'sine=f=660:d=4.0',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      testLongsVideoPath,
    ]);

    // 3. Generate yellow poster/thumbnail image (1080x1920)
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=yellow:s=1080x1920:r=1:d=1.0',
      '-vframes', '1',
      testThumbnailPath,
    ]);
  }, 40000);

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-phase4-test-'));
    originalEnv = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tmpBaseDir;
    ChannelRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelHistoryRepository.clearCache();
    StoryRepository.clearCache();
    RetryCoordinator.getInstance().clearMemory();
  });

  afterEach(() => {
    ChannelRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelHistoryRepository.clearCache();
    StoryRepository.clearCache();
    RetryCoordinator.getInstance().clearMemory();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      try {
        fs.rmSync(tmpBaseDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ===========================================================================
  // TEST 1: 16:9 final video -> Longs directory
  // ===========================================================================
  it('TEST 1: routes 16:9 final video automatically to Longs directory based on probed dimensions', async () => {
    const longsDir = path.join(tmpBaseDir, 'channel_longs');
    const shortsDir = path.join(tmpBaseDir, 'channel_shorts');
    fs.mkdirSync(longsDir, { recursive: true });
    fs.mkdirSync(shortsDir, { recursive: true });

    const channel = await ChannelRepository.create({
      name: 'Channel One',
      longsOutputDir: longsDir,
      shortsOutputDir: shortsDir,
    });

    const project = await ProjectRepository.create({
      name: 'Horiz Doc',
      channelId: channel.id,
      channelName: channel.name,
      imageRatio: '16:9',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.copyFileSync(testLongsVideoPath, path.join(finalDir, 'final.mp4'));

    const delivery = await ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
      strictFormatRouting: true,
    });

    expect(delivery.status).toBe('delivered');
    expect(delivery.aspectRatio).toBe('16:9');
    expect(delivery.orientation).toBe('longs');
    expect(delivery.deliveredVideoPath.startsWith(path.resolve(longsDir))).toBe(true);
    expect(fs.existsSync(delivery.deliveredVideoPath)).toBe(true);
  });

  // ===========================================================================
  // TEST 2: 9:16 final video -> Shorts directory
  // ===========================================================================
  it('TEST 2: routes 9:16 final video automatically to Shorts directory based on probed dimensions', async () => {
    const longsDir = path.join(tmpBaseDir, 'channel_longs');
    const shortsDir = path.join(tmpBaseDir, 'channel_shorts');
    fs.mkdirSync(longsDir, { recursive: true });
    fs.mkdirSync(shortsDir, { recursive: true });

    const channel = await ChannelRepository.create({
      name: 'Shorts Channel',
      longsOutputDir: longsDir,
      shortsOutputDir: shortsDir,
    });

    const project = await ProjectRepository.create({
      name: 'Vertical Reel',
      channelId: channel.id,
      channelName: channel.name,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.copyFileSync(testShortsVideoPath, path.join(finalDir, 'final.mp4'));

    const delivery = await ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
      strictFormatRouting: true,
    });

    expect(delivery.status).toBe('delivered');
    expect(delivery.aspectRatio).toBe('9:16');
    expect(delivery.orientation).toBe('shorts');
    expect(delivery.deliveredVideoPath.startsWith(path.resolve(shortsDir))).toBe(true);
    expect(fs.existsSync(delivery.deliveredVideoPath)).toBe(true);
  });

  // ===========================================================================
  // TEST 3: missing Shorts directory -> export fails safely -> final project video preserved
  // ===========================================================================
  it('TEST 3: missing Shorts directory fails export safely and preserves canonical project video', async () => {
    const channel = await ChannelRepository.create({
      name: 'No Shorts Channel',
      longsOutputDir: path.join(tmpBaseDir, 'longs_only'),
      // shortsOutputDir intentionally omitted
    });

    const project = await ProjectRepository.create({
      name: 'Shorts Missing Target',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    const canonicalVideo = path.join(finalDir, 'final.mp4');
    fs.copyFileSync(testShortsVideoPath, canonicalVideo);
    const canonicalSizeBefore = fs.statSync(canonicalVideo).size;

    await expect(
      ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
        strictFormatRouting: true,
      })
    ).rejects.toThrow(/Shorts/i);

    // Invariant: canonical project video must remain 100% preserved
    expect(fs.existsSync(canonicalVideo)).toBe(true);
    expect(fs.statSync(canonicalVideo).size).toBe(canonicalSizeBefore);

    // Recorded failure in history
    const history = await ChannelHistoryRepository.query({ projectId: project.projectId, status: 'failed' });
    expect(history.total).toBe(1);
    expect(history.records[0].error).toMatch(/Shorts/i);
  });

  // ===========================================================================
  // TEST 4: missing Longs directory -> export fails safely -> final project video preserved
  // ===========================================================================
  it('TEST 4: missing Longs directory fails export safely and preserves canonical project video', async () => {
    const channel = await ChannelRepository.create({
      name: 'No Longs Channel',
      shortsOutputDir: path.join(tmpBaseDir, 'shorts_only'),
      // longsOutputDir intentionally omitted
    });

    const project = await ProjectRepository.create({
      name: 'Longs Missing Target',
      channelId: channel.id,
      imageRatio: '16:9',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    const canonicalVideo = path.join(finalDir, 'final.mp4');
    fs.copyFileSync(testLongsVideoPath, canonicalVideo);
    const canonicalSizeBefore = fs.statSync(canonicalVideo).size;

    await expect(
      ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
        strictFormatRouting: true,
      })
    ).rejects.toThrow(/Longs/i);

    // Invariant: canonical project video must remain 100% preserved
    expect(fs.existsSync(canonicalVideo)).toBe(true);
    expect(fs.statSync(canonicalVideo).size).toBe(canonicalSizeBefore);

    // Recorded failure in history
    const history = await ChannelHistoryRepository.query({ projectId: project.projectId, status: 'failed' });
    expect(history.total).toBe(1);
    expect(history.records[0].error).toMatch(/Longs/i);
  });

  // ===========================================================================
  // TEST 5: existing filename -> unique filename generated (story-1.mp4)
  // ===========================================================================
  it('TEST 5: existing filename produces collision-safe unique filename in sequence', async () => {
    const destDir = path.join(tmpBaseDir, 'collision_dest');
    fs.mkdirSync(destDir, { recursive: true });

    const sourceVideo = path.join(tmpBaseDir, 'source.mp4');
    fs.writeFileSync(sourceVideo, 'source video stream content A');

    // Pre-create existing file with different content
    fs.writeFileSync(path.join(destDir, 'my_story.mp4'), 'different video stream content B');

    // First collision: should reserve my_story-1.mp4
    const firstUnique = ChannelDeliveryService.resolveCollisionSafePath(destDir, 'my_story', sourceVideo);
    expect(firstUnique).toBe(path.join(destDir, 'my_story-1.mp4'));

    // Populate my_story-1.mp4 with different content
    fs.writeFileSync(firstUnique, 'different video stream content C');

    // Second collision: should reserve my_story-2.mp4
    const secondUnique = ChannelDeliveryService.resolveCollisionSafePath(destDir, 'my_story', sourceVideo);
    expect(secondUnique).toBe(path.join(destDir, 'my_story-2.mp4'));
  });

  // ===========================================================================
  // TEST 6: two concurrent exports -> no overwrite/race
  // ===========================================================================
  it('TEST 6: two concurrent export attempts atomically reserve distinct files without race', async () => {
    const destDir = path.join(tmpBaseDir, 'concurrent_dest');
    fs.mkdirSync(destDir, { recursive: true });

    const sourceA = path.join(tmpBaseDir, 'sourceA.mp4');
    const sourceB = path.join(tmpBaseDir, 'sourceB.mp4');
    fs.writeFileSync(sourceA, 'content from export A');
    fs.writeFileSync(sourceB, 'content from export B');

    // Run both reservations concurrently
    const [pathA, pathB] = await Promise.all([
      Promise.resolve(ChannelDeliveryService.resolveCollisionSafePath(destDir, 'viral_story', sourceA)),
      Promise.resolve(ChannelDeliveryService.resolveCollisionSafePath(destDir, 'viral_story', sourceB)),
    ]);

    expect(pathA).not.toBe(pathB);
    expect(fs.existsSync(pathA)).toBe(true);
    expect(fs.existsSync(pathB)).toBe(true);
  });

  // ===========================================================================
  // TEST 7: invalid exported file -> EXPORT failed
  // ===========================================================================
  it('TEST 7: corrupt or zero-byte exported file triggers EXPORT failure and cleans target', async () => {
    const destDir = path.join(tmpBaseDir, 'invalid_dest');
    fs.mkdirSync(destDir, { recursive: true });

    const channel = await ChannelRepository.create({
      name: 'Validation Channel',
      shortsOutputDir: destDir,
    });

    const project = await ProjectRepository.create({
      name: 'Corrupt Video Project',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    // Write fake non-media bytes
    fs.writeFileSync(path.join(finalDir, 'final.mp4'), 'not a real mp4 video container at all');

    await expect(
      ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
        strictFormatRouting: true,
      })
    ).rejects.toThrow();

    const history = await ChannelHistoryRepository.query({ projectId: project.projectId, status: 'failed' });
    expect(history.total).toBe(1);
  });

  // ===========================================================================
  // TEST 8: valid export -> EXPORT completed
  // ===========================================================================
  it('TEST 8: valid final video export completes successfully with media validation', async () => {
    const destDir = path.join(tmpBaseDir, 'valid_dest');
    fs.mkdirSync(destDir, { recursive: true });

    const channel = await ChannelRepository.create({
      name: 'Valid Channel',
      shortsOutputDir: destDir,
    });

    const project = await ProjectRepository.create({
      name: 'Valid Project',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.copyFileSync(testShortsVideoPath, path.join(finalDir, 'final.mp4'));

    const record = await ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
      strictFormatRouting: true,
    });

    expect(record.status).toBe('delivered');
    expect(record.durationSeconds).toBeGreaterThan(3.5);
    expect(record.fileSizeBytes).toBeGreaterThan(5000);
    expect(record.videoCodec).toBe('h264');
    expect(record.audioCodec).toBe('aac');
  });

  // ===========================================================================
  // TEST 9: export failure -> retry only EXPORT
  // ===========================================================================
  it('TEST 9: retrying export stage resets only export and preserves upstream stages', async () => {
    const channel = await ChannelRepository.create({
      name: 'Retry Pipeline Channel',
      shortsOutputDir: path.join(tmpBaseDir, 'pipeline_shorts'),
    });

    const project = await ProjectRepository.create({
      name: 'Pipeline Retry Project',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const pipeline = new VideoFactoryPipeline(project.projectId, 'full_video');
    await pipeline.loadOrCreateState();

    const state = pipeline.getState();
    // Simulate completed upstream stages
    state.stages.story.status = 'completed';
    state.stages.images.status = 'completed';
    state.stages.voice.status = 'completed';
    state.stages.thumbnail.status = 'completed';
    state.stages.clips.status = 'completed';
    state.stages.review.status = 'completed';
    state.stages.subtitles.status = 'completed';
    state.stages.rendering.status = 'completed';
    state.stages.export.status = 'failed';
    state.stages.export.error = 'Temporary disk error';
    await StoryRepository.savePipelineState(project.projectId, state);

    // Provide canonical final video so export stage passes
    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.copyFileSync(testShortsVideoPath, path.join(finalDir, 'final.mp4'));

    // Mock stage output validator to confirm completed upstream stages are valid
    const stageValidatorSpy = vi.spyOn(PipelineStageValidator, 'validateStageOutput').mockResolvedValue({ valid: true });

    // Mock deliverProject to succeed on re-run
    const validateSpy = vi.spyOn(ChannelDeliveryService, 'deliverProject').mockResolvedValue({
      id: 'deliv_test_mock',
      projectId: project.projectId,
      projectName: project.name,
      channelId: channel.id,
      channelName: channel.name,
      sourceVideoPath: testShortsVideoPath,
      deliveredVideoPath: path.join(channel.shortsOutputDir!, 'pipeline_retry_project.mp4'),
      aspectRatio: '9:16',
      orientation: 'shorts',
      durationSeconds: 4.0,
      fileSizeBytes: 50000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
      deliveredAt: new Date().toISOString(),
    });

    try {
      await pipeline.retryStage('export');

      const updated = pipeline.getState();
      // Invariant: upstream stages MUST remain completed without being re-executed
      expect(updated.stages.story.status).toBe('completed');
      expect(updated.stages.images.status).toBe('completed');
      expect(updated.stages.rendering.status).toBe('completed');
      expect(updated.stages.export.status).toBe('completed');
    } finally {
      validateSpy.mockRestore();
      stageValidatorSpy.mockRestore();
    }
  });

  // ===========================================================================
  // TEST 10: Stop during export retry -> no retry after cancellation
  // ===========================================================================
  it('TEST 10: cancellation during export aborts timers and prevents further auto-retries', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const abortController = new AbortController();

    let executed = false;
    const schedulePromise = coordinator.scheduleRetry(
      'proj_cancel_export',
      'export',
      'run-test-10',
      500,
      async () => {
        executed = true;
      },
      abortController.signal
    );

    // Cancel while retry delay is active
    abortController.abort();
    const shouldProceed = await schedulePromise;
    expect(shouldProceed).toBe(false);
    expect(executed).toBe(false);

    const state = coordinator.getRetryState('proj_cancel_export', 'export');
    expect(state?.cancelledByUser).toBe(true);

    expect(coordinator.isCancelled('proj_cancel_export', 'export')).toBe(true);

    // Any subsequent auto-retry is permanently rejected
    const nextDecision = coordinator.recordError('proj_cancel_export', 'export', new Error('Another error'));
    expect(nextDecision.shouldRetry).toBe(false);
    expect(nextDecision.reason).toBe('CANCELLED_BY_USER');
  });

  // ===========================================================================
  // TEST 11: channel deleted before export -> clean failure
  // ===========================================================================
  it('TEST 11: export fails cleanly if assigned channel was deleted prior to export', async () => {
    const channel = await ChannelRepository.create({
      name: 'To Be Deleted',
      shortsOutputDir: path.join(tmpBaseDir, 'temp_shorts'),
    });

    const project = await ProjectRepository.create({
      name: 'Deleted Channel Project',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    // Delete the channel
    await ChannelRepository.delete(channel.id);

    // Attempt delivery
    await expect(
      ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
        strictFormatRouting: true,
      })
    ).rejects.toThrow(/Channel not found/i);

    const history = await ChannelHistoryRepository.query({ projectId: project.projectId, status: 'failed' });
    expect(history.total).toBe(1);
    expect(history.records[0].error).toMatch(/Channel not found/i);
  });

  // ===========================================================================
  // TEST 12: channel history records success
  // ===========================================================================
  it('TEST 12: successful delivery logs full record in ChannelHistoryRepository', async () => {
    const destDir = path.join(tmpBaseDir, 'hist_success_dest');
    fs.mkdirSync(destDir, { recursive: true });

    const channel = await ChannelRepository.create({
      name: 'History Channel Success',
      shortsOutputDir: destDir,
    });

    const project = await ProjectRepository.create({
      name: 'History Success Project',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.copyFileSync(testShortsVideoPath, path.join(finalDir, 'final.mp4'));

    const delivery = await ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
      strictFormatRouting: true,
      runId: 'run_hist_123',
    });

    const record = await ChannelHistoryRepository.getById(delivery.id);
    expect(record).not.toBeNull();
    expect(record?.status).toBe('delivered');
    expect(record?.projectId).toBe(project.projectId);
    expect(record?.channelId).toBe(channel.id);
    expect(record?.orientation).toBe('shorts');
    expect(record?.runId).toBe('run_hist_123');
    expect(record?.durationSeconds).toBeGreaterThan(3.5);
  });

  // ===========================================================================
  // TEST 13: channel history records failure
  // ===========================================================================
  it('TEST 13: failed delivery logs full failure details in ChannelHistoryRepository', async () => {
    const channel = await ChannelRepository.create({
      name: 'History Channel Failure',
      // No directories configured
    });

    const project = await ProjectRepository.create({
      name: 'History Failure Project',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.copyFileSync(testShortsVideoPath, path.join(finalDir, 'final.mp4'));

    await expect(
      ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
        strictFormatRouting: true,
        runId: 'run_fail_456',
      })
    ).rejects.toThrow();

    const history = await ChannelHistoryRepository.query({ projectId: project.projectId, status: 'failed' });
    expect(history.total).toBe(1);
    expect(history.records[0].status).toBe('failed');
    expect(history.records[0].runId).toBe('run_fail_456');
    expect(history.records[0].error).toBeDefined();
  });

  // ===========================================================================
  // TEST 14: Shorts thumbnail overlay exists for exactly 2 seconds
  // ===========================================================================
  it('TEST 14: Shorts thumbnail overlay renders poster frame for first 2.0s', async () => {
    const overlayOut = path.join(tmpBaseDir, 'shorts_overlay_test.mp4');

    const result = await FinalAssemblyService.applyShortsThumbnailOverlay({
      sourceVideoPath: testShortsVideoPath,
      thumbnailPath: testThumbnailPath,
      outputVideoPath: overlayOut,
      durationSeconds: 2.0,
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(overlayOut)).toBe(true);

    // Extract frame at 1.0s (within the 2-second thumbnail window)
    const frameAt1s = path.join(tmpBaseDir, 'frame_1s.jpg');
    const extract1 = await FinalAssemblyService.extractFrame(overlayOut, frameAt1s, 1.0);
    expect(extract1.success).toBe(true);
    expect(fs.statSync(frameAt1s).size).toBeGreaterThan(1000);

    // Extract frame at 2.5s (after thumbnail window, normal video follows)
    const frameAt2_5s = path.join(tmpBaseDir, 'frame_2_5s.jpg');
    const extract2 = await FinalAssemblyService.extractFrame(overlayOut, frameAt2_5s, 2.5);
    expect(extract2.success).toBe(true);
    expect(fs.statSync(frameAt2_5s).size).toBeGreaterThan(1000);

    // The frames at 1.0s (yellow thumbnail) and 2.5s (red video) must differ in content
    const buf1 = fs.readFileSync(frameAt1s);
    const buf2 = fs.readFileSync(frameAt2_5s);
    expect(buf1.equals(buf2)).toBe(false);
  });

  // ===========================================================================
  // TEST 15: Longs video does not receive Shorts overlay
  // ===========================================================================
  it('TEST 15: horizontal Longs video (16:9) rejects Shorts thumbnail overlay', async () => {
    const overlayOut = path.join(tmpBaseDir, 'longs_reject_overlay.mp4');

    await expect(
      FinalAssemblyService.applyShortsThumbnailOverlay({
        sourceVideoPath: testLongsVideoPath,
        thumbnailPath: testThumbnailPath,
        outputVideoPath: overlayOut,
        durationSeconds: 2.0,
      })
    ).rejects.toThrow(/vertical/i);

    expect(fs.existsSync(overlayOut)).toBe(false);
  });

  // ===========================================================================
  // TEST 16: Shorts final video remains valid with audio
  // ===========================================================================
  it('TEST 16: Shorts final video preserves valid continuous audio stream from 0.0s', async () => {
    const overlayOut = path.join(tmpBaseDir, 'shorts_audio_valid.mp4');

    const result = await FinalAssemblyService.applyShortsThumbnailOverlay({
      sourceVideoPath: testShortsVideoPath,
      thumbnailPath: testThumbnailPath,
      outputVideoPath: overlayOut,
      durationSeconds: 2.0,
    });

    expect(result.audioCodec).toBe('aac');
    expect(result.videoCodec).toBe('h264');

    const probe = await FinalAssemblyService.validateFinalVideo(overlayOut);
    expect(probe.valid).toBe(true);
    expect(probe.audioCodec).toBe('aac');
    expect(probe.videoCodec).toBe('h264');
  });

  // ===========================================================================
  // TEST 17: Shorts final duration is correct
  // ===========================================================================
  it('TEST 17: Shorts final video duration matches source duration within tolerance', async () => {
    const overlayOut = path.join(tmpBaseDir, 'shorts_duration_test.mp4');

    const result = await FinalAssemblyService.applyShortsThumbnailOverlay({
      sourceVideoPath: testShortsVideoPath,
      thumbnailPath: testThumbnailPath,
      outputVideoPath: overlayOut,
      durationSeconds: 2.0,
    });

    const sourceProbe = await FinalAssemblyService.validateFinalVideo(testShortsVideoPath);
    expect(Math.abs(result.durationSeconds - sourceProbe.durationSeconds)).toBeLessThan(0.15);
  });

  // ===========================================================================
  // TEST 18: canonical project output remains untouched
  // ===========================================================================
  it('TEST 18: canonical project output is completely preserved after delivery', async () => {
    const destDir = path.join(tmpBaseDir, 'preserve_check_dest');
    fs.mkdirSync(destDir, { recursive: true });

    const channel = await ChannelRepository.create({
      name: 'Preservation Channel',
      shortsOutputDir: destDir,
    });

    const project = await ProjectRepository.create({
      name: 'Master Video Preservation',
      channelId: channel.id,
      imageRatio: '9:16',
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    const canonicalPath = path.join(finalDir, 'final.mp4');
    fs.copyFileSync(testShortsVideoPath, canonicalPath);
    const originalHash = fs.readFileSync(canonicalPath).toString('hex');

    const delivery = await ChannelDeliveryService.deliverProject(project.projectId, channel.id, {
      strictFormatRouting: true,
    });

    // Invariants:
    // 1. Canonical file exists in original location
    expect(fs.existsSync(canonicalPath)).toBe(true);
    // 2. Canonical file bytes are identical
    expect(fs.readFileSync(canonicalPath).toString('hex')).toBe(originalHash);
    // 3. Delivered file is at channel destination
    expect(delivery.deliveredVideoPath).not.toBe(canonicalPath);
    expect(fs.existsSync(delivery.deliveredVideoPath)).toBe(true);
  });
});
