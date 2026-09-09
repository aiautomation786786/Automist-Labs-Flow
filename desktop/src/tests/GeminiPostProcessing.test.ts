import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiPostProcessingService } from '../main/execution/GeminiPostProcessingService';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('GeminiPostProcessingService Watermark Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Watermark Bounding Box Calculation', () => {
    it('calculates default 16:9 landscape 720p bounding box', () => {
      const bbox = GeminiPostProcessingService.getWatermarkBoundingBox('16:9', 1280, 720);
      expect(bbox).toEqual({ x: 1130, y: 570, w: 60, h: 60 });
    });

    it('calculates 16:9 landscape 1080p bounding box', () => {
      const bbox = GeminiPostProcessingService.getWatermarkBoundingBox('16:9', 1920, 1080);
      expect(bbox).toEqual({ x: 1700, y: 860, w: 90, h: 90 });
    });

    it('calculates 9:16 portrait 720p bounding box', () => {
      const bbox = GeminiPostProcessingService.getWatermarkBoundingBox('9:16', 720, 1280);
      expect(bbox).toEqual({ x: 570, y: 1130, w: 60, h: 60 });
    });

    it('calculates 9:16 portrait 1080p bounding box', () => {
      const bbox = GeminiPostProcessingService.getWatermarkBoundingBox('9:16', 1080, 1920);
      expect(bbox).toEqual({ x: 860, y: 1700, w: 90, h: 90 });
    });
  });

  describe('2. Binary Availability & Graceful Fallback', () => {
    it('reports availability based on FfmpegResolver', () => {
      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
      expect(GeminiPostProcessingService.isAvailable()).toBe(true);

      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
      expect(GeminiPostProcessingService.isAvailable()).toBe(false);
    });

    it('returns graceful failure if input video does not exist on disk', async () => {
      const result = await GeminiPostProcessingService.cleanVideoWatermark('C:\\nonexistent\\video.mp4');
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(result.cleanVideoPath).toBe('C:\\nonexistent\\video.mp4');
    });

    it('returns graceful fallback if FFmpeg is not found', async () => {
      const dummyPath = path.join(__dirname, 'dummy_test_video.mp4');
      fs.writeFileSync(dummyPath, 'fake-video-content');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
        const result = await GeminiPostProcessingService.cleanVideoWatermark(dummyPath);
        expect(result.success).toBe(false);
        expect(result.error).toContain('FFmpeg binary not found');
        expect(result.cleanVideoPath).toBe(dummyPath);
        expect(result.originalVideoPath).toBe(dummyPath);
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      }
    });
  });
});
