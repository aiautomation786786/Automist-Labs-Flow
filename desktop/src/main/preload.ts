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
  ProfileSessionStatus,
  ProfileConfig,
  AppSettings,
  CreateProjectParams,
  JobProgressEvent,
  SlotUpdatedEvent,
  SchedulerCapacityMetrics,
  VideoFactoryConfig,
  VideoFactoryDraft,
  ScriptParseResult,
  StoryEntity,
  StoryValidationResult,
  VideoFactoryPipelineState,
  VideoFactoryStage,
  VideoFactoryMode,
  PipelineProgressEvent,
  TtsProviderId,
  TtsEngineMetadata,
  VoiceInfo,
  TtsAudioManifest,
  MotionStyle,
  TransitionStyle,
  RenderSceneResult,
  RenderManifest,
  RenderProgressEvent,
  FinalAssemblyOptions,
  FinalRenderManifest,
  FinalRenderProgressEvent,
  ChannelEntity,
  CreateChannelParams,
  DeliveryHistoryRecord,
  ChannelHistoryQuery,
  ChannelHistoryResult,
  SkillEntity,
  CreateSkillParams,
  UpdateSkillParams,
  ScriptAiGenerateParams,
  ScriptAiProgressEvent,
  ScriptAiResult,
  RefineSceneParams,
  RefineSceneResult,
  AnalyzeAlignParams,
  AnalyzeAlignResult,
  SeparateFilesInput,
  SystemMetrics,
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
  deleteProjects: (projectIds: string[]) => ipcRenderer.invoke('projects:deleteMultiple', projectIds),
  exportProjectZip: (projectId: string, slotIndices?: number[]) =>
    ipcRenderer.invoke('projects:exportZip', { projectId, slotIndices }),
  downloadSelected: (params: { projectId: string; slotIndices: number[]; destinationDir: string }) =>
    ipcRenderer.invoke('projects:downloadSelected', params),
  retrySlot: (projectId: string, slotIndex: number): Promise<void> =>
    ipcRenderer.invoke('projects:retrySlot', projectId, slotIndex),
  revealAsset: (mediaPath: string): Promise<boolean> =>
    ipcRenderer.invoke('system:revealAsset', mediaPath),
  selectImageFile: (): Promise<string | null> =>
    ipcRenderer.invoke('system:selectImageFile'),
  selectMultipleImageFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('system:selectMultipleImageFiles'),
  selectZipFile: (): Promise<string | null> =>
    ipcRenderer.invoke('system:selectZipFile'),
  extractImageZip: (zipPath: string) =>
    ipcRenderer.invoke('system:extractImageZip', zipPath),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('system:selectDirectory'),

  // Generation
  startProjectGeneration: (projectId: string): Promise<GenerationJobEntity[]> =>
    ipcRenderer.invoke('projects:start', projectId),
  cancelJob: (projectId: string, jobId: string): Promise<void> =>
    ipcRenderer.invoke('projects:cancelJob', projectId, jobId),
  getProjectJobs: (projectId: string): Promise<GenerationJobEntity[]> =>
    ipcRenderer.invoke('projects:getJobs', projectId),
  getCapacityMetrics: (): Promise<SchedulerCapacityMetrics> =>
    ipcRenderer.invoke('scheduler:metrics'),

  // Profiles
  listProfiles: (): Promise<ProfileSessionSnapshot[]> => ipcRenderer.invoke('profiles:list'),
  createProfile: (params: { displayName: string; expectedEmail?: string; notes?: string }): Promise<ProfileConfig> =>
    ipcRenderer.invoke('profiles:create', params),
  startProfile: (profileId: string): Promise<ProfileSessionSnapshot | null> =>
    ipcRenderer.invoke('profiles:start', profileId),
  stopProfile: (profileId: string): Promise<void> => ipcRenderer.invoke('profiles:stop', profileId),
  deleteProfile: (profileId: string): Promise<void> => ipcRenderer.invoke('profiles:delete', profileId),
  openChrome: (profileId: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('profiles:openChrome', profileId),
  openSignIn: (profileId: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('profiles:openSignIn', profileId),
  openFlow: (profileId: string): Promise<{ success: boolean; message: string; snapshot: ProfileSessionSnapshot }> =>
    ipcRenderer.invoke('profiles:openFlow', profileId),
  launchLoginBrowser: (profileId: string): Promise<{ success: boolean; pid: number; cdpPort: number; userDataDir: string; message: string }> =>
    ipcRenderer.invoke('profiles:launchLoginBrowser', profileId),
  verifyAccount: (profileId: string): Promise<{ success: boolean; status: ProfileSessionStatus; detectedEmail: string | null; error?: string }> =>
    ipcRenderer.invoke('profiles:verifyAccount', profileId),
  testConnection: (profileId: string): Promise<{ success: boolean; port: number; responsive: boolean; status: ProfileSessionStatus }> =>
    ipcRenderer.invoke('profiles:testConnection', profileId),
  detectLocalChromeProfiles: () => ipcRenderer.invoke('profiles:detectLocalChrome'),
  detectProfileState: (target: string | { userDataDir?: string; profileDirectory?: string; email?: string; displayName?: string; preferredCdpPort?: number }) =>
    ipcRenderer.invoke('profiles:detectState', target),
  createExistingProfile: (params: {
    displayName: string;
    localProfileDirectory: string;
    localUserDataDir?: string;
    expectedEmail?: string;
    notes?: string;
    preferredCdpPort?: number;
  }) => ipcRenderer.invoke('profiles:createExisting', params),

  // Settings & System
  getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  // Video Factory (ZBot Integration)
  getFactoryDraft: (): Promise<VideoFactoryDraft> => ipcRenderer.invoke('factory:getDraft'),
  saveFactoryDraft: (draft: Partial<VideoFactoryDraft>): Promise<VideoFactoryDraft> =>
    ipcRenderer.invoke('factory:saveDraft', draft),
  parseScript: (rawText: string): Promise<ScriptParseResult> =>
    ipcRenderer.invoke('factory:parseScript', rawText),
  createFactoryProject: (config: VideoFactoryConfig): Promise<{ projectId: string; project: ProjectEntity }> =>
    ipcRenderer.invoke('factory:createProject', config),
  getProjectStory: (projectId: string): Promise<StoryEntity | null> =>
    ipcRenderer.invoke('factory:getStory', projectId),
  validateStory: (story: Partial<StoryEntity>): Promise<StoryValidationResult> =>
    ipcRenderer.invoke('factory:validateStory', story),
  updateProjectStory: (projectId: string, story: StoryEntity): Promise<{ success: boolean; story: StoryEntity }> =>
    ipcRenderer.invoke('factory:updateStory', projectId, story),
  getTtsEngines: (): Promise<TtsEngineMetadata[]> =>
    ipcRenderer.invoke('factory:getTtsEngines'),
  listVoices: (provider?: TtsProviderId): Promise<VoiceInfo[]> =>
    ipcRenderer.invoke('factory:listVoices', provider),
  previewVoice: (provider: TtsProviderId, voiceId: string, sampleText?: string): Promise<{ success: boolean; audioDataUri?: string; durationSeconds?: number; error?: string }> =>
    ipcRenderer.invoke('factory:previewVoice', provider, voiceId, sampleText),
  synthesizeProjectVoice: (projectId: string, voiceId?: string, provider?: TtsProviderId): Promise<TtsAudioManifest> =>
    ipcRenderer.invoke('factory:synthesizeVoice', projectId, voiceId, provider),
  combineAudio: (projectId: string, outputFilename?: string): Promise<{ masterAudioPath: string; durationSeconds: number }> =>
    ipcRenderer.invoke('factory:combineAudio', projectId, outputFilename),
  testTtsConnection: (provider: TtsProviderId): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('factory:testTtsConnection', provider),
  getAudioManifest: (projectId: string): Promise<TtsAudioManifest | null> =>
    ipcRenderer.invoke('factory:getAudioManifest', projectId),
  renderScene: (projectId: string, sceneNumber: number, options?: { motionStyle?: MotionStyle; subtitleStyle?: string; subtitlesEnabled?: boolean }): Promise<RenderSceneResult> =>
    ipcRenderer.invoke('factory:renderScene', projectId, sceneNumber, options),
  renderProjectClips: (projectId: string, options?: { motionStyle?: MotionStyle; subtitleStyle?: string; subtitlesEnabled?: boolean; transitionStyle?: TransitionStyle }): Promise<RenderManifest> =>
    ipcRenderer.invoke('factory:renderProjectClips', projectId, options),
  cancelProjectRender: (projectId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('factory:cancelProjectRender', projectId),
  getRenderManifest: (projectId: string): Promise<RenderManifest | null> =>
    ipcRenderer.invoke('factory:getRenderManifest', projectId),
  testTransition: (params: { sceneAVideoPath: string; sceneBVideoPath: string; outputPath: string; transitionStyle: TransitionStyle; duration?: number }): Promise<{ success: boolean; outputPath: string; duration: number }> =>
    ipcRenderer.invoke('factory:testTransition', params),
  assembleFinalVideo: (projectId: string, options?: FinalAssemblyOptions): Promise<FinalRenderManifest> =>
    ipcRenderer.invoke('factory:assembleFinalVideo', projectId, options),
  cancelFinalRender: (projectId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('factory:cancelFinalRender', projectId),
  getFinalRenderManifest: (projectId: string): Promise<FinalRenderManifest | null> =>
    ipcRenderer.invoke('factory:getFinalRenderManifest', projectId),
  selectMusicFile: (): Promise<string | null> =>
    ipcRenderer.invoke('system:selectMusicFile'),

  // Unified Video Factory Pipeline (Phase 2)
  startPipeline: (projectId: string, mode?: VideoFactoryMode): Promise<VideoFactoryPipelineState> =>
    ipcRenderer.invoke('pipeline:start', projectId, mode),
  pausePipeline: (projectId: string): Promise<VideoFactoryPipelineState> =>
    ipcRenderer.invoke('pipeline:pause', projectId),
  resumePipeline: (projectId: string): Promise<VideoFactoryPipelineState> =>
    ipcRenderer.invoke('pipeline:resume', projectId),
  cancelPipeline: (projectId: string): Promise<VideoFactoryPipelineState> =>
    ipcRenderer.invoke('pipeline:cancel', projectId),
  retryPipelineStage: (projectId: string, stage: VideoFactoryStage): Promise<VideoFactoryPipelineState> =>
    ipcRenderer.invoke('pipeline:retryStage', projectId, stage),
  getPipelineState: (projectId: string): Promise<VideoFactoryPipelineState | null> =>
    ipcRenderer.invoke('pipeline:getState', projectId),

  // Channels & Delivery (Phase 7)
  listChannels: (): Promise<ChannelEntity[]> => ipcRenderer.invoke('channels:list'),
  getChannel: (channelId: string): Promise<ChannelEntity | null> => ipcRenderer.invoke('channels:get', channelId),
  createChannel: (params: CreateChannelParams): Promise<ChannelEntity> => ipcRenderer.invoke('channels:create', params),
  updateChannel: (channelId: string, patch: Partial<Omit<ChannelEntity, 'id' | 'createdAt' | 'stats'>>): Promise<ChannelEntity> =>
    ipcRenderer.invoke('channels:update', channelId, patch),
  deleteChannel: (channelId: string): Promise<{ success: boolean; unassignedProjects: number }> =>
    ipcRenderer.invoke('channels:delete', channelId),
  assignProjectToChannel: (projectId: string, channelId?: string): Promise<ProjectEntity> =>
    ipcRenderer.invoke('channels:assignProject', projectId, channelId),
  deliverProjectToChannel: (projectId: string, channelId?: string): Promise<DeliveryHistoryRecord> =>
    ipcRenderer.invoke('channels:deliverProject', projectId, channelId),
  getChannelHistory: (query?: ChannelHistoryQuery): Promise<ChannelHistoryResult> =>
    ipcRenderer.invoke('channels:getHistory', query),
  retryDelivery: (deliveryId: string): Promise<DeliveryHistoryRecord> =>
    ipcRenderer.invoke('channels:retryDelivery', deliveryId),
  selectOutputDir: (): Promise<string | null> =>
    ipcRenderer.invoke('system:selectOutputDir'),

  // Skills & Script AI (Phase 8)
  listSkills: (): Promise<SkillEntity[]> => ipcRenderer.invoke('skills:list'),
  getSkill: (skillId: string): Promise<SkillEntity | null> => ipcRenderer.invoke('skills:get', skillId),
  createSkill: (params: CreateSkillParams): Promise<SkillEntity> => ipcRenderer.invoke('skills:create', params),
  updateSkill: (skillId: string, patch: UpdateSkillParams): Promise<SkillEntity> =>
    ipcRenderer.invoke('skills:update', skillId, patch),
  deleteSkill: (skillId: string): Promise<boolean | { success: boolean }> => ipcRenderer.invoke('skills:delete', skillId),
  importSkill: (fileContent: string | ArrayBuffer | Uint8Array, fileName?: string): Promise<SkillEntity> =>
    ipcRenderer.invoke('skills:import', fileContent, fileName),
  generateScriptAi: (params: ScriptAiGenerateParams): Promise<ScriptAiResult> =>
    ipcRenderer.invoke('scriptAi:generate', params),
  refineSceneAi: (params: RefineSceneParams): Promise<RefineSceneResult> =>
    ipcRenderer.invoke('scriptAi:refineScene', params),
  reReadScriptAi: (params: AnalyzeAlignParams): Promise<AnalyzeAlignResult> =>
    ipcRenderer.invoke('scriptAi:reReadScript', params),
  testScriptAiConnection: (): Promise<{ success: boolean; error?: string; model?: string; isMock?: boolean }> =>
    ipcRenderer.invoke('scriptAi:testConnection'),

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

  onRenderProgress: (callback: (event: RenderProgressEvent) => void) => {
    const handler = (_e: unknown, data: RenderProgressEvent) => callback(data);
    ipcRenderer.on('flow:render:progress', handler);
    return () => ipcRenderer.removeListener('flow:render:progress', handler);
  },

  onFinalRenderProgress: (callback: (event: FinalRenderProgressEvent) => void) => {
    const handler = (_e: unknown, data: FinalRenderProgressEvent) => callback(data);
    ipcRenderer.on('flow:final-render:progress', handler);
    return () => ipcRenderer.removeListener('flow:final-render:progress', handler);
  },

  onScriptAiProgress: (callback: (event: ScriptAiProgressEvent) => void) => {
    const handler = (_e: unknown, data: ScriptAiProgressEvent) => callback(data);
    ipcRenderer.on('flow:script-ai:progress', handler);
    return () => ipcRenderer.removeListener('flow:script-ai:progress', handler);
  },

  onPipelineProgress: (callback: (event: PipelineProgressEvent) => void) => {
    const handler = (_e: unknown, data: PipelineProgressEvent) => callback(data);
    ipcRenderer.on('flow:pipeline:progress', handler);
    return () => ipcRenderer.removeListener('flow:pipeline:progress', handler);
  },

  getSystemMetrics: (): Promise<SystemMetrics> =>
    ipcRenderer.invoke('system:getSystemMetrics'),

  parseSeparateFiles: (input: SeparateFilesInput): Promise<ScriptParseResult> =>
    ipcRenderer.invoke('script:parseSeparateFiles', input),
};

contextBridge.exposeInMainWorld('flowApi', flowApi);
