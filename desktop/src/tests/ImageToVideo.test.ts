import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Page } from 'playwright';
import { FlowDriver } from '../main/engine/FlowDriver';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import type { CreateProjectParams, GenerationJobEntity } from '../shared/types';

describe('Image-to-Video & Bulk Image-to-Video Test Suite', () => {
  let tempDir: string;
  let testImagePath1: string;
  let testImagePath2: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i2v_test_'));
    testImagePath1 = path.join(tempDir, 'test_car.jpg');
    testImagePath2 = path.join(tempDir, 'test_doll.png');
    fs.writeFileSync(testImagePath1, Buffer.from('FAKE_IMAGE_1_JPG_BYTES'));
    fs.writeFileSync(testImagePath2, Buffer.from('FAKE_IMAGE_2_PNG_BYTES'));
  });

  afterEach(() => {
    delete process.env.FLOW_TEST_PROFILE_OVERRIDE;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Source Image Validation & FlowDriver Attachment', () => {
    it('should throw immediately if source image does not exist', async () => {
      const nonExistent = path.join(tempDir, 'does_not_exist.png');
      const fakePage = {} as Page;

      await expect(FlowDriver.attachSourceImage(fakePage, nonExistent)).rejects.toThrow(
        /does not exist at path/i
      );
    });

    it('should complete attachment workflow when elements and filechooser succeed', async () => {
      let fileChooserCalledWith: string | null = null;
      const mockFileChooser = {
        setFiles: vi.fn(async (p: string) => {
          fileChooserCalledWith = p;
        }),
      };

      const mockPage = {
        viewportSize: vi.fn(() => ({ width: 1280, height: 800 })),
        locator: vi.fn((sel: string) => {
          return {
            first: () => mockPage.locator(sel),
            isVisible: vi.fn().mockResolvedValue(true),
            count: vi.fn().mockResolvedValue(1),
            evaluate: vi.fn(async (cb: any) => {
              if (typeof cb === 'function') {
                cb({ click: () => {} });
              }
              return true;
            }),
            click: vi.fn().mockResolvedValue(undefined),
            getAttribute: vi.fn().mockImplementation(async () => {
              return null;
            }),
          };
        }),
        waitForEvent: vi.fn().mockImplementation(async (event: string) => {
          if (event === 'filechooser') return mockFileChooser;
          return null;
        }),
        evaluate: vi.fn().mockResolvedValue(true),
      } as unknown as Page;

      const attached = await FlowDriver.attachSourceImage(mockPage, testImagePath1);
      expect(attached).toBe(true);
      expect(fileChooserCalledWith).toBe(testImagePath1);
    });
  });

  describe('2. Project Repository: Image-to-Video & Bulk Slot Mapping', () => {
    it('should create an image_to_video project preserving sourceImagePath on slot 0', async () => {
      const params: CreateProjectParams = {
        name: 'Single I2V Test',
        generationMode: 'image_to_video',
        prompts: [
          {
            type: 'video',
            text: 'Cinematic orbit around sports car',
            sourceImagePath: testImagePath1,
          },
        ],
        settings: {
          videoModel: 'Omni 1.1 Flash',
          videoDuration: '4s',
          videoResolution: '720p',
          videoRatio: '16:9',
        },
      };

      const project = await ProjectRepository.create(params);
      expect(project.settings.generationMode).toBe('image_to_video');
      expect(project.slots).toHaveLength(1);
      expect(project.slots[0].type).toBe('video');
      expect(project.slots[0].sourceImagePath).toBe(testImagePath1);
      expect(project.slots[0].promptText).toBe('Cinematic orbit around sports car');

      await ProjectRepository.delete(project.projectId).catch(() => {});
    });

    it('should create a bulk_image_to_video project with strict 1-to-1 slot mapping', async () => {
      const params: CreateProjectParams = {
        name: 'Bulk I2V Test Project',
        generationMode: 'bulk_image_to_video',
        prompts: [
          {
            type: 'video',
            text: 'Prompt 0: Car speeding along highway',
            sourceImagePath: testImagePath1,
          },
          {
            type: 'video',
            text: 'Prompt 1: Doll slowly turning head',
            sourceImagePath: testImagePath2,
          },
        ],
        settings: {
          videoModel: 'Omni 1.1 Flash',
          videoDuration: '4s',
        },
      };

      const project = await ProjectRepository.create(params);
      expect(project.settings.generationMode).toBe('bulk_image_to_video');
      expect(project.slots).toHaveLength(2);

      expect(project.slots[0].slotIndex).toBe(0);
      expect(project.slots[0].sourceImagePath).toBe(testImagePath1);
      expect(project.slots[0].promptText).toContain('Prompt 0');

      expect(project.slots[1].slotIndex).toBe(1);
      expect(project.slots[1].sourceImagePath).toBe(testImagePath2);
      expect(project.slots[1].promptText).toContain('Prompt 1');

      expect(project.slots[0].sourceImagePath).not.toBe(project.slots[1].sourceImagePath);

      await ProjectRepository.delete(project.projectId).catch(() => {});
    });
  });

  describe('3. VideoExecutionService: Image-to-Video Execution & Persistence', () => {
    it('should execute Image-to-Video mock job and persist sourceImagePath in result', async () => {
      const mockWorker = {
        profileId: 'profile_b75159bb',
        release: vi.fn(),
      } as any;

      const mockJob: GenerationJobEntity = {
        jobId: 'job_i2v_001',
        projectId: 'proj_i2v_test',
        promptId: 'slot_001',
        promptType: 'video',
        slotIndex: 0,
        sourceImagePath: testImagePath1,
        status: 'queued',
        retryCount: 0,
        maxRetries: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockProject = {
        id: 'proj_i2v_test',
        name: 'Mock I2V',
        generationMode: 'image_to_video',
        slots: [
          {
            slotIndex: 0,
            promptId: 'slot_001',
            projectId: 'proj_i2v_test',
            type: 'video',
            promptText: 'A rotating camera angle',
            sourceImagePath: testImagePath1,
            status: 'draft',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        settings: {
          videoModel: 'Omni 1.1 Flash',
          videoDuration: '4s',
          videoResolution: '720p',
          videoRatio: '16:9',
        },
      };

      vi.spyOn(ProjectRepository, 'get').mockResolvedValue(mockProject as any);
      vi.spyOn(JobRepository, 'updateJob').mockResolvedValue(mockJob as any);
      const updateSlotSpy = vi.spyOn(ProjectRepository, 'updateSlot').mockResolvedValue({
        ...mockProject.slots[0],
        status: 'completed',
        result: {
          assetId: 'video_slot_001_job_i2v_001',
          mediaPath: '/fake/path/video.mp4',
          sourceImagePath: testImagePath1,
        } as any,
      });

      await VideoExecutionService.execute(mockWorker, mockJob, { mockMode: true });

      expect(mockWorker.release).toHaveBeenCalledWith('job_i2v_001');
      expect(updateSlotSpy).toHaveBeenCalled();
      const lastCall = updateSlotSpy.mock.calls.find((call) => call[1] === 0 && call[2].status === 'completed');
      expect(lastCall).toBeDefined();
      expect(lastCall![2].result?.sourceImagePath).toBe(testImagePath1);
    });

    it('should always release worker slot in finally block even if execution throws', async () => {
      const mockWorker = {
        profileId: 'profile_b75159bb',
        release: vi.fn(),
        automation: {
          getPage: () => {
            throw new Error('Fatal browser crash');
          },
          checkAuthentication: vi.fn().mockResolvedValue({ state: 'authenticated' }),
        },
      } as any;

      const mockJob: GenerationJobEntity = {
        jobId: 'job_i2v_fail_002',
        projectId: 'proj_i2v_test',
        promptId: 'slot_002',
        promptType: 'video',
        slotIndex: 0,
        sourceImagePath: testImagePath1,
        status: 'queued',
        retryCount: 0,
        maxRetries: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(ProjectRepository, 'get').mockResolvedValue({
        id: 'proj_i2v_test',
        slots: [{ slotIndex: 0, promptText: 'Prompt', sourceImagePath: testImagePath1 }],
        settings: { videoModel: 'Omni 1.1 Flash' },
      } as any);

      vi.spyOn(JobRepository, 'updateJob').mockResolvedValue(mockJob as any);
      vi.spyOn(ProjectRepository, 'updateSlot').mockResolvedValue({} as any);

      await expect(
        VideoExecutionService.execute(mockWorker, mockJob, { mockMode: false })
      ).rejects.toThrow();

      expect(mockWorker.release).toHaveBeenCalledWith('job_i2v_fail_002');
    });
  });

  describe('4. WorkerPool & FLOW_TEST_PROFILE_OVERRIDE', () => {
    it('should exclusively return overridden profile when FLOW_TEST_PROFILE_OVERRIDE is set', () => {
      const pool = new WorkerPool();
      const workerA = { profileId: 'profile_aaa', isAvailable: true, activeJobCount: 0 } as any;
      const workerB = { profileId: 'profile_b75159bb', isAvailable: true, activeJobCount: 0 } as any;

      pool.registerWorker(workerA);
      pool.registerWorker(workerB);

      const selectedNormal = pool.getAvailableWorker();
      expect(selectedNormal).not.toBeNull();

      process.env.FLOW_TEST_PROFILE_OVERRIDE = 'profile_b75159bb';
      const selectedOverride = pool.getAvailableWorker();
      expect(selectedOverride?.profileId).toBe('profile_b75159bb');

      process.env.FLOW_TEST_PROFILE_OVERRIDE = 'profile_nonexistent';
      const selectedNone = pool.getAvailableWorker();
      expect(selectedNone).toBeNull();
    });
  });
});
