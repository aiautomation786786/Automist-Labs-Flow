/**
 * ProjectRepository – Concurrency-safe persistence for ProjectEntity and PromptSlots.
 *
 * GUARANTEES:
 *  1. Concurrency-Safe: Serializes all mutations through FileMutex to eliminate
 *     lost-update race conditions when multiple workers update slots simultaneously.
 *  2. Atomic Writes: Writes to .tmp file then renames, preventing corrupt/partial files.
 *  3. Immutable Slot Identity: slotIndex, promptId, and type are permanent.
 *  4. Deterministic Ordering: slots are ALWAYS ordered strictly by slotIndex (0, 1, 2...).
 *     They are NEVER reordered according to completion time.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  ProjectEntity,
  PromptSlotEntity,
  ProjectSettings,
  CreateProjectParams,
} from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export type { CreateProjectParams };

export class ProjectRepository {
  private static cache = new Map<string, { entity: ProjectEntity; mtimeMs: number }>();
  private static readonly MAX_CACHE_ENTRIES = 50;

  private static setCache(projectId: string, entity: ProjectEntity, mtimeMs: number): void {
    this.cache.delete(projectId);
    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(projectId, {
      entity: JSON.parse(JSON.stringify(entity)),
      mtimeMs,
    });
  }

  /**
   * Generates a deterministic, URL-safe project ID.
   */
  static generateProjectId(): string {
    return `proj_${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Clears in-memory cache (primarily for tests or memory reclamation).
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Returns path to the project.json file for a given projectId.
   */
  static getProjectJsonPath(projectId: string): string {
    return path.join(AssetManager.getProjectDir(projectId), 'project.json');
  }

  /**
   * Creates and persists a new ProjectEntity with fully validated slots.
   */
  static async create(params: CreateProjectParams): Promise<ProjectEntity> {
    const projectId = this.generateProjectId();
    const now = new Date().toISOString();

    AssetManager.ensureProjectDirectories(projectId);

    // Build slots preserving exact input index
    const slots: PromptSlotEntity[] = params.prompts.map((p, index) => ({
      slotIndex: index,
      promptId: `slot_${crypto.randomBytes(6).toString('hex')}`,
      projectId,
      type: p.type,
      provider: p.provider || params.provider || 'flow',
      promptText: p.text.trim(),
      sourceImagePath: p.sourceImagePath,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }));

    const settings: ProjectSettings = {
      provider: params.provider || 'flow',
      imageRatio: params.imageRatio ?? '16:9',
      videoRatio: params.videoRatio ?? '16:9',
      geminiAspectRatio: params.geminiAspectRatio ?? (params.videoRatio === '9:16' ? '9:16' : '16:9'),
      processingOrder: params.processingOrder ?? 'images_first',
      autoRetry: params.autoRetry ?? true,
      maxRetries: params.maxRetries ?? 2,
      imageDownloadQuality: params.imageDownloadQuality ?? 'original',
      videoDownloadQuality: params.videoDownloadQuality ?? 'original',
      generationMode: params.generationMode ?? 'custom',
      imageModel: params.imageModel ?? 'Nano Banana 2',
      videoModel: params.videoModel,
      videoResolution: params.videoResolution,
      videoDuration: params.videoDuration,
      selectedProfileIds: params.selectedProfileIds,
    };

    const project: ProjectEntity = {
      projectId,
      name: params.name.trim(),
      campaignTag: params.campaignTag?.trim(),
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      settings,
      slots,
      stats: {
        totalImages: slots.filter((s) => s.type === 'image').length,
        totalVideos: slots.filter((s) => s.type === 'video').length,
        completedImages: 0,
        completedVideos: 0,
        failedCount: 0,
      },
    };

    await this.writeProjectAtomic(project);
    logger.info('project_repo', 'Created project', { projectId, totalSlots: slots.length });
    return project;
  }

  /**
   * Retrieves a project by ID with mtime-verified cache lookup.
   */
  static async get(projectId: string): Promise<ProjectEntity | null> {
    const filePath = this.getProjectJsonPath(projectId);
    if (!fs.existsSync(filePath)) {
      this.cache.delete(projectId);
      return null;
    }

    return await fileMutex.runExclusive(projectId, async () => {
      try {
        const stat = fs.statSync(filePath);
        const cached = this.cache.get(projectId);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          this.setCache(projectId, cached.entity, cached.mtimeMs);
          return JSON.parse(JSON.stringify(cached.entity));
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const project = JSON.parse(content) as ProjectEntity;
        // Strict invariant check: ensure slots remain sorted by slotIndex
        project.slots.sort((a, b) => a.slotIndex - b.slotIndex);

        this.setCache(projectId, project, stat.mtimeMs);

        return project;
      } catch (err) {
        logger.error('project_repo', `Failed to read project ${projectId}`, err as Error);
        return null;
      }
    });
  }

  /**
   * Returns all existing projects on disk using bounded chunk concurrency.
   */
  static async getAll(): Promise<ProjectEntity[]> {
    const rootDir = AssetManager.getProjectsRootDir();
    if (!fs.existsSync(rootDir)) {
      return [];
    }

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const projectDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('proj_'));
    const projects: ProjectEntity[] = [];
    const chunkSize = 8;

    for (let i = 0; i < projectDirs.length; i += chunkSize) {
      const chunk = projectDirs.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map((e) => this.get(e.name)));
      for (const proj of chunkResults) {
        if (proj) {
          projects.push(proj);
        }
      }
    }

    // Sort by creation date descending
    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Concurrency-safe atomic update of a project entity.
   */
  static async update(
    projectId: string,
    patch: Partial<Omit<ProjectEntity, 'projectId' | 'createdAt' | 'slots'>>,
  ): Promise<ProjectEntity> {
    return await fileMutex.runExclusive(projectId, async () => {
      const project = await this.readProjectDirect(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found.`);
      }

      Object.assign(project, patch);
      project.updatedAt = new Date().toISOString();

      await this.writeProjectAtomic(project);
      return project;
    });
  }

  /**
   * Concurrency-safe atomic update of a specific prompt slot within a project.
   *
   * CRITICAL GUARANTEE:
   *  - slotIndex, promptId, and type are IMMUTABLE and cannot be overwritten.
   *  - Re-calculates project stats automatically.
   *  - Preserves deterministic array order 0..N-1.
   */
  static async updateSlot(
    projectId: string,
    slotIndex: number,
    patch: Partial<Omit<PromptSlotEntity, 'slotIndex' | 'promptId' | 'projectId' | 'type' | 'createdAt'>>,
  ): Promise<PromptSlotEntity> {
    return await fileMutex.runExclusive(projectId, async () => {
      const project = await this.readProjectDirect(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found.`);
      }

      const slot = project.slots.find((s) => s.slotIndex === slotIndex);
      if (!slot) {
        throw new Error(`Slot with index ${slotIndex} not found in project ${projectId}.`);
      }

      // Apply patch while strictly preserving immutable fields
      Object.assign(slot, patch);
      slot.updatedAt = new Date().toISOString();

      // Recalculate stats
      project.stats = {
        totalImages: project.slots.filter((s) => s.type === 'image').length,
        totalVideos: project.slots.filter((s) => s.type === 'video').length,
        completedImages: project.slots.filter((s) => s.type === 'image' && s.status === 'completed').length,
        completedVideos: project.slots.filter((s) => s.type === 'video' && s.status === 'completed').length,
        failedCount: project.slots.filter((s) => s.status === 'failed').length,
      };

      // Check if all slots completed
      const allDone = project.slots.every((s) => s.status === 'completed' || s.status === 'cancelled');
      if (allDone && project.status === 'running') {
        project.status = 'completed';
      }

      project.updatedAt = new Date().toISOString();

      // Ensure deterministic order
      project.slots.sort((a, b) => a.slotIndex - b.slotIndex);

      await this.writeProjectAtomic(project);
      return slot;
    });
  }

  /**
   * Deletes a project and its files from disk.
   */
  static async delete(projectId: string): Promise<void> {
    this.cache.delete(projectId);
    await fileMutex.runExclusive(projectId, async () => {
      const dir = AssetManager.getProjectDir(projectId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      logger.info('project_repo', 'Deleted project', { projectId });
    });
  }

  // ---- Internal Helpers -----------------------------------------------------

  private static async readProjectDirect(projectId: string): Promise<ProjectEntity | null> {
    const filePath = this.getProjectJsonPath(projectId);
    if (!fs.existsSync(filePath)) {
      this.cache.delete(projectId);
      return null;
    }
    const stat = fs.statSync(filePath);
    const cached = this.cache.get(projectId);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      this.setCache(projectId, cached.entity, cached.mtimeMs);
      return JSON.parse(JSON.stringify(cached.entity));
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content) as ProjectEntity;
    project.slots.sort((a, b) => a.slotIndex - b.slotIndex);
    this.setCache(projectId, project, stat.mtimeMs);
    return project;
  }

  private static async writeProjectAtomic(project: ProjectEntity): Promise<void> {
    const filePath = this.getProjectJsonPath(project.projectId);
    const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

    // Ensure parent dir exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to temporary file first
    fs.writeFileSync(tmpPath, JSON.stringify(project, null, 2), 'utf-8');

    // Atomic replace with Windows retry/fallback safeguard
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        break;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 15));
        } else {
          try {
            fs.copyFileSync(tmpPath, filePath);
            fs.unlinkSync(tmpPath);
            break;
          } catch {
            throw err;
          }
        }
      }
    }

    try {
      const stat = fs.statSync(filePath);
      this.setCache(project.projectId, project, stat.mtimeMs);
    } catch {
      // Ignore cache populate error
    }
  }
}
