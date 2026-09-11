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
  audioDir: string;
  metadataDir: string;
  rendersDir: string;
  subtitlesDir: string;
  finalDir: string;
  musicDir: string;
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
    const audioDir = path.join(projectDir, 'audio');
    const metadataDir = path.join(projectDir, 'metadata');
    const rendersDir = path.join(projectDir, 'renders');
    const subtitlesDir = path.join(projectDir, 'subtitles');
    const finalDir = path.join(projectDir, 'final');
    const musicDir = path.join(projectDir, 'music');

    for (const dir of [projectDir, imagesDir, videosDir, thumbnailsDir, logsDir, audioDir, metadataDir, rendersDir, subtitlesDir, finalDir, musicDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    return { projectDir, imagesDir, videosDir, thumbnailsDir, logsDir, audioDir, metadataDir, rendersDir, subtitlesDir, finalDir, musicDir };
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

  /**
   * Generates destination path for the final assembled MP4 video.
   * Format: %LOCALAPPDATA%\...\projects\{projectId}\final\final.mp4
   */
  static getFinalDestinationPath(projectId: string, filename = 'final.mp4'): string {
    const { finalDir } = this.ensureProjectDirectories(projectId);
    return path.join(finalDir, filename);
  }

  /**
   * Generates destination path for the final video thumbnail.
   * Format: %LOCALAPPDATA%\...\projects\{projectId}\final\final-thumbnail.jpg
   */
  static getFinalThumbnailDestinationPath(projectId: string): string {
    const { finalDir } = this.ensureProjectDirectories(projectId);
    return path.join(finalDir, 'final-thumbnail.jpg');
  }

  /**
   * Generates destination path for the final video poster image.
   * Format: %LOCALAPPDATA%\...\projects\{projectId}\final\final-poster.jpg
   */
  static getFinalPosterDestinationPath(projectId: string): string {
    const { finalDir } = this.ensureProjectDirectories(projectId);
    return path.join(finalDir, 'final-poster.jpg');
  }

  /**
   * Returns the project-local music directory.
   */
  static getMusicDir(projectId: string): string {
    const { musicDir } = this.ensureProjectDirectories(projectId);
    return musicDir;
  }

  /**
   * Returns the root channels directory: %LOCALAPPDATA%\GoogleFlowApp\channels
   */
  static getChannelsRootDir(): string {
    return path.join(getAppDataDir(), 'channels');
  }

  /**
   * Returns the base directory for a specific channel.
   */
  static getChannelDir(channelId: string): string {
    return path.join(this.getChannelsRootDir(), channelId);
  }

  /**
   * Returns the default delivery directory for a specific channel.
   */
  static getChannelDeliveryDir(channelId: string): string {
    return path.join(this.getChannelDir(channelId), 'delivered');
  }

  /**
   * Ensures channel directory and its delivery directory exist.
   */
  static ensureChannelDirectories(channelId: string): { channelDir: string; deliveryDir: string } {
    const channelDir = this.getChannelDir(channelId);
    const deliveryDir = this.getChannelDeliveryDir(channelId);
    for (const dir of [this.getChannelsRootDir(), channelDir, deliveryDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    return { channelDir, deliveryDir };
  }

  /**
   * Returns the root history directory: %LOCALAPPDATA%\GoogleFlowApp\history
   */
  static getHistoryRootDir(): string {
    return path.join(getAppDataDir(), 'history');
  }

  /**
   * Returns the path to the delivery history JSON file.
   */
  static getDeliveryHistoryPath(): string {
    return path.join(this.getHistoryRootDir(), 'delivery_history.json');
  }

  /**
   * Ensures the history root directory exists.
   */
  static ensureHistoryDirectories(): { historyDir: string } {
    const historyDir = this.getHistoryRootDir();
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    return { historyDir };
  }

  /**
   * Returns the root skills directory: %LOCALAPPDATA%\GoogleFlowApp\skills
   */
  static getSkillsRootDir(): string {
    return path.join(getAppDataDir(), 'skills');
  }

  /**
   * Returns the directory for a specific skill: %LOCALAPPDATA%\GoogleFlowApp\skills\{skillId}
   */
  static getSkillDir(skillId: string): string {
    return path.join(this.getSkillsRootDir(), skillId);
  }

  /**
   * Returns the path to a skill's skill.json file.
   */
  static getSkillJsonPath(skillId: string): string {
    return path.join(this.getSkillDir(skillId), 'skill.json');
  }

  /**
   * Ensures the skill directory exists.
   */
  static ensureSkillDirectories(skillId: string): { skillDir: string } {
    const skillDir = this.getSkillDir(skillId);
    for (const dir of [this.getSkillsRootDir(), skillDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    return { skillDir };
  }

  /**
   * Returns the directory for intermediate generated scripts:
   * %LOCALAPPDATA%\GoogleFlowApp\generated-scripts (ZBot spec §9)
   */
  static getGeneratedScriptsDir(): string {
    const dir = path.join(getAppDataDir(), 'generated-scripts');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
}

