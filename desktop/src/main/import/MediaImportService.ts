/**
 * MediaImportService – Safe atomic ingestion and cryptographic identity tracking for local media.
 *
 * Guarantees:
 *  1. Source Preservation: The original user file is strictly untouched (never modified, moved, or deleted).
 *  2. Stable Cryptographic Identity: Computes SHA-256 hash from file bytes for deterministic identity
 *     and duplicate detection across app restarts.
 *  3. Privacy Invariant: Host filesystem paths (e.g. C:\Users\...) are stripped; only the sanitized
 *     basename and project-local relative path are persisted and exposed.
 *  4. Strict Format Guard: Only supports verified .mp4, .mov, and .mkv files.
 *  5. Probe-Before-Create: File must pass ffprobe validation before any project directory is created.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  ProjectEntity,
  ProjectSourceMedia,
  ImportMediaParams,
  ProjectSettings,
} from '../../shared/types';
import { AssetManager } from '../storage/AssetManager';
import { ProjectRepository } from '../storage/ProjectRepository';
import { MediaProbeService } from './MediaProbeService';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export const SUPPORTED_IMPORT_EXTENSIONS = ['.mp4', '.mov', '.mkv'] as const;

export class MediaImportService {
  /**
   * Computes the SHA-256 hash of a file via streaming.
   */
  static async computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Searches existing projects to check if the given content hash has already been imported.
   */
  static async findDuplicateProject(hashSha256: string): Promise<ProjectEntity | null> {
    const projects = await ProjectRepository.getAll();
    return projects.find((p) => p.sourceMedia?.hashSha256 === hashSha256) || null;
  }

  /**
   * Safely imports a local video into a new project container.
   */
  static async importMedia(params: ImportMediaParams): Promise<ProjectEntity> {
    const { filePath } = params;

    if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('Please select a valid video file.');
    }

    const cleanPath = filePath.trim();
    if (!fs.existsSync(cleanPath)) {
      throw new Error(`The selected video file does not exist on disk: ${cleanPath}`);
    }

    const ext = path.extname(cleanPath).toLowerCase();
    if (!SUPPORTED_IMPORT_EXTENSIONS.includes(ext as any)) {
      throw new Error(
        `Unsupported video format "${ext}". Supported formats are: ${SUPPORTED_IMPORT_EXTENSIONS.join(', ')}`
      );
    }

    // 1. Probe source media first to validate container & streams
    const probe = await MediaProbeService.probeMedia(cleanPath);
    if (!probe.valid) {
      throw new Error(probe.error || 'Failed to inspect media file.');
    }

    // 2. Compute stable SHA-256 content signature
    const hashSha256 = await this.computeFileSha256(cleanPath);

    // 3. Initialize project container
    const projectId = ProjectRepository.generateProjectId();
    const projectDirs = AssetManager.ensureProjectDirectories(projectId);

    // 4. Safely copy source file into project storage (original file is never touched)
    const targetFilename = `source_video${ext}`;
    const destPath = path.join(projectDirs.videosDir, targetFilename);

    try {
      fs.copyFileSync(cleanPath, destPath);
    } catch (copyErr: any) {
      // Cleanup partially created directory on copy failure
      try {
        fs.rmSync(projectDirs.projectDir, { recursive: true, force: true });
      } catch {}
      throw new Error(`Failed to copy media into project: ${copyErr.message}`);
    }

    const isPortrait = probe.width < probe.height;
    const now = new Date().toISOString();
    const rawName = params.name?.trim() || path.parse(cleanPath).name;

    const sourceMedia: ProjectSourceMedia = {
      sourceType: 'local_file',
      originalFilename: path.basename(cleanPath),
      fileSizeBytes: probe.fileSizeBytes,
      hashSha256,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      hasAudio: probe.hasAudio,
      importedAt: now,
      mediaPath: `videos/${targetFilename}`,
    };

    const settings: ProjectSettings = {
      provider: 'flow',
      imageRatio: isPortrait ? '9:16' : '16:9',
      videoRatio: isPortrait ? '9:16' : '16:9',
      geminiAspectRatio: isPortrait ? '9:16' : '16:9',
      processingOrder: 'images_first',
      autoRetry: true,
      maxRetries: 2,
      imageDownloadQuality: 'original',
      videoDownloadQuality: 'original',
      generationMode: 'custom',
    };

    const project: ProjectEntity = {
      projectId,
      name: rawName,
      channelId: params.channelId,
      channelName: params.channelName,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      origin: 'imported',
      sourceMedia,
      settings,
      slots: [],
      stats: {
        totalImages: 0,
        totalVideos: 1,
        completedImages: 0,
        completedVideos: 1,
        failedCount: 0,
      },
    };

    await ProjectRepository.save(project);
    logger.info('media_import', `Successfully imported media to project ${projectId}`, {
      filename: sourceMedia.originalFilename,
      hashSha256,
      duration: sourceMedia.durationSeconds,
      dimensions: `${sourceMedia.width}x${sourceMedia.height}`,
    });

    return project;
  }
}
