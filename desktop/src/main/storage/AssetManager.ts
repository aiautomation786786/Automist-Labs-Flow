/**
 * AssetManager – Deterministic file and directory manager for project assets.
 *
 * Responsibilities:
 *  - Organizing output directories under: %LOCALAPPDATA%\GoogleFlowApp\projects\{projectId}\
 *  - Generating collision-free, deterministic filenames based on slotIndex, promptId, and jobId.
 *  - Validating downloaded output files before a job is marked completed.
 *  - Never trusting raw prompt text for filenames.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAppDataDir } from '../utils/AppLogger';

export interface ProjectDirectories {
  projectDir: string;
  imagesDir: string;
  videosDir: string;
  thumbnailsDir: string;
  logsDir: string;
}

export class AssetManager {
  /**
   * Returns the root projects folder.
   */
  static getProjectsRootDir(): string {
    return path.join(getAppDataDir(), 'projects');
  }

  /**
   * Returns the base directory for a specific project.
   */
  static getProjectDir(projectId: string): string {
    return path.join(this.getProjectsRootDir(), projectId);
  }

  /**
   * Resolves and ensures all subdirectories for a project exist.
   */
  static ensureProjectDirectories(projectId: string): ProjectDirectories {
    const projectDir = this.getProjectDir(projectId);
    const imagesDir = path.join(projectDir, 'images');
    const videosDir = path.join(projectDir, 'videos');
    const thumbnailsDir = path.join(projectDir, 'thumbnails');
    const logsDir = path.join(projectDir, 'logs');

    for (const dir of [projectDir, imagesDir, videosDir, thumbnailsDir, logsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    return { projectDir, imagesDir, videosDir, thumbnailsDir, logsDir };
  }

  /**
   * Generates a deterministic, collision-free destination path for an image asset.
   * Format: %LOCALAPPDATA%\...\projects\{projectId}\images\slot_{slotIndex}_{promptId}_{jobId}.png
   */
  static getImageDestinationPath(
    projectId: string,
    slotIndex: number,
    promptId: string,
    jobId: string,
    extension = '.png',
  ): string {
    const { imagesDir } = this.ensureProjectDirectories(projectId);
    const sanitizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    const filename = `slot_${String(slotIndex).padStart(2, '0')}_${promptId}_${jobId}${sanitizedExt}`;
    return path.join(imagesDir, filename);
  }

  /**
   * Generates a deterministic, collision-free destination path for a video asset.
   * Format: %LOCALAPPDATA%\...\projects\{projectId}\videos\slot_{slotIndex}_{promptId}_{jobId}.mp4
   */
  static getVideoDestinationPath(
    projectId: string,
    slotIndex: number,
    promptId: string,
    jobId: string,
    extension = '.mp4',
  ): string {
    const { videosDir } = this.ensureProjectDirectories(projectId);
    const sanitizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    const filename = `slot_${String(slotIndex).padStart(2, '0')}_${promptId}_${jobId}${sanitizedExt}`;
    return path.join(videosDir, filename);
  }

  /**
   * Generates a destination path for a thumbnail asset.
   */
  static getThumbnailDestinationPath(
    projectId: string,
    slotIndex: number,
    promptId: string,
    jobId: string,
  ): string {
    const { thumbnailsDir } = this.ensureProjectDirectories(projectId);
    const filename = `thumb_slot_${String(slotIndex).padStart(2, '0')}_${promptId}_${jobId}.jpg`;
    return path.join(thumbnailsDir, filename);
  }

  /**
   * Strict validation of output file safety before completing a job.
   *
   * Confirms:
   *  1. File exists on disk.
   *  2. File size is greater than 0 bytes.
   *  3. File is located strictly inside the designated project directory.
   */
  static verifyOutputFile(filePath: string, expectedProjectId: string): {
    valid: boolean;
    sizeBytes: number;
    error?: string;
  } {
    if (!fs.existsSync(filePath)) {
      return { valid: false, sizeBytes: 0, error: `Output file does not exist: ${filePath}` };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { valid: false, sizeBytes: 0, error: `Output file is empty (0 bytes): ${filePath}` };
    }

    const expectedBaseDir = path.resolve(this.getProjectDir(expectedProjectId));
    const resolvedFilePath = path.resolve(filePath);

    if (!resolvedFilePath.startsWith(expectedBaseDir)) {
      return {
        valid: false,
        sizeBytes: stat.size,
        error: `Security violation: file path ${resolvedFilePath} does not belong to project ${expectedProjectId}`,
      };
    }

    return { valid: true, sizeBytes: stat.size };
  }
}
