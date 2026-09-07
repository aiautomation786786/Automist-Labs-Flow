/**
 * Electron Preload Script.
 *
 * Exposes a strictly typed, secure API to the React renderer via contextBridge.
 *
 * Security:
 *  - contextIsolation: true
 *  - nodeIntegration: false
 *  - No arbitrary ipcRenderer access exposed.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  FlowApi,
  ProjectEntity,
  GenerationJobEntity,
  ProfileSessionSnapshot,
  ProfileConfig,
  AppSettings,
  CreateProjectParams,
  JobProgressEvent,
  SlotUpdatedEvent,
} from '../shared/types';

const flowApi: FlowApi = {
  // Projects
  listProjects: (): Promise<ProjectEntity[]> => ipcRenderer.invoke('projects:list'),
  getProject: (projectId: string): Promise<ProjectEntity | null> =>
    ipcRenderer.invoke('projects:get', projectId),
  createProject: (params: CreateProjectParams): Promise<ProjectEntity> =>
    ipcRenderer.invoke('projects:create', params),
  updateProject: (projectId: string, patch: Partial<Omit<ProjectEntity, 'projectId' | 'createdAt' | 'slots'>>) =>
    ipcRenderer.invoke('projects:update', projectId, patch),
  deleteProject: (projectId: string): Promise<void> => ipcRenderer.invoke('projects:delete', projectId),

  // Generation
  startProjectGeneration: (projectId: string): Promise<GenerationJobEntity[]> =>
    ipcRenderer.invoke('projects:start', projectId),
  cancelJob: (projectId: string, jobId: string): Promise<void> =>
    ipcRenderer.invoke('projects:cancelJob', projectId, jobId),
  getProjectJobs: (projectId: string): Promise<GenerationJobEntity[]> =>
    ipcRenderer.invoke('projects:getJobs', projectId),

  // Profiles
  listProfiles: (): Promise<ProfileSessionSnapshot[]> => ipcRenderer.invoke('profiles:list'),
  createProfile: (params: { displayName: string }): Promise<ProfileConfig> =>
    ipcRenderer.invoke('profiles:create', params),
  startProfile: (profileId: string): Promise<ProfileSessionSnapshot | null> =>
    ipcRenderer.invoke('profiles:start', profileId),
  stopProfile: (profileId: string): Promise<void> => ipcRenderer.invoke('profiles:stop', profileId),
  deleteProfile: (profileId: string): Promise<void> => ipcRenderer.invoke('profiles:delete', profileId),
  openChrome: (profileId: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('profiles:openChrome', profileId),

  // Settings & System
  getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  // Events
  onJobProgress: (callback: (event: JobProgressEvent) => void) => {
    const handler = (_e: unknown, data: JobProgressEvent) => callback(data);
    ipcRenderer.on('flow:job:progress', handler);
    return () => ipcRenderer.removeListener('flow:job:progress', handler);
  },

  onSlotUpdated: (callback: (event: SlotUpdatedEvent) => void) => {
    const handler = (_e: unknown, data: SlotUpdatedEvent) => callback(data);
    ipcRenderer.on('flow:slot:updated', handler);
    return () => ipcRenderer.removeListener('flow:slot:updated', handler);
  },

  onJobCompleted: (callback: (job: GenerationJobEntity) => void) => {
    const handler = (_e: unknown, data: GenerationJobEntity) => callback(data);
    ipcRenderer.on('flow:job:completed', handler);
    return () => ipcRenderer.removeListener('flow:job:completed', handler);
  },

  onJobFailed: (callback: (job: GenerationJobEntity) => void) => {
    const handler = (_e: unknown, data: GenerationJobEntity) => callback(data);
    ipcRenderer.on('flow:job:failed', handler);
    return () => ipcRenderer.removeListener('flow:job:failed', handler);
  },

  onWorkerStatus: (callback: (data: { profileId: string; status: string; activeJobId?: string }) => void) => {
    const handler = (_e: unknown, data: { profileId: string; status: string; activeJobId?: string }) =>
      callback(data);
    ipcRenderer.on('flow:worker:status', handler);
    return () => ipcRenderer.removeListener('flow:worker:status', handler);
  },
};

contextBridge.exposeInMainWorld('flowApi', flowApi);
