/**
 * StoryRepository – Concurrency-safe persistence for Video Factory stories,
 * configurations, and draft workflow states.
 *
 * Guarantees:
 *  - Project-isolated: saves story.json and factory_config.json directly in the project directory.
 *  - Atomic Writes: writes to unique .tmp file then renames with Windows file-lock retry.
 *  - Concurrency-safe: serialized via FileMutex per projectId and 'factory_draft'.
 *  - Draft Persistence: persists active wizard draft to config/video_factory_draft.json so
 *    state survives screen navigation and application restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  StoryEntity,
  SceneEntity,
  VideoFactoryConfig,
  VideoFactoryDraft,
  TtsAudioManifest,
  RenderManifest,
  FinalRenderManifest,
  ExportManifest,
  VideoFactoryPipelineState,
  VideoFactoryStage,
  VideoFactoryMode,
  StageState,
} from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { getAppDataDir, AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class StoryRepository {
  private static customDraftPath: string | null = null;
  private static storyCache = new Map<string, { story: StoryEntity; mtimeMs: number }>();
  private static configCache = new Map<string, { config: VideoFactoryConfig; mtimeMs: number }>();

  /**
   * Overrides the draft storage path (for unit tests).
   */
  static setCustomDraftPath(p: string | null): void {
    this.customDraftPath = p;
  }

  /**
   * Clears in-memory caches.
   */
  static clearCache(): void {
    this.storyCache.clear();
    this.configCache.clear();
  }

  /**
   * Resolves path to draft settings JSON.
   */
  static getDraftPath(): string {
    if (this.customDraftPath) {
      return this.customDraftPath;
    }
    const configDir = path.join(getAppDataDir(), 'config');
    return path.join(configDir, 'video_factory_draft.json');
  }

  /**
   * Returns default initial draft state for Video Factory.
   */
  static getDefaultDraft(): VideoFactoryDraft {
    return {
      activeMode: 'full_video',
      step: 1,
      title: 'New Faceless Video',
      rawScript: '',
      scenes: [],
      aspectRatio: '16:9',
      subtitlesEnabled: true,
      subtitleStyle: 'bottom_glass',
      motionEnabled: true,
      motionStyle: 'breathe',
      transitionStyle: 'hard_cut',
      voiceEngine: 'edge-tts',
      voiceId: 'en-US-ChristopherNeural',
      lastSaved: new Date().toISOString(),
    };
  }

  /**
   * Resolves path to story.json for a given projectId.
   */
  static getStoryPath(projectId: string): string {
    return path.join(AssetManager.getProjectDir(projectId), 'story.json');
  }

  /**
   * Resolves path to factory_config.json for a given projectId.
   */
  static getConfigPath(projectId: string): string {
    return path.join(AssetManager.getProjectDir(projectId), 'factory_config.json');
  }

  // -------------------------------------------------------------------------
  // Active Draft Operations
  // -------------------------------------------------------------------------

  /**
   * Retrieves the persisted Video Factory draft, or returns default draft if none exists.
   */
  static async getDraft(): Promise<VideoFactoryDraft> {
    const filePath = this.getDraftPath();
    if (!fs.existsSync(filePath)) {
      return this.getDefaultDraft();
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return { ...this.getDefaultDraft(), ...parsed };
    } catch (err) {
      logger.warn('story_repo', 'Draft file corrupted or unreadable. Returning default draft.', { error: (err as Error).message });
      return this.getDefaultDraft();
    }
  }

  /**
   * Atomically updates and persists the active Video Factory draft.
   */
  static async saveDraft(patch: Partial<VideoFactoryDraft>): Promise<VideoFactoryDraft> {
    return await fileMutex.runExclusive('factory_draft', async () => {
      const current = await this.getDraft();
      const updated: VideoFactoryDraft = {
        ...current,
        ...patch,
        lastSaved: new Date().toISOString(),
      };

      const filePath = this.getDraftPath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Project Story Operations
  // -------------------------------------------------------------------------

  /**
   * Saves story entity to the project's directory.
   */
  static async saveStory(projectId: string, story: StoryEntity): Promise<StoryEntity> {
    return await fileMutex.runExclusive(projectId, async () => {
      AssetManager.ensureProjectDirectories(projectId);
      const filePath = this.getStoryPath(projectId);
      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

      const toPersist: StoryEntity = {
        ...story,
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(tmpPath, JSON.stringify(toPersist, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      try {
        const stat = fs.statSync(filePath);
        this.storyCache.set(projectId, { story: JSON.parse(JSON.stringify(toPersist)), mtimeMs: stat.mtimeMs });
      } catch {}

      return toPersist;
    });
  }

  /**
   * Retrieves the story entity for a project, or null if not found.
   */
  static async getStory(projectId: string): Promise<StoryEntity | null> {
    const filePath = this.getStoryPath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this.storyCache.get(projectId);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return JSON.parse(JSON.stringify(cached.story));
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const story = JSON.parse(content) as StoryEntity;
      this.storyCache.set(projectId, { story: JSON.parse(JSON.stringify(story)), mtimeMs: stat.mtimeMs });
      return story;
    } catch (err) {
      logger.error('story_repo', `Failed to read story.json for project ${projectId}`, err as Error);
      return null;
    }
  }

  /**
   * Updates an existing project's story.json. Throws if project does not exist.
   */
  static async updateStory(projectId: string, story: StoryEntity): Promise<StoryEntity> {
    const existing = await this.getStory(projectId);
    if (!existing) {
      throw new Error(`Cannot update story: story.json does not exist for project ${projectId}`);
    }
    return await this.saveStory(projectId, story);
  }

  /**
   * Updates a single scene within an existing project's story.json.
   */
  static async updateScene(
    projectId: string,
    sceneNumber: number,
    patch: Partial<SceneEntity>
  ): Promise<StoryEntity> {
    const story = await this.getStory(projectId);
    if (!story) {
      throw new Error(`Cannot update scene: story.json does not exist for project ${projectId}`);
    }

    const sceneIdx = story.scenes.findIndex((s) => s.sceneNumber === sceneNumber);
    if (sceneIdx === -1) {
      throw new Error(`Scene ${sceneNumber} not found in story for project ${projectId}`);
    }

    const updatedScene: SceneEntity = {
      ...story.scenes[sceneIdx],
      ...patch,
      sceneNumber, // Preserve original scene number
    };

    story.scenes[sceneIdx] = updatedScene;
    return await this.saveStory(projectId, story);
  }

  /**
   * Saves factory_config.json for a project.
   */
  static async saveConfig(projectId: string, config: VideoFactoryConfig): Promise<VideoFactoryConfig> {
    return await fileMutex.runExclusive(projectId, async () => {
      AssetManager.ensureProjectDirectories(projectId);
      const filePath = this.getConfigPath(projectId);
      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

      fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      try {
        const stat = fs.statSync(filePath);
        this.configCache.set(projectId, { config: JSON.parse(JSON.stringify(config)), mtimeMs: stat.mtimeMs });
      } catch {}

      return config;
    });
  }

  /**
   * Retrieves factory_config.json for a project, or null if not found.
   */
  static async getConfig(projectId: string): Promise<VideoFactoryConfig | null> {
    const filePath = this.getConfigPath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this.configCache.get(projectId);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return JSON.parse(JSON.stringify(cached.config));
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content) as VideoFactoryConfig;
      this.configCache.set(projectId, { config: JSON.parse(JSON.stringify(config)), mtimeMs: stat.mtimeMs });
      return config;
    } catch (err) {
      logger.error('story_repo', `Failed to read factory_config.json for project ${projectId}`, err as Error);
      return null;
    }
  }

  /**
   * Returns path to metadata/audio.json for a project.
   */
  static getAudioManifestPath(projectId: string): string {
    return path.join(AssetManager.getProjectDir(projectId), 'metadata', 'audio.json');
  }

  /**
   * Saves metadata/audio.json for a project atomically.
   */
  static async saveAudioManifest(projectId: string, manifest: TtsAudioManifest): Promise<TtsAudioManifest> {
    return await fileMutex.runExclusive(projectId, async () => {
      AssetManager.ensureProjectDirectories(projectId);
      const filePath = this.getAudioManifestPath(projectId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      return manifest;
    });
  }

  /**
   * Retrieves metadata/audio.json for a project, or null if not found.
   */
  static async getAudioManifest(projectId: string): Promise<TtsAudioManifest | null> {
    const filePath = this.getAudioManifestPath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TtsAudioManifest;
    } catch (err) {
      logger.error('story_repo', `Failed to read audio manifest for project ${projectId}`, err as Error);
      return null;
    }
  }

  /**
   * Returns path to metadata/render.json for a project.
   */
  static getRenderManifestPath(projectId: string): string {
    return path.join(AssetManager.getProjectDir(projectId), 'metadata', 'render.json');
  }

  /**
   * Saves metadata/render.json for a project atomically.
   */
  static async saveRenderManifest(projectId: string, manifest: RenderManifest): Promise<RenderManifest> {
    return await fileMutex.runExclusive(projectId, async () => {
      AssetManager.ensureProjectDirectories(projectId);
      const filePath = this.getRenderManifestPath(projectId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      return manifest;
    });
  }

  /**
   * Retrieves metadata/render.json for a project, or null if not found.
   */
  static async getRenderManifest(projectId: string): Promise<RenderManifest | null> {
    const filePath = this.getRenderManifestPath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as RenderManifest;
    } catch (err) {
      logger.error('story_repo', `Failed to read render manifest for project ${projectId}`, err as Error);
      return null;
    }
  }

  /**
   * Resolves the path to metadata/final_render.json for a project.
   */
  static getFinalRenderManifestPath(projectId: string): string {
    const { metadataDir } = AssetManager.ensureProjectDirectories(projectId);
    return path.join(metadataDir, 'final_render.json');
  }

  /**
   * Atomically saves the final render manifest to metadata/final_render.json.
   */
  static async saveFinalRenderManifest(projectId: string, manifest: FinalRenderManifest): Promise<FinalRenderManifest> {
    return await fileMutex.runExclusive(`final_render_manifest:${projectId}`, async () => {
      const filePath = this.getFinalRenderManifestPath(projectId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      return manifest;
    });
  }

  /**
   * Retrieves metadata/final_render.json for a project, or null if not found.
   */
  static async getFinalRenderManifest(projectId: string): Promise<FinalRenderManifest | null> {
    const filePath = this.getFinalRenderManifestPath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as FinalRenderManifest;
    } catch (err) {
      logger.error('story_repo', `Failed to read final render manifest for project ${projectId}`, err as Error);
      return null;
    }
  }

  /**
   * Resolves the path to metadata/export.json for a project.
   */
  static getExportManifestPath(projectId: string): string {
    const { metadataDir } = AssetManager.ensureProjectDirectories(projectId);
    return path.join(metadataDir, 'export.json');
  }

  /**
   * Atomically saves the export manifest to metadata/export.json.
   */
  static async saveExportManifest(projectId: string, manifest: ExportManifest): Promise<ExportManifest> {
    return await fileMutex.runExclusive(`export_manifest:${projectId}`, async () => {
      const filePath = this.getExportManifestPath(projectId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      return manifest;
    });
  }

  /**
   * Retrieves metadata/export.json for a project, or null if not found.
   */
  static async getExportManifest(projectId: string): Promise<ExportManifest | null> {
    const filePath = this.getExportManifestPath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ExportManifest;
    } catch (err) {
      logger.error('story_repo', `Failed to read export manifest for project ${projectId}`, err as Error);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Unified Pipeline State Operations (Phase 2)
  // -------------------------------------------------------------------------

  /**
   * Resolves the path to metadata/pipeline.json for a project.
   */
  static getPipelineStatePath(projectId: string): string {
    const { metadataDir } = AssetManager.ensureProjectDirectories(projectId);
    return path.join(metadataDir, 'pipeline.json');
  }

  /**
   * Initializes default persistent pipeline state for a project.
   */
  static initializePipelineState(projectId: string, mode: VideoFactoryMode = 'full_video'): VideoFactoryPipelineState {
    const allStages: VideoFactoryStage[] = [
      'story',
      'images',
      'voice',
      'thumbnail',
      'clips',
      'review',
      'subtitles',
      'rendering',
      'export',
    ];

    const now = new Date().toISOString();
    const stages = allStages.reduce((acc, s) => {
      acc[s] = {
        stage: s,
        status: 'pending',
        attempt: 0,
        progress: 0,
        version: 1,
        lastUpdatedAt: now,
      };
      return acc;
    }, {} as Record<VideoFactoryStage, StageState>);

    return {
      projectId,
      mode,
      status: 'idle',
      currentStage: null,
      overallProgress: 0,
      stages,
      runId: `run_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      updatedAt: now,
    };
  }

  /**
   * Atomically saves the pipeline state to metadata/pipeline.json.
   */
  static async savePipelineState(projectId: string, state: VideoFactoryPipelineState): Promise<VideoFactoryPipelineState> {
    return await fileMutex.runExclusive(`pipeline:${projectId}`, async () => {
      const filePath = this.getPipelineStatePath(projectId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const toPersist: VideoFactoryPipelineState = {
        ...state,
        updatedAt: new Date().toISOString(),
      };

      const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(toPersist, null, 2), 'utf-8');

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          fs.renameSync(tmpPath, filePath);
          break;
        } catch (err: any) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
          } else {
            try {
              fs.copyFileSync(tmpPath, filePath);
              fs.unlinkSync(tmpPath);
              break;
            } catch {
              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              throw err;
            }
          }
        }
      }

      return toPersist;
    });
  }

  /**
   * Retrieves metadata/pipeline.json for a project, or null if not found.
   */
  static async getPipelineState(projectId: string): Promise<VideoFactoryPipelineState | null> {
    const filePath = this.getPipelineStatePath(projectId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as VideoFactoryPipelineState;
    } catch (err) {
      logger.error('story_repo', `Failed to read pipeline state for project ${projectId}`, err as Error);
      return null;
    }
  }
}
