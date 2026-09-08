import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright';
import { ModelSelector } from '../main/engine/ModelSelector';
import { MediaDetector } from '../main/engine/MediaDetector';
import { parseMp4DurationFromBuffer, VideoDuration } from '../main/utils/VideoDuration';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import type { GenerationJobEntity, ProjectEntity } from '../shared/types';

describe('Video Pipeline & Omni Flash 1.1 Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Video Mode & Parameter Selection (ModelSelector)', () => {
    it('should switch mode to Video, select Omni 1.1 Flash, 720p, 4s, 16:9, and x1', async () => {
      const mockPage = {
        locator: vi.fn((selector: string) => {
          return {
            first: () => mockPage.locator(selector),
            isVisible: vi.fn().mockResolvedValue(true),
            getAttribute: vi.fn().mockImplementation(async (attr: string) => {
              if (attr === 'aria-checked') return 'false';
              return null;
            }),
            click: vi.fn().mockResolvedValue(undefined),
            textContent: vi.fn().mockResolvedValue(selector.includes('model') ? '🍌 Nano Banana 2' : ''),
          };
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        evaluate: vi.fn().mockResolvedValue({
          isVideo: true,
          modelText: 'Omni 1.1 Flash',
          resText: '720p',
          durText: '4s',
          ratioText: '16:9',
          qtyText: 'x1',
        }),
      } as unknown as Page;

      const result = await ModelSelector.ensureVideoModel(mockPage, {
        modelName: 'Omni 1.1 Flash',
        resolution: '720p',
        duration: '4s',
        ratio: '16:9',
        quantity: 'x1',
      });

      expect(result.verified).toBe(true);
      expect(result.mode).toBe('Video');
      expect(result.model).toContain('Omni');
      expect(result.resolution).toBe('720p');
      expect(result.duration).toBe('4s');
      expect(result.ratio).toBe('16:9');
      expect(result.quantity).toBe('x1');
    });

    it('should fail verification if mode remains Image or model is incorrect', async () => {
      const mockPage = {
        locator: vi.fn(() => ({
          first: () => mockPage.locator(''),
          isVisible: vi.fn().mockResolvedValue(true),
          getAttribute: vi.fn().mockResolvedValue('false'),
          click: vi.fn().mockResolvedValue(undefined),
          textContent: vi.fn().mockResolvedValue(''),
        })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        evaluate: vi.fn().mockResolvedValue({
          isVideo: false,
          modelText: 'Nano Banana 2',
          resText: '720p',
          durText: '4s',
          ratioText: '16:9',
          qtyText: 'x1',
        }),
      } as unknown as Page;

      const result = await ModelSelector.ensureVideoModel(mockPage, {
        modelName: 'Omni 1.1 Flash',
      });

      expect(result.verified).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should support alternative durations (6s, 8s, 10s) and resolutions (360p)', async () => {
      const mockPage = {
        locator: vi.fn(() => ({
          first: () => mockPage.locator(''),
          isVisible: vi.fn().mockResolvedValue(true),
          getAttribute: vi.fn().mockResolvedValue('false'),
          click: vi.fn().mockResolvedValue(undefined),
          textContent: vi.fn().mockResolvedValue(''),
        })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        evaluate: vi.fn().mockResolvedValue({
          isVideo: true,
          modelText: 'Omni 1.1 Flash',
          resText: '360p',
          durText: '8s',
          ratioText: '9:16',
          qtyText: 'x1',
        }),
      } as unknown as Page;

      const result = await ModelSelector.ensureVideoModel(mockPage, {
        modelName: 'Omni 1.1 Flash',
        resolution: '360p',
        duration: '8s',
        ratio: '9:16',
        quantity: 'x1',
      });

      expect(result.verified).toBe(true);
      expect(result.resolution).toBe('360p');
      expect(result.duration).toBe('8s');
      expect(result.ratio).toBe('9:16');
    });
  });

  describe('2. Video Media Detection & URL Parsing (MediaDetector)', () => {
    it('should extract video UUIDs and distinguish from image sources', () => {
      const sampleUrls = [
        'https://flow-content.google/image/img_uuid_001',
        'https://flow-content.google/video/vid_uuid_999',
        'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=trpc_vid_777',
        'https://example.com/other.mp4',
      ];

      const result = MediaDetector.parseMediaUuids(sampleUrls);
      expect(result.uuids).toContain('img_uuid_001');
      expect(result.uuids).toContain('vid_uuid_999');
      expect(result.uuids).toContain('trpc_vid_777');
      expect(result.matchedUrls.length).toBe(3);
    });

    it('should detect video elements and sources on live page', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          imageSrcs: ['https://flow-content.google/image/img1'],
          videoSources: ['https://flow-content.google/video/vid123', 'blob:https://flow.google.com/abc'],
          hasVideo: true,
        }),
      } as unknown as Page;

      const detection = await MediaDetector.detectMedia(mockPage);
      expect(detection.hasVideo).toBe(true);
      expect(detection.videoSources).toContain('https://flow-content.google/video/vid123');
      expect(detection.videoUuids).toContain('vid123');
    });

    it('should poll until a new video is detected in delta', async () => {
      let callCount = 0;
      const mockPage = {
        evaluate: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 2) {
            return { imageSrcs: [], videoSources: ['https://flow-content.google/video/old_vid'], hasVideo: true };
          }
          return {
            imageSrcs: [],
            videoSources: [
              'https://flow-content.google/video/old_vid',
              'https://flow-content.google/video/new_vid_555',
            ],
            hasVideo: true,
          };
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const before = new Set(['https://flow-content.google/video/old_vid']);
      const found = await MediaDetector.waitForGeneratedVideo(mockPage, before, 10000, 10);

      expect(found).not.toBeNull();
      expect(found?.videoUrl).toBe('https://flow-content.google/video/new_vid_555');
      expect(found?.uuid).toBe('new_vid_555');
    });
  });

  describe('3. Duration Extraction (VideoDuration)', () => {
    it('should extract duration correctly from an MP4 buffer with mvhd atom', () => {
      // Construct a minimal valid MP4 buffer containing moov -> mvhd atom
      // timescale = 1000, duration = 4000 -> 4.0 seconds
      const mvhdPayload = Buffer.alloc(24);
      mvhdPayload.writeUInt8(0, 0); // version = 0
      // bytes 1-3 flags
      // bytes 4-7 creation time
      // bytes 8-11 mod time
      mvhdPayload.writeUInt32BE(1000, 12); // timescale = 1000
      mvhdPayload.writeUInt32BE(4000, 16); // duration = 4000

      const mvhdBox = Buffer.concat([
        Buffer.from([0, 0, 0, 32]), // size = 32
        Buffer.from('mvhd', 'ascii'),
        mvhdPayload,
      ]);

      const moovBox = Buffer.concat([
        Buffer.from([0, 0, 0, 40]), // size = 40
        Buffer.from('moov', 'ascii'),
        mvhdBox,
      ]);

      const ftypBox = Buffer.concat([
        Buffer.from([0, 0, 0, 16]), // size = 16
        Buffer.from('ftyp', 'ascii'),
        Buffer.from('isom0000', 'ascii'),
      ]);

      const mp4Buffer = Buffer.concat([ftypBox, moovBox]);
      const duration = parseMp4DurationFromBuffer(mp4Buffer);

      expect(duration).toBeCloseTo(4.0, 1);
    });

    it('should return null on corrupt or incomplete buffers gracefully', () => {
      const corrupt = Buffer.from('NOT_AN_MP4_FILE_DATA');
      expect(parseMp4DurationFromBuffer(corrupt)).toBeNull();
    });
  });

  describe('4. Video Job Execution & Slot 0 Mapping (VideoExecutionService)', () => {
    it('should execute video job in mockMode and map result to Slot 0', async () => {
      const mockWorker = {
        profileId: 'profile_71b66ea2',
        release: vi.fn(),
      } as any;

      const mockJob: GenerationJobEntity = {
        jobId: 'job_test_vid_001',
        projectId: 'proj_test_vid',
        promptId: 'slot_0',
        promptType: 'video',
        slotIndex: 0,
        status: 'queued',
        retryCount: 0,
        maxRetries: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(JobRepository, 'updateJob').mockResolvedValue(mockJob as any);
      vi.spyOn(ProjectRepository, 'updateSlot').mockResolvedValue({
        slotIndex: 0,
        promptId: 'slot_0',
        projectId: 'proj_test_vid',
        type: 'video',
        promptText: 'A small red apple on a white table...',
        status: 'completed',
        result: {
          assetId: 'video_slot_0_job_test_vid_001',
          mediaPath: 'C:/test/path/video.mp4',
          modelUsed: 'Omni 1.1 Flash',
          ratioUsed: '16:9',
          resolution: '720p',
          durationSeconds: 4.0,
          durationFormatted: '4.0s',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 1024,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await VideoExecutionService.execute(mockWorker, mockJob, {
        mockMode: true,
        mockDurationSeconds: 4.0,
      });

      expect(mockWorker.release).toHaveBeenCalledTimes(1);
      expect(JobRepository.updateJob).toHaveBeenCalledWith(
        'proj_test_vid',
        'job_test_vid_001',
        expect.objectContaining({ status: 'completed' })
      );
      expect(ProjectRepository.updateSlot).toHaveBeenCalledWith(
        'proj_test_vid',
        0,
        expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            durationFormatted: '4.0s',
            resolution: '720p',
            modelUsed: 'Omni 1.1 Flash',
          }),
        })
      );
    });
  });
});
