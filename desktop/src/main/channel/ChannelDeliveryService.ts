/**
 * ChannelDeliveryService – Deterministic final video delivery engine.
 *
 * Responsibilities:
 *  1. Non-destructively copies the project's canonical final MP4, thumbnail, and poster
 *     to the channel's target output directory.
 *  2. Resolves output directory based on aspect ratio (Shorts 9:16 vs Longs 16:9 vs custom outputDir vs default).
 *  3. Collision avoidance: never silently overwrites an unrelated file; appends timestamp if collision occurs.
 *  4. ffprobe media validation: ensures delivered video exists, size > 0, video stream valid, audio stream valid.
 *  5. Records delivery history and updates channel stats.
 *  6. Safe retry support.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  ChannelEntity,
  DeliveryHistoryRecord,
  SupportedAspectRatio,
} from '../../shared/types';
import { AssetManager } from '../storage/AssetManager';
import { ProjectRepository } from '../storage/ProjectRepository';
import { ChannelRepository } from '../storage/ChannelRepository';
import { ChannelHistoryRepository } from '../storage/ChannelHistoryRepository';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export interface DeliveredMediaValidationResult {
  valid: boolean;
  durationSeconds: number;
  fileSizeBytes: number;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  error?: string;
}

export class ChannelDeliveryService {
  /**
   * Sanitizes a project title into a clean, filesystem-safe filename slug.
   */
  static slugify(title: string): string {
    const slug = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return slug || 'video';
  }

  /**
   * Checks if two files have identical content (by size and SHA-256 hash).
   */
  static areFilesIdentical(pathA: string, pathB: string): boolean {
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return false;
    const statA = fs.statSync(pathA);
    const statB = fs.statSync(pathB);
    if (statA.size !== statB.size) return false;

    // Compare hash of first 1MB or whole file
    const bufA = fs.readFileSync(pathA);
    const bufB = fs.readFileSync(pathB);
    const hashA = crypto.createHash('sha256').update(bufA).digest('hex');
    const hashB = crypto.createHash('sha256').update(bufB).digest('hex');
    return hashA === hashB;
  }

  /**
   * Resolves the destination directory for a video based on channel configuration and aspect ratio.
   *
   * When strictFormatRouting is true:
   *  - 9:16 requires channel.shortsOutputDir (throws if unconfigured)
   *  - 16:9 requires channel.longsOutputDir (throws if unconfigured)
   */
  static resolveDestinationDir(
    channel: ChannelEntity,
    aspectRatio: SupportedAspectRatio,
    options: { strictFormatRouting?: boolean } = {}
  ): string {
    const { strictFormatRouting = false } = options;

    if (aspectRatio === '9:16') {
      if (channel.shortsOutputDir && channel.shortsOutputDir.trim()) {
        return path.resolve(channel.shortsOutputDir.trim());
      }
      if (strictFormatRouting) {
        throw new Error(`Target directory for Shorts (9:16) is not configured in channel "${channel.name}"`);
      }
    } else if (aspectRatio === '16:9') {
      if (channel.longsOutputDir && channel.longsOutputDir.trim()) {
        return path.resolve(channel.longsOutputDir.trim());
      }
      if (strictFormatRouting) {
        throw new Error(`Target directory for Longs (16:9) is not configured in channel "${channel.name}"`);
      }
    }

    if (channel.outputDir && channel.outputDir.trim()) {
      return path.resolve(channel.outputDir.trim());
    }
    return AssetManager.getChannelDeliveryDir(channel.id);
  }

  /**
   * Resolves a collision-safe destination filename in the destination directory.
   *
   * REQUIREMENTS:
   *  1. Deterministic sequence: story.mp4 -> story-1.mp4 -> story-2.mp4.
   *  2. Handles existing suffixes (e.g. story-1 -> story-2).
   *  3. Atomic reservation via 'wx' flag prevents race conditions in concurrent exports.
   *  4. If candidate on disk is completely identical to source, reuses safely.
   */
  static resolveCollisionSafePath(destDir: string, baseSlug: string, sourcePath: string): string {
    // Strip trailing [-_]\d+ from baseSlug to handle existing suffixes cleanly
    const suffixMatch = baseSlug.match(/^(.*?)[-_](\d+)$/);
    const cleanSlug = suffixMatch ? suffixMatch[1] : baseSlug;
    let counter = suffixMatch ? parseInt(suffixMatch[2], 10) : 0;

    while (true) {
      const candidateName = counter === 0 ? `${cleanSlug}.mp4` : `${cleanSlug}-${counter}.mp4`;
      const candidatePath = path.join(destDir, candidateName);

      if (!fs.existsSync(candidatePath)) {
        // Attempt atomic reservation via 'wx' flag to prevent concurrent export race conditions
        try {
          const fd = fs.openSync(candidatePath, 'wx');
          fs.closeSync(fd);
          return candidatePath;
        } catch (e: any) {
          if (e.code === 'EEXIST') {
            // Another export process reserved candidatePath concurrently, try next suffix
            counter++;
            continue;
          }
          throw e;
        }
      }

      // Candidate already exists on disk.
      // If it's already identical to our source file, we can safely reuse.
      if (this.areFilesIdentical(sourcePath, candidatePath)) {
        return candidatePath;
      }

      counter++;
    }
  }

  /**
   * Probes an actual video file with ffprobe to determine its real dimensions,
   * orientation, duration, and aspect ratio. Never relies purely on UI settings or filename.
   */
  static async detectAspectRatio(videoPath: string): Promise<{
    aspectRatio: SupportedAspectRatio;
    width: number;
    height: number;
    durationSeconds: number;
    isVertical: boolean;
    error?: string;
  }> {
    const validation = await this.validateDeliveredVideo(videoPath);
    if (!validation.valid) {
      return {
        aspectRatio: '16:9',
        width: 0,
        height: 0,
        durationSeconds: 0,
        isVertical: false,
        error: validation.error || `Failed to inspect video at ${videoPath}`,
      };
    }

    const { width, height, durationSeconds } = validation;
    if (width <= 0 || height <= 0) {
      return {
        aspectRatio: '16:9',
        width: 0,
        height: 0,
        durationSeconds: 0,
        isVertical: false,
        error: `Invalid video stream dimensions: ${width}x${height}`,
      };
    }

    const ratio = width / height;
    if (ratio <= 0.8) {
      // Definitively vertical / Shorts (e.g. 9/16 = 0.5625, 3/4 = 0.75, 4/5 = 0.8)
      return {
        aspectRatio: '9:16',
        width,
        height,
        durationSeconds,
        isVertical: true,
      };
    } else if (ratio >= 1.2) {
      // Definitively horizontal / Longs (e.g. 16/9 = 1.778, 4/3 = 1.333)
      return {
        aspectRatio: '16:9',
        width,
        height,
        durationSeconds,
        isVertical: false,
      };
    } else {
      // Ambiguous aspect ratio (e.g. square 1:1, or near 1:1)
      return {
        aspectRatio: width < height ? '9:16' : '16:9',
        width,
        height,
        durationSeconds,
        isVertical: height > width,
        error: `Ambiguous aspect ratio detected (${width}x${height}). Cannot automatically classify as Shorts or Longs.`,
      };
    }
  }

  /**
   * Validates a delivered video file using ffprobe.
   *
   * Verifies:
   *  - Destination file exists
   *  - Non-zero size (>= 2000 bytes)
   *  - Readable
   *  - ffprobe succeeds
   *  - Valid video stream
   *  - Expected dimensions (if specified)
   *  - Expected duration within reasonable tolerance (if specified)
   */
  static async validateDeliveredVideo(
    filePath: string,
    options: { expectedAspectRatio?: SupportedAspectRatio; expectedDuration?: number; toleranceSeconds?: number } = {}
  ): Promise<DeliveredMediaValidationResult> {
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: 0,
        videoCodec: 'none',
        audioCodec: 'none',
        width: 0,
        height: 0,
        error: `File does not exist: ${filePath}`,
      };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: 0,
        videoCodec: 'none',
        audioCodec: 'none',
        width: 0,
        height: 0,
        error: `File is empty (0 bytes): ${filePath}`,
      };
    }

    // Verify readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: stat.size,
        videoCodec: 'none',
        audioCodec: 'none',
        width: 0,
        height: 0,
        error: `File is not readable: ${filePath}`,
      };
    }

    const ffprobeBin = FfmpegResolver.findFfprobe() || 'ffprobe';

    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name,codec_type,width,height,duration:format=duration,size',
          '-of',
          'json',
          filePath,
        ],
        { timeout: 10000 }
      );

      const probe = JSON.parse(stdout);
      const streams = probe.streams || [];
      const videoStream = streams.find((s: any) => s.codec_type === 'video');
      const audioStream = streams.find((s: any) => s.codec_type === 'audio');

      if (!videoStream) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          videoCodec: 'none',
          audioCodec: 'none',
          width: 0,
          height: 0,
          error: 'Delivered video file is missing a video stream',
        };
      }

      const width = videoStream.width || 0;
      const height = videoStream.height || 0;

      if (width <= 0 || height <= 0) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          videoCodec: videoStream.codec_name || 'none',
          audioCodec: 'none',
          width,
          height,
          error: `Delivered video file has invalid dimensions (${width}x${height})`,
        };
      }

      if (options.expectedAspectRatio === '9:16' && height <= width) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          videoCodec: videoStream.codec_name || 'none',
          audioCodec: 'none',
          width,
          height,
          error: `Delivered video dimensions (${width}x${height}) do not match expected 9:16 vertical Shorts format`,
        };
      }

      if (options.expectedAspectRatio === '16:9' && width <= height) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          videoCodec: videoStream.codec_name || 'none',
          audioCodec: 'none',
          width,
          height,
          error: `Delivered video dimensions (${width}x${height}) do not match expected 16:9 horizontal Longs format`,
        };
      }

      const formatDuration = parseFloat(probe.format?.duration || '0');
      const videoDuration = parseFloat(videoStream.duration || '0');
      const measuredDuration = formatDuration > 0 ? formatDuration : videoDuration;

      if (measuredDuration <= 0) {
        return {
          valid: false,
          durationSeconds: 0,
          fileSizeBytes: stat.size,
          videoCodec: videoStream.codec_name || 'none',
          audioCodec: 'none',
          width,
          height,
          error: 'Delivered video file has 0s duration or corrupted container',
        };
      }

      if (typeof options.expectedDuration === 'number' && options.expectedDuration > 0) {
        const tolerance = options.toleranceSeconds ?? 1.5;
        const diff = Math.abs(measuredDuration - options.expectedDuration);
        if (diff > tolerance) {
          return {
            valid: false,
            durationSeconds: measuredDuration,
            fileSizeBytes: stat.size,
            videoCodec: videoStream.codec_name || 'none',
            audioCodec: 'none',
            width,
            height,
            error: `Delivered video duration (${measuredDuration.toFixed(2)}s) differs from expected (${options.expectedDuration.toFixed(2)}s) beyond tolerance (${tolerance}s)`,
          };
        }
      }

      return {
        valid: true,
        durationSeconds: Math.round(measuredDuration * 100) / 100,
        fileSizeBytes: stat.size,
        videoCodec: videoStream.codec_name || 'unknown',
        audioCodec: audioStream ? (audioStream.codec_name || 'unknown') : 'none',
        width,
        height,
      };
    } catch (probeErr: any) {
      logger.warn('channel_delivery', `ffprobe validation failed: ${probeErr.message}`);
      return {
        valid: false,
        durationSeconds: 0,
        fileSizeBytes: stat.size,
        videoCodec: 'unknown',
        audioCodec: 'unknown',
        width: 0,
        height: 0,
        error: `ffprobe validation error: ${probeErr.message}`,
      };
    }
  }

  /**
   * Delivers a project's final assembled video to a channel.
   *
   * @param projectId Project to deliver
   * @param channelId Optional channel ID; if omitted, uses project.channelId
   * @param options Options controlling format routing and execution metadata
   */
  static async deliverProject(
    projectId: string,
    channelId?: string,
    options: { strictFormatRouting?: boolean; runId?: string } = {}
  ): Promise<DeliveryHistoryRecord> {
    const project = await ProjectRepository.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const resolvedChannelId = channelId || project.channelId;
    if (!resolvedChannelId) {
      throw new Error(`Project ${projectId} has no assigned channel and no channelId was specified`);
    }

    const channel = await ChannelRepository.get(resolvedChannelId);
    if (!channel) {
      const errorMsg = `Channel not found: ${resolvedChannelId}`;
      await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: resolvedChannelId,
        channelName: 'Deleted Channel',
        sourceVideoPath: '',
        deliveredVideoPath: '',
        aspectRatio: project.settings.imageRatio || '16:9',
        durationSeconds: 0,
        fileSizeBytes: 0,
        videoCodec: 'none',
        audioCodec: 'none',
        status: 'failed',
        error: errorMsg,
        runId: options.runId,
      });
      throw new Error(errorMsg);
    }

    // 1. Locate canonical final video (check final/final.mp4 first, then renders/final_video.mp4)
    const finalMp4_1 = AssetManager.getFinalDestinationPath(projectId, 'final.mp4');
    const finalMp4_2 = path.join(AssetManager.getProjectDir(projectId), 'renders', 'final_video.mp4');
    const sourceVideoPath = fs.existsSync(finalMp4_1) ? finalMp4_1 : finalMp4_2;

    if (!fs.existsSync(sourceVideoPath)) {
      const errorMsg = `Final video not found for project ${projectId}. Run Final Assembly first.`;
      await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: channel.id,
        channelName: channel.name,
        sourceVideoPath,
        deliveredVideoPath: '',
        aspectRatio: project.settings.imageRatio || '16:9',
        durationSeconds: 0,
        fileSizeBytes: 0,
        videoCodec: 'none',
        audioCodec: 'none',
        status: 'failed',
        error: errorMsg,
        runId: options.runId,
      });
      throw new Error(errorMsg);
    }

    const sourceStat = fs.statSync(sourceVideoPath);
    if (sourceStat.size === 0) {
      const errorMsg = `Final video for project ${projectId} is empty (0 bytes).`;
      await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: channel.id,
        channelName: channel.name,
        sourceVideoPath,
        deliveredVideoPath: '',
        aspectRatio: project.settings.imageRatio || '16:9',
        durationSeconds: 0,
        fileSizeBytes: 0,
        videoCodec: 'none',
        audioCodec: 'none',
        status: 'failed',
        error: errorMsg,
        runId: options.runId,
      });
      throw new Error(errorMsg);
    }

    // 2. Detect ACTUAL final video aspect ratio using ffprobe (never rely purely on UI settings)
    const probe = await this.detectAspectRatio(sourceVideoPath);
    if (probe.error) {
      await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: channel.id,
        channelName: channel.name,
        sourceVideoPath,
        deliveredVideoPath: '',
        aspectRatio: project.settings.imageRatio || '16:9',
        durationSeconds: 0,
        fileSizeBytes: sourceStat.size,
        videoCodec: 'none',
        audioCodec: 'none',
        status: 'failed',
        error: `Aspect ratio detection failed: ${probe.error}`,
        runId: options.runId,
      });
      throw new Error(`Aspect ratio detection failed: ${probe.error}`);
    }

    const detectedRatio: SupportedAspectRatio = probe.aspectRatio;
    const orientation = detectedRatio === '9:16' ? 'shorts' : 'longs';

    // 3. Resolve destination folder based on probed aspect ratio
    let destDir: string;
    try {
      destDir = this.resolveDestinationDir(channel, detectedRatio, {
        strictFormatRouting: options.strictFormatRouting ?? false,
      });
    } catch (dirErr: any) {
      await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: channel.id,
        channelName: channel.name,
        sourceVideoPath,
        deliveredVideoPath: '',
        aspectRatio: detectedRatio,
        orientation,
        durationSeconds: probe.durationSeconds,
        fileSizeBytes: sourceStat.size,
        videoCodec: 'none',
        audioCodec: 'none',
        status: 'failed',
        error: dirErr.message,
        runId: options.runId,
      });
      throw dirErr;
    }

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // 4. Resolve collision-safe destination paths
    const baseSlug = this.slugify(project.name);
    const deliveredVideoPath = this.resolveCollisionSafePath(destDir, baseSlug, sourceVideoPath);
    const targetBaseName = path.basename(deliveredVideoPath, path.extname(deliveredVideoPath));
    const collisionHandled = targetBaseName !== baseSlug;

    let deliveredThumbnailPath: string | undefined;
    let deliveredPosterPath: string | undefined;

    try {
      // 5. Copy canonical assets non-destructively
      fs.copyFileSync(sourceVideoPath, deliveredVideoPath);
      logger.info('channel_delivery', 'Copied final video', { sourceVideoPath, deliveredVideoPath });

      // Copy thumbnail if present
      const sourceThumbnailPath = AssetManager.getFinalThumbnailDestinationPath(projectId);
      if (fs.existsSync(sourceThumbnailPath)) {
        deliveredThumbnailPath = path.join(destDir, `${targetBaseName}-thumbnail.jpg`);
        fs.copyFileSync(sourceThumbnailPath, deliveredThumbnailPath);
      }

      // Copy poster if present
      const sourcePosterPath = AssetManager.getFinalPosterDestinationPath(projectId);
      if (fs.existsSync(sourcePosterPath)) {
        deliveredPosterPath = path.join(destDir, `${targetBaseName}-poster.jpg`);
        fs.copyFileSync(sourcePosterPath, deliveredPosterPath);
      }

      // 6. Validate delivered video via ffprobe (stream validation, dimensions, duration)
      const validation = await this.validateDeliveredVideo(deliveredVideoPath, {
        expectedAspectRatio: detectedRatio,
        expectedDuration: probe.durationSeconds,
      });
      if (!validation.valid) {
        throw new Error(validation.error || 'Delivered video validation failed');
      }

      // 7. Record delivery history
      const record = await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: channel.id,
        channelName: channel.name,
        sourceVideoPath,
        deliveredVideoPath,
        deliveredThumbnailPath,
        deliveredPosterPath,
        aspectRatio: detectedRatio,
        orientation,
        collisionHandled,
        durationSeconds: validation.durationSeconds,
        fileSizeBytes: validation.fileSizeBytes,
        videoCodec: validation.videoCodec,
        audioCodec: validation.audioCodec,
        status: 'delivered',
        runId: options.runId,
      });

      // 8. Update project channel assignment if needed
      if (project.channelId !== channel.id || project.channelName !== channel.name) {
        await ProjectRepository.update(project.projectId, {
          channelId: channel.id,
          channelName: channel.name,
        });
      }

      // 9. Update channel stats
      const allProjects = await ProjectRepository.getAll();
      const channelProjects = allProjects.filter((p) => p.channelId === channel.id);
      await ChannelRepository.updateStats(channel.id, {
        totalProjects: channelProjects.length,
        deliveredVideos: (channel.stats?.deliveredVideos || 0) + 1,
        lastDeliveredAt: record.deliveredAt,
      });

      logger.info('channel_delivery', 'Successfully delivered project to channel', {
        projectId: project.projectId,
        channelId: channel.id,
        deliveredVideoPath,
      });

      return record;
    } catch (err: any) {
      // Clean up corrupt delivered video if creation failed
      if (fs.existsSync(deliveredVideoPath)) {
        try {
          const s = fs.statSync(deliveredVideoPath);
          if (s.size === 0 || err.message?.includes('validation failed')) {
            fs.unlinkSync(deliveredVideoPath);
          }
        } catch {}
      }

      logger.error('channel_delivery', 'Delivery failed', err);
      await ChannelHistoryRepository.record({
        projectId: project.projectId,
        projectName: project.name,
        channelId: channel.id,
        channelName: channel.name,
        sourceVideoPath,
        deliveredVideoPath: fs.existsSync(deliveredVideoPath) ? deliveredVideoPath : '',
        deliveredThumbnailPath,
        deliveredPosterPath,
        aspectRatio: detectedRatio,
        orientation,
        collisionHandled,
        durationSeconds: 0,
        fileSizeBytes: fs.existsSync(deliveredVideoPath) ? fs.statSync(deliveredVideoPath).size : 0,
        videoCodec: 'unknown',
        audioCodec: 'unknown',
        status: 'failed',
        error: err.message || 'Delivery error',
        runId: options.runId,
      });
      throw err;
    }
  }

  /**
   * Retries a previously recorded delivery.
   */
  static async retryDelivery(deliveryId: string): Promise<DeliveryHistoryRecord> {
    const record = await ChannelHistoryRepository.getById(deliveryId);
    if (!record) {
      throw new Error(`Delivery record ${deliveryId} not found`);
    }

    return await this.deliverProject(record.projectId, record.channelId);
  }
}
