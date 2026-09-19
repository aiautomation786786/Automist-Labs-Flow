/**
 * IpcHandlers – Typed IPC controller for Electron Main Process.
 *
 * Bridges React renderer requests to:
 *  - ProjectRepository (CRUD, immutable slots)
 *  - GenerationScheduler (start generation, cancel jobs)
 *  - JobRepository (job tracking)
 *  - ProfileSessionManager (profile lifecycle, Chrome launch)
 *  - GenerationEventBus (event forwarding to webContents)
 *
 * Security:
 *  - Zero filesystem handles exposed to renderer.
 *  - Zero Playwright/Browser objects serialized.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  ProjectEntity,
  AppSettings,
  CreateProjectParams,
  SeparateFilesInput,
  SystemMetrics,
} from '../../shared/types';
import { ProjectRepository } from '../storage/ProjectRepository';
import { JobRepository } from '../storage/JobRepository';
import { AssetManager } from '../storage/AssetManager';
import { GenerationScheduler } from '../scheduler/GenerationScheduler';
import { ProfileSessionManager } from '../engine/ProfileSessionManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { ZipService, type ExportMediaItem } from '../utils/ZipService';
import { getAppDataDir, AppLogger } from '../utils/AppLogger';
import { SettingsManager } from '../storage/SettingsManager';
import { StoryRepository } from '../storage/StoryRepository';
import { ScriptParser } from '../../shared/ScriptParser';
import { ScriptValidator } from '../../shared/ScriptValidator';
import { TtsManager } from '../tts/TtsManager';
import { RenderManager } from '../render/RenderManager';
import { FinalRenderManager } from '../render/FinalRenderManager';
import { TransitionService } from '../render/TransitionService';
import { ChannelRepository } from '../storage/ChannelRepository';
import { ChannelHistoryRepository } from '../storage/ChannelHistoryRepository';
import { ChannelDeliveryService } from '../channel/ChannelDeliveryService';
import { SkillRepository } from '../storage/SkillRepository';
import { ScriptAiService } from '../ai/ScriptAiService';
import { GeminiApiKeyManager } from '../ai/GeminiApiKeyManager';
import { VideoFactoryPipelineManager } from '../pipeline/VideoFactoryPipelineManager';
import type {
  VideoFactoryConfig,
  VideoFactoryStage,
  VideoFactoryDraft,
  StoryEntity,
  TtsProviderId,
  CreateChannelParams,
  ChannelHistoryQuery,
  CreateSkillParams,
  UpdateSkillParams,
  ScriptAiGenerateParams,
  RefineSceneParams,
  AnalyzeAlignParams,
} from '../../shared/types';

const logger = new AppLogger({ mirrorToStderr: false });

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown): void;
}

export interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void;
}

export interface IpcDependencies {
  scheduler: GenerationScheduler;
  sessionManager: ProfileSessionManager;
  getWebContents?: () => WebContentsLike | null;
}

export class IpcHandlers {
  static readSettings(): AppSettings {
    return SettingsManager.getSanitizedSettings();
  }

  static async writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return await SettingsManager.updateSettings(patch);
  }

  static register(ipcMain: IpcMainLike, deps: IpcDependencies): void {
    const { scheduler, sessionManager, getWebContents } = deps;
    VideoFactoryPipelineManager.setScheduler(scheduler);
    GeminiApiKeyManager.getInstance().initialize().catch((err) => {
      logger.warn('ipc', 'Failed to initialize GeminiApiKeyManager', { error: err.message });
    });

    // -------------------------------------------------------------------------
    // Projects API
    // -------------------------------------------------------------------------
    ipcMain.handle('projects:list', async () => {
      return await ProjectRepository.getAll();
    });

    ipcMain.handle('projects:get', async (_event, projectId: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      return await ProjectRepository.get(projectId);
    });

    ipcMain.handle('projects:create', async (_event, params: unknown) => {
      return await ProjectRepository.create(params as CreateProjectParams);
    });

    ipcMain.handle('projects:update', async (_event, projectId: unknown, patch: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      return await ProjectRepository.update(
        projectId,
        patch as Partial<Omit<ProjectEntity, 'projectId' | 'createdAt' | 'slots'>>
      );
    });

    ipcMain.handle('projects:delete', async (_event, projectId: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      // Safely cancel any active or queued jobs first
      if (scheduler && typeof (scheduler as any).cancelProject === 'function') {
        await (scheduler as any).cancelProject(projectId).catch(() => {});
      }
      await ProjectRepository.delete(projectId);
      return { success: true };
    });

    ipcMain.handle('projects:deleteMultiple', async (_event, projectIds: unknown) => {
      if (!Array.isArray(projectIds)) throw new Error('Invalid projectIds array');
      let deletedCount = 0;
      for (const id of projectIds) {
        if (typeof id === 'string') {
          if (scheduler && typeof (scheduler as any).cancelProject === 'function') {
            await (scheduler as any).cancelProject(id).catch(() => {});
          }
          await ProjectRepository.delete(id).catch(() => {});
          deletedCount++;
        }
      }
      return { success: true, deletedCount };
    });

    ipcMain.handle('projects:exportZip', async (_event, params: unknown) => {
      const p = params as { projectId: string; slotIndices?: number[] };
      if (!p || !p.projectId) throw new Error('projectId required');
      const project = await ProjectRepository.get(p.projectId);
      if (!project) throw new Error(`Project ${p.projectId} not found`);

      const slotsToExport = p.slotIndices && p.slotIndices.length > 0
        ? project.slots.filter((s) => p.slotIndices!.includes(s.slotIndex) && s.status === 'completed' && s.result?.mediaPath)
        : project.slots.filter((s) => s.status === 'completed' && s.result?.mediaPath);

      if (slotsToExport.length === 0) {
        throw new Error('No completed media found to export.');
      }

      const mediaItems: ExportMediaItem[] = slotsToExport.map((s) => ({
        slotIndex: s.slotIndex,
        mediaPath: s.result!.mediaPath,
        type: s.type,
      }));

      // Default export location
      const electron = require('electron');
      const app = electron?.app;
      const downloadsDir = app?.getPath ? app.getPath('downloads') : getAppDataDir();
      const safeProjectName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const defaultZipName = `${safeProjectName}_media.zip`;

      let targetZipPath = path.join(downloadsDir, defaultZipName);
      if (electron?.dialog?.showSaveDialog) {
        const saveRes = await electron.dialog.showSaveDialog({
          title: 'Export Ordered Media ZIP',
          defaultPath: targetZipPath,
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
        if (saveRes.canceled || !saveRes.filePath) {
          return { canceled: true };
        }
        targetZipPath = saveRes.filePath;
      }

      const res = await ZipService.createOrderedZip(mediaItems, targetZipPath);
      return { success: true, zipPath: res.zipPath, fileCount: res.fileCount };
    });

    ipcMain.handle('projects:downloadSelected', async (_event, params: unknown) => {
      const p = params as { projectId: string; slotIndices: number[]; destinationDir: string };
      if (!p || !p.projectId || !p.destinationDir || !Array.isArray(p.slotIndices)) {
        throw new Error('Invalid downloadSelected parameters');
      }

      const project = await ProjectRepository.get(p.projectId);
      if (!project) throw new Error(`Project ${p.projectId} not found`);

      const slots = project.slots.filter(
        (s) => p.slotIndices.includes(s.slotIndex) && s.status === 'completed' && s.result?.mediaPath
      );

      await fs.promises.mkdir(p.destinationDir, { recursive: true });
      let copiedCount = 0;
      const copyConcurrency = 8;
      const copyTasks: Array<() => Promise<void>> = [];

      for (const slot of slots) {
        if (fs.existsSync(slot.result!.mediaPath)) {
          const ext = path.extname(slot.result!.mediaPath) || (slot.type === 'video' ? '.mp4' : '.jpg');
          const serial = String(slot.slotIndex + 1).padStart(2, '0');
          const destName = `${serial}_${slot.type}${ext}`;
          const destPath = path.join(p.destinationDir, destName);
          copyTasks.push(async () => {
            await fs.promises.copyFile(slot.result!.mediaPath, destPath);
            copiedCount++;
          });
        }
      }

      for (let i = 0; i < copyTasks.length; i += copyConcurrency) {
        await Promise.all(copyTasks.slice(i, i + copyConcurrency).map((task) => task()));
      }

      return { success: true, count: copiedCount, destinationDir: p.destinationDir };
    });

    // -------------------------------------------------------------------------
    // Generation & Jobs API
    // -------------------------------------------------------------------------
    ipcMain.handle('projects:start', async (_event, projectId: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      return await scheduler.enqueueProject(projectId);
    });

    ipcMain.handle('projects:cancelJob', async (_event, projectId: unknown, jobId: unknown) => {
      if (typeof projectId !== 'string' || typeof jobId !== 'string') {
        throw new Error('Invalid arguments for cancelJob');
      }
      await scheduler.cancelJob(projectId, jobId);
      return { success: true };
    });

    ipcMain.handle('projects:getJobs', async (_event, projectId: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      return await JobRepository.getJobsByProject(projectId);
    });

    ipcMain.handle('projects:retrySlot', async (_event, projectId: unknown, slotIndex: unknown) => {
      if (typeof projectId !== 'string' || typeof slotIndex !== 'number') {
        throw new Error('Invalid arguments for retrySlot');
      }
      return await scheduler.retrySlot(projectId, slotIndex);
    });

    ipcMain.handle('scheduler:metrics', async () => {
      return await scheduler.getCapacityMetrics();
    });

    // -------------------------------------------------------------------------
    // Profiles API
    // -------------------------------------------------------------------------
    ipcMain.handle('profiles:list', async () => {
      return sessionManager.getAllProfiles();
    });

    ipcMain.handle('profiles:create', async (_event, params: unknown) => {
      const p = params as { displayName: string; expectedEmail?: string; notes?: string };
      if (!p || !p.displayName?.trim()) {
        throw new Error('Profile display name is required.');
      }
      return await sessionManager.createProfile({
        displayName: p.displayName.trim(),
        expectedEmail: p.expectedEmail?.trim() || undefined,
        notes: p.notes?.trim() || undefined,
        autoStart: false,
      });
    });

    ipcMain.handle('profiles:start', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      await sessionManager.startProfile(profileId);
      const session = sessionManager.getSession(profileId);
      return session ? session.getSnapshot() : null;
    });

    ipcMain.handle('profiles:stop', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      await sessionManager.stopProfile(profileId);
      return { success: true };
    });

    ipcMain.handle('profiles:delete', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      await sessionManager.deleteProfile(profileId);
      return { success: true };
    });

    ipcMain.handle('profiles:openChrome', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      // Starts or ensures visible Chrome window for manual user sign-in
      await sessionManager.startProfile(profileId, false);
      const session = sessionManager.getSession(profileId);
      return {
        success: true,
        message: `Chrome window opened for ${session?.profileId ?? profileId}. Sign in to Google Flow manually.`,
      };
    });

    ipcMain.handle('profiles:openSignIn', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      const snapshot = await sessionManager.openSignIn(profileId);
      return {
        success: true,
        message: `Sign-in window ready for profile ${snapshot.displayName}. Sign in to Google Flow manually.`,
      };
    });

    ipcMain.handle('profiles:openFlow', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      const snapshot = await sessionManager.openFlow(profileId);
      return {
        success: true,
        message: `Google Flow is active for profile ${snapshot.displayName}.`,
        snapshot,
      };
    });

    ipcMain.handle('profiles:launchLoginBrowser', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      // Fast path: spawns Chrome visibly, returns when PID confirmed.
      // Does NOT wait for CDP or auth detection.
      return await sessionManager.launchLoginBrowser(profileId);
    });

    ipcMain.handle('profiles:verifyAccount', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      return await sessionManager.verifyAccount(profileId);
    });

    ipcMain.handle('profiles:testConnection', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      return await sessionManager.testConnection(profileId);
    });

    ipcMain.handle('profiles:detectLocalChrome', async () => {
      return await sessionManager.detectLocalChromeProfiles();
    });

    ipcMain.handle('profiles:detectState', async (_event, target: unknown) => {
      return await sessionManager.detectExistingProfileState(
        target as { userDataDir?: string; profileDirectory?: string; email?: string; displayName?: string; preferredCdpPort?: number }
      );
    });

    ipcMain.handle('profiles:createExisting', async (_event, params: unknown) => {
      const p = params as {
        displayName: string;
        localProfileDirectory: string;
        localUserDataDir?: string;
        expectedEmail?: string;
        notes?: string;
        preferredCdpPort?: number;
      };
      if (!p || !p.displayName?.trim() || !p.localProfileDirectory?.trim()) {
        throw new Error('Display name and local profile directory are required.');
      }
      return await sessionManager.createExistingChromeProfile(p);
    });

    // -------------------------------------------------------------------------
    // Settings & System API
    // -------------------------------------------------------------------------
    ipcMain.handle('system:getAppInfo', async () => {
      let appVersion = '1.0.0';
      try {
        const electron = require('electron');
        if (electron?.app?.getVersion) {
          appVersion = electron.app.getVersion();
        }
      } catch {
        /* fallback to 1.0.0 */
      }

      return {
        appDataDir: getAppDataDir(),
        projectsRootDir: AssetManager.getProjectsRootDir(),
        version: appVersion,
        platform: process.platform,
      };
    });

    ipcMain.handle('settings:get', async () => {
      return this.readSettings();
    });

    ipcMain.handle('settings:update', async (_event, patch: unknown) => {
      return await this.writeSettings(patch as Partial<AppSettings>);
    });

    // -------------------------------------------------------------------------
    // Video Factory API (ZBot Integration)
    // -------------------------------------------------------------------------
    ipcMain.handle('factory:getDraft', async () => {
      return await StoryRepository.getDraft();
    });

    ipcMain.handle('factory:saveDraft', async (_event, draft: unknown) => {
      return await StoryRepository.saveDraft(draft as Partial<VideoFactoryDraft>);
    });

    ipcMain.handle('factory:parseScript', async (_event, rawText: unknown) => {
      if (typeof rawText !== 'string') throw new Error('Invalid script input: expected string.');
      return ScriptParser.parse(rawText);
    });

    ipcMain.handle('factory:createProject', async (_event, configRaw: unknown) => {
      const config = configRaw as VideoFactoryConfig;
      if (!config || !config.story || !Array.isArray(config.story.scenes) || config.story.scenes.length === 0) {
        throw new Error('Cannot create Video Factory project without scenes.');
      }

      const projectName = config.story.title?.trim() || `Faceless Video · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      // Create official Infinity Flow ProjectEntity with immutable slots mapping 1-to-1 with scenes
      const project = await ProjectRepository.create({
        name: projectName,
        channelId: config.channelId,
        channelName: config.channelName,
        imageRatio: config.aspectRatio || '16:9',
        videoRatio: config.aspectRatio || '16:9',
        generationMode: config.mode === 'images_only' ? 'bulk_image' : 'bulk_video',
        prompts: config.story.scenes.map((scene) => ({
          text: scene.imagePrompt,
          type: 'image',
          narration: scene.narration,
          mood: scene.mood,
        })),
      });

      if (config.channelId) {
        try {
          const allProjects = await ProjectRepository.getAll();
          const channelCount = allProjects.filter((p) => p.channelId === config.channelId).length;
          await ChannelRepository.updateStats(config.channelId, { totalProjects: channelCount });
        } catch (chErr) {
          logger.warn('ipc', 'Failed to update channel stats on project creation', { error: (chErr as Error).message });
        }
      }

      // Save story.json and factory_config.json in the project folder
      await StoryRepository.saveStory(project.projectId, config.story);
      await StoryRepository.saveConfig(project.projectId, {
        ...config,
        stage: 'assets_queued',
      });

      // Initialize persistent pipeline state for Phase 2 unified pipeline
      const pipelineMode = config.mode || 'full_video';
      const initialPipeline = StoryRepository.initializePipelineState(project.projectId, pipelineMode);
      await StoryRepository.savePipelineState(project.projectId, initialPipeline);

      logger.info('ipc', `Created Video Factory project ${project.projectId} with ${project.slots.length} scene slots`);

      return { projectId: project.projectId, project };
    });

    ipcMain.handle('factory:getStory', async (_event, projectId: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      return await StoryRepository.getStory(projectId);
    });

    ipcMain.handle('factory:validateStory', async (_event, storyRaw: unknown) => {
      return ScriptValidator.validate((storyRaw || {}) as Partial<StoryEntity>);
    });

    ipcMain.handle('factory:updateStory', async (_event, projectId: unknown, storyRaw: unknown) => {
      if (typeof projectId !== 'string') throw new Error('Invalid projectId');
      const updated = await StoryRepository.updateStory(projectId, storyRaw as StoryEntity);
      return { success: true, story: updated };
    });

    ipcMain.handle('factory:getTtsEngines', async () => {
      return await TtsManager.getEnginesMetadata();
    });

    ipcMain.handle('factory:listVoices', async (_event, providerRaw?: unknown) => {
      const provider = typeof providerRaw === 'string' ? (providerRaw as TtsProviderId) : undefined;
      return await TtsManager.listAllVoices(provider);
    });

    ipcMain.handle('factory:previewVoice', async (_event, providerRaw: unknown, voiceIdRaw: unknown, sampleTextRaw: unknown) => {
      const provider = (typeof providerRaw === 'string' ? providerRaw : 'edge-tts') as TtsProviderId;
      const voiceId = typeof voiceIdRaw === 'string' ? voiceIdRaw : '';
      const sampleText = typeof sampleTextRaw === 'string' ? sampleTextRaw : undefined;
      return await TtsManager.previewVoice(provider, voiceId, sampleText);
    });

    ipcMain.handle('factory:synthesizeVoice', async (_event, projectIdRaw: unknown, voiceIdRaw: unknown, providerRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for synthesizeVoice');
      const voiceId = typeof voiceIdRaw === 'string' ? voiceIdRaw : undefined;
      const provider = (typeof providerRaw === 'string' ? providerRaw : 'edge-tts') as TtsProviderId;
      return await TtsManager.synthesizeProjectNarration(projectIdRaw, { provider, voiceId });
    });

    ipcMain.handle('factory:combineAudio', async (_event, projectIdRaw: unknown, outputFilenameRaw?: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for combineAudio');
      const outputFilename = typeof outputFilenameRaw === 'string' && outputFilenameRaw.trim() ? outputFilenameRaw.trim() : 'final_audio.mp3';
      return await TtsManager.combineProjectAudio(projectIdRaw, outputFilename);
    });

    ipcMain.handle('factory:testTtsConnection', async (_event, providerRaw: unknown) => {
      const providerId = (typeof providerRaw === 'string' ? providerRaw : 'edge-tts') as TtsProviderId;
      const provider = TtsManager.getProvider(providerId);
      if (typeof provider.testConnection === 'function') {
        return await provider.testConnection();
      }
      const isAvail = await provider.isAvailable();
      return {
        success: isAvail,
        message: isAvail ? `${provider.name} is operational.` : (provider.getUnavailableReason() || 'Provider unavailable.'),
      };
    });

    ipcMain.handle('factory:getAudioManifest', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for getAudioManifest');
      return await TtsManager.getAudioManifest(projectIdRaw);
    });

    ipcMain.handle('factory:renderScene', async (_event, projectIdRaw: unknown, sceneNumberRaw: unknown, optionsRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for renderScene');
      const sceneNumber = Number(sceneNumberRaw) || 1;
      return await RenderManager.renderSingleScene(projectIdRaw, sceneNumber, optionsRaw as any);
    });

    ipcMain.handle('factory:renderProjectClips', async (_event, projectIdRaw: unknown, optionsRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for renderProjectClips');
      return await RenderManager.renderProjectClips(projectIdRaw, optionsRaw as any);
    });

    ipcMain.handle('factory:cancelProjectRender', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for cancelProjectRender');
      const success = RenderManager.cancelProjectRender(projectIdRaw);
      return { success };
    });

    ipcMain.handle('factory:getRenderManifest', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for getRenderManifest');
      return await RenderManager.getRenderManifest(projectIdRaw);
    });

    ipcMain.handle('factory:testTransition', async (_event, paramsRaw: unknown) => {
      return await TransitionService.renderTransitionPreview(paramsRaw as any);
    });

    ipcMain.handle('factory:assembleFinalVideo', async (_event, projectIdRaw: unknown, optionsRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for assembleFinalVideo');
      return await FinalRenderManager.assembleFinalVideo(projectIdRaw, optionsRaw as any);
    });

    ipcMain.handle('factory:cancelFinalRender', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for cancelFinalRender');
      const success = FinalRenderManager.cancelFinalRender(projectIdRaw);
      return { success };
    });

    ipcMain.handle('factory:getFinalRenderManifest', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for getFinalRenderManifest');
      return await StoryRepository.getFinalRenderManifest(projectIdRaw);
    });

    // =========================================================================
    // Unified Video Factory Pipeline (Phase 2)
    // =========================================================================

    ipcMain.handle('pipeline:start', async (_event, projectIdRaw: unknown, modeRaw?: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for pipeline:start');
      const mode = typeof modeRaw === 'string' ? (modeRaw as any) : undefined;
      return await VideoFactoryPipelineManager.startPipeline(projectIdRaw, mode);
    });

    ipcMain.handle('pipeline:pause', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for pipeline:pause');
      return await VideoFactoryPipelineManager.pausePipeline(projectIdRaw);
    });

    ipcMain.handle('pipeline:resume', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for pipeline:resume');
      return await VideoFactoryPipelineManager.resumePipeline(projectIdRaw);
    });

    ipcMain.handle('pipeline:cancel', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for pipeline:cancel');
      return await VideoFactoryPipelineManager.cancelPipeline(projectIdRaw);
    });

    ipcMain.handle('pipeline:retryStage', async (_event, projectIdRaw: unknown, stageRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for pipeline:retryStage');
      if (typeof stageRaw !== 'string' || !stageRaw) throw new Error('Invalid stage for pipeline:retryStage');
      return await VideoFactoryPipelineManager.retryStage(projectIdRaw, stageRaw as VideoFactoryStage);
    });

    ipcMain.handle('pipeline:getState', async (_event, projectIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId for pipeline:getState');
      return await VideoFactoryPipelineManager.getPipelineState(projectIdRaw);
    });

    // =========================================================================
    // Channels & Channel Management (Phase 7)
    // =========================================================================

    ipcMain.handle('channels:list', async () => {
      return await ChannelRepository.getAll();
    });

    ipcMain.handle('channels:get', async (_event, channelIdRaw: unknown) => {
      if (typeof channelIdRaw !== 'string' || !channelIdRaw) throw new Error('Invalid channelId');
      return await ChannelRepository.get(channelIdRaw);
    });

    ipcMain.handle('channels:create', async (_event, paramsRaw: unknown) => {
      return await ChannelRepository.create(paramsRaw as CreateChannelParams);
    });

    ipcMain.handle('channels:update', async (_event, channelIdRaw: unknown, patchRaw: unknown) => {
      if (typeof channelIdRaw !== 'string' || !channelIdRaw) throw new Error('Invalid channelId');
      return await ChannelRepository.update(channelIdRaw, patchRaw as any);
    });

    ipcMain.handle('channels:delete', async (_event, channelIdRaw: unknown) => {
      if (typeof channelIdRaw !== 'string' || !channelIdRaw) throw new Error('Invalid channelId');
      return await ChannelRepository.delete(channelIdRaw);
    });

    ipcMain.handle('channels:assignProject', async (_event, projectIdRaw: unknown, channelIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId');
      const channelId = typeof channelIdRaw === 'string' && channelIdRaw ? channelIdRaw : undefined;

      let channelName: string | undefined;
      if (channelId) {
        const ch = await ChannelRepository.get(channelId);
        if (!ch) throw new Error(`Channel ${channelId} not found`);
        channelName = ch.name;
      }

      const updatedProject = await ProjectRepository.update(projectIdRaw, {
        channelId,
        channelName,
      });

      // Update channel totalProjects stat if channelId provided
      if (channelId) {
        const allProjects = await ProjectRepository.getAll();
        const count = allProjects.filter((p) => p.channelId === channelId).length;
        await ChannelRepository.updateStats(channelId, { totalProjects: count });
      }

      return updatedProject;
    });

    ipcMain.handle('channels:deliverProject', async (_event, projectIdRaw: unknown, channelIdRaw: unknown) => {
      if (typeof projectIdRaw !== 'string' || !projectIdRaw) throw new Error('Invalid projectId');
      const channelId = typeof channelIdRaw === 'string' && channelIdRaw ? channelIdRaw : undefined;
      return await ChannelDeliveryService.deliverProject(projectIdRaw, channelId);
    });

    ipcMain.handle('channels:getHistory', async (_event, queryRaw: unknown) => {
      return await ChannelHistoryRepository.query(queryRaw as ChannelHistoryQuery);
    });

    ipcMain.handle('channels:retryDelivery', async (_event, deliveryIdRaw: unknown) => {
      if (typeof deliveryIdRaw !== 'string' || !deliveryIdRaw) throw new Error('Invalid deliveryId');
      return await ChannelDeliveryService.retryDelivery(deliveryIdRaw);
    });

    // -----------------------------------------------------------------------
    // Skills & Script AI Handlers (Phase 8)
    // -----------------------------------------------------------------------

    ipcMain.handle('skills:list', async () => {
      return await SkillRepository.getAll();
    });

    ipcMain.handle('skills:get', async (_event, skillIdRaw: unknown) => {
      if (typeof skillIdRaw !== 'string' || !skillIdRaw) throw new Error('Invalid skillId');
      return await SkillRepository.get(skillIdRaw);
    });

    ipcMain.handle('skills:create', async (_event, paramsRaw: unknown) => {
      return await SkillRepository.create(paramsRaw as CreateSkillParams);
    });

    ipcMain.handle('skills:update', async (_event, skillIdRaw: unknown, patchRaw: unknown) => {
      if (typeof skillIdRaw !== 'string' || !skillIdRaw) throw new Error('Invalid skillId');
      return await SkillRepository.update(skillIdRaw, patchRaw as UpdateSkillParams);
    });

    ipcMain.handle('skills:delete', async (_event, skillIdRaw: unknown) => {
      if (typeof skillIdRaw !== 'string' || !skillIdRaw) throw new Error('Invalid skillId');
      const deleted = await SkillRepository.delete(skillIdRaw);
      return { success: deleted };
    });

    ipcMain.handle('skills:import', async (_event, contentRaw: unknown, fileNameRaw: unknown) => {
      let content: string | Buffer;
      if (typeof contentRaw === 'string') {
        content = contentRaw;
      } else if (Buffer.isBuffer(contentRaw)) {
        content = contentRaw;
      } else if (contentRaw instanceof Uint8Array || (contentRaw && (contentRaw as any).byteLength !== undefined)) {
        content = Buffer.from(contentRaw as any);
      } else {
        throw new Error('Invalid skill content');
      }
      const fileName = typeof fileNameRaw === 'string' ? fileNameRaw : undefined;
      return await SkillRepository.importSkill(content, fileName);
    });

    ipcMain.handle('scriptAi:generate', async (_event, paramsRaw: unknown) => {
      return await ScriptAiService.generateScript(paramsRaw as ScriptAiGenerateParams);
    });

    ipcMain.handle('scriptAi:refineScene', async (_event, paramsRaw: unknown) => {
      return await ScriptAiService.refineScene(paramsRaw as RefineSceneParams);
    });

    ipcMain.handle('scriptAi:reReadScript', async (_event, paramsRaw: unknown) => {
      return await ScriptAiService.reReadScript(paramsRaw as AnalyzeAlignParams);
    });

    ipcMain.handle('scriptAi:testConnection', async () => {
      return await ScriptAiService.testConnection();
    });

    ipcMain.handle('geminiKeys:list', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.initialize();
      return manager.listKeys();
    });

    ipcMain.handle('geminiKeys:add', async (_event, keyRaw: unknown) => {
      if (typeof keyRaw !== 'string') throw new Error('Invalid API key input');
      const manager = GeminiApiKeyManager.getInstance();
      await manager.initialize();
      const res = await manager.addKey(keyRaw);
      return { ...res, keys: manager.listKeys() };
    });

    ipcMain.handle('geminiKeys:remove', async (_event, idRaw: unknown) => {
      if (typeof idRaw !== 'string') throw new Error('Invalid key ID');
      const manager = GeminiApiKeyManager.getInstance();
      await manager.initialize();
      const res = await manager.removeKey(idRaw);
      return { ...res, keys: manager.listKeys() };
    });

    ipcMain.handle('geminiKeys:reveal', async (_event, idRaw: unknown) => {
      if (typeof idRaw !== 'string') throw new Error('Invalid key ID');
      const manager = GeminiApiKeyManager.getInstance();
      await manager.initialize();
      const key = manager.revealKey(idRaw);
      return { success: Boolean(key), fullKey: key || undefined };
    });

    ipcMain.handle('script:parseSeparateFiles', async (_event, inputRaw: unknown) => {
      return ScriptParser.parseSeparateFiles(inputRaw as SeparateFilesInput);
    });

    ipcMain.handle('system:getSystemMetrics', async (): Promise<SystemMetrics> => {
      const cpus = os.cpus();
      let cpuPercent = 0;
      if (cpus && cpus.length > 0) {
        let totalTick = 0;
        let totalIdle = 0;
        for (const cpu of cpus) {
          for (const type in cpu.times) {
            totalTick += (cpu.times as any)[type];
          }
          totalIdle += cpu.times.idle;
        }
        const idleRatio = totalTick > 0 ? totalIdle / totalTick : 1;
        cpuPercent = Math.max(0, Math.min(100, Math.round((1 - idleRatio) * 100)));
      }

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = Math.max(0, totalMem - freeMem);
      const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
      const freeMemMb = Math.round(freeMem / (1024 * 1024));
      const totalMemMb = Math.round(totalMem / (1024 * 1024));

      return {
        cpuPercent,
        freeMemMb,
        totalMemMb,
        memPercent,
        pingMs: 20, // baseline local roundtrip estimate
        timestamp: new Date().toISOString(),
      };
    });

    ipcMain.handle('system:selectOutputDir', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Destination Output Folder',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open output directory dialog', { error: (err as Error).message });
      }
      return null;
    });

    ipcMain.handle('system:revealAsset', async (_event, mediaPath: unknown) => {
      if (typeof mediaPath !== 'string') throw new Error('Invalid mediaPath');
      try {
        const electron = require('electron');
        if (electron?.shell?.showItemInFolder) {
          electron.shell.showItemInFolder(mediaPath);
          return true;
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to reveal asset via shell', { error: (err as Error).message });
      }
      return false;
    });

    ipcMain.handle('system:selectImageFile', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Source Image for Video',
            properties: ['openFile'],
            filters: [
              { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
            ],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open image file dialog', { error: (err as Error).message });
      }
      return null;
    });

    ipcMain.handle('system:selectMultipleImageFiles', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Source Images for Bulk Video',
            properties: ['openFile', 'multiSelections'],
            filters: [
              { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
            ],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths;
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open multiple images file dialog', { error: (err as Error).message });
      }
      return [];
    });

    ipcMain.handle('system:selectZipFile', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Images ZIP Archive',
            properties: ['openFile'],
            filters: [
              { name: 'ZIP Archive', extensions: ['zip'] },
            ],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open ZIP dialog', { error: (err as Error).message });
      }
      return null;
    });

    ipcMain.handle('system:selectMusicFile', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Background Music Track',
            properties: ['openFile'],
            filters: [
              { name: 'Audio Files (*.mp3, *.wav, *.m4a, *.aac, *.flac, *.ogg)', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] },
            ],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open music file dialog', { error: (err as Error).message });
      }
      return null;
    });

    ipcMain.handle('system:selectScriptFile', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Video Script File',
            properties: ['openFile'],
            filters: [
              { name: 'Script Files (*.md, *.txt, *.json)', extensions: ['md', 'txt', 'json'] },
              { name: 'All Files (*.*)', extensions: ['*'] },
            ],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const content = fs.readFileSync(filePath, 'utf-8');
            return {
              filePath,
              fileName: path.basename(filePath),
              content,
            };
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open script file dialog', { error: (err as Error).message });
      }
      return null;
    });

    ipcMain.handle('system:extractImageZip', async (_event, zipPath: unknown) => {
      if (typeof zipPath !== 'string') throw new Error('Invalid zipPath');
      return await ZipService.extractImageZip(zipPath);
    });

    ipcMain.handle('system:selectDirectory', async () => {
      try {
        const electron = require('electron');
        if (electron?.dialog?.showOpenDialog) {
          const result = await electron.dialog.showOpenDialog({
            title: 'Select Destination Folder',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
          }
        }
      } catch (err) {
        logger.warn('ipc', 'Failed to open directory dialog', { error: (err as Error).message });
      }
      return null;
    });

    // -------------------------------------------------------------------------
    // Event Forwarding to Renderer with Per-Job Progress Coalescing
    // -------------------------------------------------------------------------
    const progressBuffer = new Map<string, any>();
    let flushTimer: NodeJS.Timeout | null = null;

    const flushProgress = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (progressBuffer.size === 0) return;
      const webContents = getWebContents?.();
      if (!webContents) return;

      const events = Array.from(progressBuffer.values());
      progressBuffer.clear();
      for (const ev of events) {
        webContents.send('flow:job:progress', ev);
      }
    };

    generationEventBus.onTyped('job:progress', (event) => {
      progressBuffer.set(event.jobId, event);
      if (process.env.NODE_ENV === 'test') {
        flushProgress();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flushProgress, 60);
      }
    });

    generationEventBus.onTyped('slot:updated', (event) => {
      flushProgress();
      getWebContents?.()?.send('flow:slot:updated', event);
    });

    generationEventBus.onTyped('job:completed', (job) => {
      progressBuffer.delete(job.jobId);
      flushProgress();
      getWebContents?.()?.send('flow:job:completed', job);
    });

    generationEventBus.onTyped('job:failed', (job) => {
      progressBuffer.delete(job.jobId);
      flushProgress();
      getWebContents?.()?.send('flow:job:failed', job);
    });

    generationEventBus.onTyped('worker:busy', (profileId, jobId) => {
      getWebContents?.()?.send('flow:worker:status', {
        profileId,
        status: 'busy',
        activeJobId: jobId,
      });
    });

    generationEventBus.onTyped('worker:available', (profileId) => {
      getWebContents?.()?.send('flow:worker:status', {
        profileId,
        status: 'ready',
      });
    });

    generationEventBus.on('render:progress' as any, (event: any) => {
      getWebContents?.()?.send('flow:render:progress', event);
    });

    generationEventBus.on('final-render:progress' as any, (event: any) => {
      getWebContents?.()?.send('flow:final-render:progress', event);
    });

    generationEventBus.on('script-ai:progress' as any, (event: any) => {
      getWebContents?.()?.send('flow:script-ai:progress', event);
    });

    generationEventBus.on('pipeline:progress' as any, (event: any) => {
      getWebContents?.()?.send('flow:pipeline:progress', event);
    });

    if (typeof (sessionManager as any)?.on === 'function') {
      (sessionManager as any).on('session:status', (snapshot: any) => {
        getWebContents?.()?.send('flow:worker:status', {
          profileId: snapshot.profileId,
          status: snapshot.status,
        });
      });
    }

    logger.info('ipc', 'IPC handlers registered successfully');
  }
}
