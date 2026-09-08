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
import type {
  ProjectEntity,
  AppSettings,
  CreateProjectParams,
} from '../../shared/types';
import { ProjectRepository } from '../storage/ProjectRepository';
import { JobRepository } from '../storage/JobRepository';
import { AssetManager } from '../storage/AssetManager';
import { GenerationScheduler } from '../scheduler/GenerationScheduler';
import { ProfileSessionManager } from '../engine/ProfileSessionManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { getAppDataDir, AppLogger } from '../utils/AppLogger';

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
  private static settingsFilePath(): string {
    const configDir = path.join(getAppDataDir(), 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'settings.json');
  }

  static readSettings(): AppSettings {
    const filePath = this.settingsFilePath();
    const defaults: AppSettings = {
      appDataDir: getAppDataDir(),
      defaultImageRatio: '16:9',
      defaultProcessingOrder: 'images_first',
      maxRetries: 2,
      logLevel: 'INFO',
    };

    if (!fs.existsSync(filePath)) {
      return defaults;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { ...defaults, ...JSON.parse(content) };
    } catch {
      return defaults;
    }
  }

  static writeSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.readSettings();
    const updated = { ...current, ...patch };
    const filePath = this.settingsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  static register(ipcMain: IpcMainLike, deps: IpcDependencies): void {
    const { scheduler, sessionManager, getWebContents } = deps;

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
      await ProjectRepository.delete(projectId);
      return { success: true };
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

    ipcMain.handle('profiles:verifyAccount', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      return await sessionManager.verifyAccount(profileId);
    });

    ipcMain.handle('profiles:testConnection', async (_event, profileId: unknown) => {
      if (typeof profileId !== 'string') throw new Error('Invalid profileId');
      return await sessionManager.testConnection(profileId);
    });

    // -------------------------------------------------------------------------
    // Settings & System API
    // -------------------------------------------------------------------------
    ipcMain.handle('system:getAppInfo', async () => {
      return {
        appDataDir: getAppDataDir(),
        projectsRootDir: AssetManager.getProjectsRootDir(),
        version: '1.0.0',
        platform: process.platform,
      };
    });

    ipcMain.handle('settings:get', async () => {
      return this.readSettings();
    });

    ipcMain.handle('settings:update', async (_event, patch: unknown) => {
      return this.writeSettings(patch as Partial<AppSettings>);
    });

    // -------------------------------------------------------------------------
    // Event Forwarding to Renderer
    // -------------------------------------------------------------------------
    generationEventBus.onTyped('job:progress', (event) => {
      getWebContents?.()?.send('flow:job:progress', event);
    });

    generationEventBus.onTyped('slot:updated', (event) => {
      getWebContents?.()?.send('flow:slot:updated', event);
    });

    generationEventBus.onTyped('job:completed', (job) => {
      getWebContents?.()?.send('flow:job:completed', job);
    });

    generationEventBus.onTyped('job:failed', (job) => {
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

    logger.info('ipc', 'IPC handlers registered successfully');
  }
}
