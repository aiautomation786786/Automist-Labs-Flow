import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChannelDeliveryService } from '../main/channel/ChannelDeliveryService';
import { ChannelRepository } from '../main/storage/ChannelRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { ChannelHistoryRepository } from '../main/storage/ChannelHistoryRepository';
import { AssetManager } from '../main/storage/AssetManager';

describe('ChannelDeliveryService Unit & Delivery Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-delivery-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    ChannelRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelHistoryRepository.clearCache();
  });

  afterEach(() => {
    ChannelRepository.clearCache();
    ProjectRepository.clearCache();
    ChannelHistoryRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('1. Slugifies titles cleanly into filesystem-safe strings', () => {
    expect(ChannelDeliveryService.slugify('The Deep Ocean: Secrets of 20,000 Leagues!')).toBe(
      'the_deep_ocean_secrets_of_20_000_leagues'
    );
    expect(ChannelDeliveryService.slugify('   Spaces & Symbols --- @#$   ')).toBe('spaces_symbols');
    expect(ChannelDeliveryService.slugify('---')).toBe('video');
  });

  it('2. Resolves destination directories accurately based on aspect ratio', async () => {
    const channel = await ChannelRepository.create({
      name: 'Multi-Format Channel',
      shortsOutputDir: path.join(tmpBaseDir, 'ShortsFolder'),
      longsOutputDir: path.join(tmpBaseDir, 'LongsFolder'),
      outputDir: path.join(tmpBaseDir, 'GeneralFolder'),
    });

    const shortsDest = ChannelDeliveryService.resolveDestinationDir(channel, '9:16');
    expect(shortsDest).toBe(path.resolve(path.join(tmpBaseDir, 'ShortsFolder')));

    const longsDest = ChannelDeliveryService.resolveDestinationDir(channel, '16:9');
    expect(longsDest).toBe(path.resolve(path.join(tmpBaseDir, 'LongsFolder')));

    // Channel without dedicated shorts/longs folders
    const basicChannel = await ChannelRepository.create({
      name: 'Basic Channel',
      outputDir: path.join(tmpBaseDir, 'GeneralOnly'),
    });
    expect(ChannelDeliveryService.resolveDestinationDir(basicChannel, '9:16')).toBe(
      path.resolve(path.join(tmpBaseDir, 'GeneralOnly'))
    );

    // Channel without any custom folder falls back to default channel delivery dir
    const defaultChannel = await ChannelRepository.create({
      name: 'Default Channel',
    });
    expect(ChannelDeliveryService.resolveDestinationDir(defaultChannel, '16:9')).toBe(
      AssetManager.getChannelDeliveryDir(defaultChannel.id)
    );
  });

  it('3. Collision avoidance: never overwrites different file with same slug', () => {
    const destDir = path.join(tmpBaseDir, 'dest');
    fs.mkdirSync(destDir, { recursive: true });

    const sourcePath = path.join(tmpBaseDir, 'source.mp4');
    fs.writeFileSync(sourcePath, 'video content version 1');

    // Case A: destination does not exist
    const pathA = ChannelDeliveryService.resolveCollisionSafePath(destDir, 'my_video', sourcePath);
    expect(pathA).toBe(path.join(destDir, 'my_video.mp4'));

    // Create an unrelated file with the same name
    const existingUnrelated = path.join(destDir, 'my_video.mp4');
    fs.writeFileSync(existingUnrelated, 'different unrelated video content');

    // Case B: destination exists with different content -> avoids collision!
    const pathB = ChannelDeliveryService.resolveCollisionSafePath(destDir, 'my_video', sourcePath);
    expect(pathB).not.toBe(existingUnrelated);
    expect(pathB).toMatch(/my_video[-_]\d+\.mp4$/);

    // Case C: destination exists with IDENTICAL content -> safe to reuse/overwrite
    const identicalSource = path.join(tmpBaseDir, 'source_identical.mp4');
    fs.writeFileSync(identicalSource, 'different unrelated video content');
    const pathC = ChannelDeliveryService.resolveCollisionSafePath(destDir, 'my_video', identicalSource);
    expect(pathC).toBe(existingUnrelated);
  });

  it('4. Delivers video, thumbnail, and poster non-destructively and updates history & stats', async () => {
    const channel = await ChannelRepository.create({
      name: 'Discovery Hub',
      shortsOutputDir: path.join(tmpBaseDir, 'shorts_dest'),
    });

    const project = await ProjectRepository.create({
      name: 'The Amazon Rainforest',
      imageRatio: '9:16',
      prompts: [{ text: 'Dense jungle canopy', type: 'image' }],
    });

    // Mock validation to simulate successful ffprobe in unit test
    const validateSpy = vi.spyOn(ChannelDeliveryService, 'validateDeliveredVideo').mockResolvedValue({
      valid: true,
      durationSeconds: 18.5,
      fileSizeBytes: 5000000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 1080,
      height: 1920,
    });

    // Create canonical project assets
    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    const canonicalVideo = path.join(finalDir, 'final.mp4');
    const canonicalThumb = path.join(finalDir, 'final-thumbnail.jpg');
    const canonicalPoster = path.join(finalDir, 'final-poster.jpg');

    fs.writeFileSync(canonicalVideo, 'dummy canonical mp4 content');
    fs.writeFileSync(canonicalThumb, 'dummy thumbnail content');
    fs.writeFileSync(canonicalPoster, 'dummy poster content');

    // Execute delivery
    const delivery = await ChannelDeliveryService.deliverProject(project.projectId, channel.id);

    expect(delivery.status).toBe('delivered');
    expect(delivery.channelId).toBe(channel.id);
    expect(delivery.durationSeconds).toBe(18.5);
    expect(delivery.videoCodec).toBe('h264');
    expect(delivery.deliveredVideoPath).toContain('the_amazon_rainforest.mp4');

    // Verify canonical assets are COMPLETELY PRESERVED (never moved or deleted)
    expect(fs.existsSync(canonicalVideo)).toBe(true);
    expect(fs.existsSync(canonicalThumb)).toBe(true);
    expect(fs.existsSync(canonicalPoster)).toBe(true);

    // Verify delivered files exist in destination
    expect(fs.existsSync(delivery.deliveredVideoPath)).toBe(true);
    expect(delivery.deliveredThumbnailPath).toBeDefined();
    expect(fs.existsSync(delivery.deliveredThumbnailPath!)).toBe(true);
    expect(delivery.deliveredPosterPath).toBeDefined();
    expect(fs.existsSync(delivery.deliveredPosterPath!)).toBe(true);

    // Verify project has been assigned to the channel
    const updatedProject = await ProjectRepository.get(project.projectId);
    expect(updatedProject?.channelId).toBe(channel.id);
    expect(updatedProject?.channelName).toBe('Discovery Hub');

    // Verify channel stats updated
    const updatedChannel = await ChannelRepository.get(channel.id);
    expect(updatedChannel?.stats.deliveredVideos).toBe(1);
    expect(updatedChannel?.stats.totalProjects).toBe(1);
    expect(updatedChannel?.stats.lastDeliveredAt).toBeDefined();

    // Verify recorded in delivery history
    const history = await ChannelHistoryRepository.query({ channelId: channel.id });
    expect(history.total).toBe(1);
    expect(history.records[0].id).toBe(delivery.id);

    validateSpy.mockRestore();
  });

  it('5. Handles missing final video with explicit error and failed history entry', async () => {
    const channel = await ChannelRepository.create({ name: 'Channel Error Test' });
    const project = await ProjectRepository.create({
      name: 'Unrendered Project',
      prompts: [{ text: 'Prompt 1', type: 'image' }],
    });

    await expect(ChannelDeliveryService.deliverProject(project.projectId, channel.id)).rejects.toThrow(
      'Final video not found'
    );

    // Check failed history record logged
    const history = await ChannelHistoryRepository.query({ channelId: channel.id, status: 'failed' });
    expect(history.total).toBe(1);
    expect(history.records[0].error).toContain('Final video not found');
  });

  it('6. Supports retry of a previous delivery record', async () => {
    const channel = await ChannelRepository.create({ name: 'Retry Channel' });
    const project = await ProjectRepository.create({
      name: 'Retry Project',
      prompts: [{ text: 'Prompt 1', type: 'image' }],
    });

    const { finalDir } = AssetManager.ensureProjectDirectories(project.projectId);
    fs.writeFileSync(path.join(finalDir, 'final.mp4'), 'valid video bytes');

    vi.spyOn(ChannelDeliveryService, 'validateDeliveredVideo').mockResolvedValue({
      valid: true,
      durationSeconds: 12.0,
      fileSizeBytes: 2000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 1920,
      height: 1080,
    });

    const firstDelivery = await ChannelDeliveryService.deliverProject(project.projectId, channel.id);
    expect(firstDelivery.status).toBe('delivered');

    // Retry delivery using its record ID
    const retried = await ChannelDeliveryService.retryDelivery(firstDelivery.id);
    expect(retried.status).toBe('delivered');
    expect(retried.projectId).toBe(project.projectId);

    const history = await ChannelHistoryRepository.query({ channelId: channel.id });
    expect(history.total).toBe(2);
  });
});
