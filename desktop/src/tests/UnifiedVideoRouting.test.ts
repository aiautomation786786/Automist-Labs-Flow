import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { GeminiVideoExecutionService } from '../main/execution/GeminiVideoExecutionService';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { ImageExecutionService } from '../main/execution/ImageExecutionService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import type { GenerationJobEntity, ProjectEntity } from '../shared/types';

vi.mock('../main/execution/GeminiVideoExecutionService');
vi.mock('../main/execution/VideoExecutionService');
vi.mock('../main/execution/ImageExecutionService');
vi.mock('../main/storage/ProjectRepository');
vi.mock('../main/storage/JobRepository');

describe('UnifiedVideoRouting Scheduler Integration', () => {
  let workerPool: WorkerPool;
  let scheduler: GenerationScheduler;
  let mockWorker: ProfileWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    workerPool = new WorkerPool();
    mockWorker = {
      profileId: 'profile_test_1',
      isAvailable: true,
      assignJob: vi.fn(),
      release: vi.fn(),
    } as unknown as ProfileWorker;

    vi.spyOn(workerPool, 'getAvailableWorker').mockReturnValue(mockWorker);
    scheduler = new GenerationScheduler(workerPool, { mockMode: true });
  });

  it('routes job explicitly tagged provider: gemini to GeminiVideoExecutionService', async () => {
    const mockProject: Partial<ProjectEntity> = {
      projectId: 'proj_gemini_1',
      settings: {
        provider: 'gemini',
        videoModel: 'Gemini Omni',
        videoDuration: '10s',
        videoRatio: '16:9',
        imageRatio: '16:9',
        processingOrder: 'automatic',
        autoRetry: false,
        maxRetries: 1,
      },
    };

    const mockJob: GenerationJobEntity = {
      jobId: 'job_g1',
      projectId: 'proj_gemini_1',
      promptId: 'slot_0',
      promptType: 'video',
      provider: 'gemini',
      slotIndex: 0,
      status: 'assigned',
      retryCount: 0,
      maxRetries: 1,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    vi.mocked(ProjectRepository.get).mockResolvedValue(mockProject as ProjectEntity);

    // Call private executeJobOnWorker via any cast
    await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

    expect(GeminiVideoExecutionService.execute).toHaveBeenCalledWith(
      mockWorker,
      mockJob,
      expect.anything()
    );
    expect(VideoExecutionService.execute).not.toHaveBeenCalled();
    expect(ImageExecutionService.execute).not.toHaveBeenCalled();
  });

  it('routes job tagged provider: flow to VideoExecutionService', async () => {
    const mockProject: Partial<ProjectEntity> = {
      projectId: 'proj_flow_1',
      settings: {
        provider: 'flow',
        videoModel: 'Veo 3.1 - Quality',
        videoDuration: '8s',
        videoRatio: '16:9',
        imageRatio: '16:9',
        processingOrder: 'automatic',
        autoRetry: false,
        maxRetries: 1,
      },
    };

    const mockJob: GenerationJobEntity = {
      jobId: 'job_f1',
      projectId: 'proj_flow_1',
      promptId: 'slot_0',
      promptType: 'video',
      provider: 'flow',
      slotIndex: 0,
      status: 'assigned',
      retryCount: 0,
      maxRetries: 1,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    vi.mocked(ProjectRepository.get).mockResolvedValue(mockProject as ProjectEntity);

    await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

    expect(VideoExecutionService.execute).toHaveBeenCalledWith(
      mockWorker,
      mockJob,
      expect.anything()
    );
    expect(GeminiVideoExecutionService.execute).not.toHaveBeenCalled();
  });

  it('strictly routes Veo models to VideoExecutionService even if provider is auto', async () => {
    const mockProject: Partial<ProjectEntity> = {
      projectId: 'proj_auto_veo',
      settings: {
        provider: 'auto',
        videoModel: 'Veo 3.1 - Fast',
        videoDuration: '6s',
        videoRatio: '16:9',
        imageRatio: '16:9',
        processingOrder: 'automatic',
        autoRetry: false,
        maxRetries: 1,
      },
    };

    const mockJob: GenerationJobEntity = {
      jobId: 'job_veo_auto',
      projectId: 'proj_auto_veo',
      promptId: 'slot_0',
      promptType: 'video',
      provider: 'auto',
      slotIndex: 0,
      status: 'assigned',
      retryCount: 0,
      maxRetries: 1,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    vi.mocked(ProjectRepository.get).mockResolvedValue(mockProject as ProjectEntity);

    await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

    // Veo must NEVER be executed on Gemini
    expect(VideoExecutionService.execute).toHaveBeenCalled();
    expect(GeminiVideoExecutionService.execute).not.toHaveBeenCalled();
  });

  it('routes image prompts to ImageExecutionService', async () => {
    const mockProject: Partial<ProjectEntity> = {
      projectId: 'proj_img_1',
      settings: {
        provider: 'flow',
        imageModel: 'Nano Banana 2',
        imageRatio: '16:9',
        videoRatio: '16:9',
        processingOrder: 'automatic',
        autoRetry: false,
        maxRetries: 1,
      },
    };

    const mockJob: GenerationJobEntity = {
      jobId: 'job_img1',
      projectId: 'proj_img_1',
      promptId: 'slot_0',
      promptType: 'image',
      provider: 'flow',
      slotIndex: 0,
      status: 'assigned',
      retryCount: 0,
      maxRetries: 1,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    vi.mocked(ProjectRepository.get).mockResolvedValue(mockProject as ProjectEntity);

    await (scheduler as any).executeJobOnWorker(mockWorker, mockJob);

    expect(ImageExecutionService.execute).toHaveBeenCalled();
    expect(GeminiVideoExecutionService.execute).not.toHaveBeenCalled();
    expect(VideoExecutionService.execute).not.toHaveBeenCalled();
  });
});
