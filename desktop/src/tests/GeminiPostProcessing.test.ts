import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiPostProcessingService } from '../main/execution/GeminiPostProcessingService';
import { GeminiWatermarkDetector } from '../main/execution/GeminiWatermarkDetector';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('Gemini Watermark Quality & Detection Hardening Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Watermark Detection & Bounding-Box Scaling
  describe('1. Watermark Detection & Bounding-Box Scaling', () => {
    it('derives scaled bounding box for 16:9 landscape 720p', () => {
      const bbox = GeminiWatermarkDetector.deriveGeometryCoordinates(1280, 720, '16:9');
      expect(bbox.x).toBe(1134); // 1280 - 96 - 48 - 2
      expect(bbox.y).toBe(574);  // 720 - 96 - 48 - 2
      expect(bbox.w).toBe(52);
      expect(bbox.h).toBe(52);
    });

    it('derives scaled bounding box for 16:9 landscape 1080p', () => {
      const bbox = GeminiWatermarkDetector.deriveGeometryCoordinates(1920, 1080, '16:9');
      // scale = 1.5, size = 72, margin = 144
      expect(bbox.x).toBe(1702); // 1920 - 144 - 72 - 2
      expect(bbox.y).toBe(862);  // 1080 - 144 - 72 - 2
      expect(bbox.w).toBe(76);
      expect(bbox.h).toBe(76);
    });

    it('derives scaled bounding box for 9:16 portrait 720x1280', () => {
      const bbox = GeminiWatermarkDetector.deriveGeometryCoordinates(720, 1280, '9:16');
      expect(bbox.x).toBe(574);  // 720 - 96 - 48 - 2
      expect(bbox.y).toBe(1134); // 1280 - 96 - 48 - 2
      expect(bbox.w).toBe(52);
      expect(bbox.h).toBe(52);
    });

    it('derives scaled bounding box for 9:16 portrait 1080x1920', () => {
      const bbox = GeminiWatermarkDetector.deriveGeometryCoordinates(1080, 1920, '9:16');
      // scale = 1.5, size = 72, margin = 144
      expect(bbox.x).toBe(862);  // 1080 - 144 - 72 - 2
      expect(bbox.y).toBe(1702); // 1920 - 144 - 72 - 2
      expect(bbox.w).toBe(76);
      expect(bbox.h).toBe(76);
    });

    it('handles multiple custom resolutions gracefully (e.g. 640x360)', () => {
      const bbox = GeminiWatermarkDetector.deriveGeometryCoordinates(640, 360, '16:9');
      expect(bbox.w).toBe(28); // 48 * 0.5 + 4
      expect(bbox.h).toBe(28);
      expect(bbox.x).toBeGreaterThan(0);
      expect(bbox.y).toBeGreaterThan(0);
    });

    it('selects variant 48 for 720p and 96 for 1080p across 16:9 and 9:16', async () => {
      vi.spyOn(GeminiWatermarkDetector, 'probeVideo').mockResolvedValue({ width: 1280, height: 720, duration: 10 });
      const res169_720 = await GeminiWatermarkDetector.detect('v1.mp4', { ratio: '16:9', width: 1280, height: 720 });
      expect(res169_720.variant).toBe('48');

      vi.spyOn(GeminiWatermarkDetector, 'probeVideo').mockResolvedValue({ width: 1920, height: 1080, duration: 10 });
      const res169_1080 = await GeminiWatermarkDetector.detect('v2.mp4', { ratio: '16:9', width: 1920, height: 1080 });
      expect(res169_1080.variant).toBe('96');

      vi.spyOn(GeminiWatermarkDetector, 'probeVideo').mockResolvedValue({ width: 720, height: 1280, duration: 10 });
      const res916_720 = await GeminiWatermarkDetector.detect('v3.mp4', { ratio: '9:16', width: 720, height: 1280 });
      expect(res916_720.variant).toBe('48');

      vi.spyOn(GeminiWatermarkDetector, 'probeVideo').mockResolvedValue({ width: 1080, height: 1920, duration: 10 });
      const res916_1080 = await GeminiWatermarkDetector.detect('v4.mp4', { ratio: '9:16', width: 1080, height: 1920 });
      expect(res916_1080.variant).toBe('96');
    });
  });

  // 2. Multi-Tier Detection Order & Fallbacks
  describe('2. Multi-Tier Detection Order & Fallbacks', () => {
    it('Tier 1: honors official opt-out metadata and skips processing', async () => {
      const result = await GeminiWatermarkDetector.detect('any_path.mp4', { officialOptOut: true });
      expect(result.detected).toBe(false);
      expect(result.method).toBe('official_metadata');
      expect(result.confidence).toBe(1.0);
    });

    it('Tier 4: falls back to fixed coordinates when ffmpeg is not available', async () => {
      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
      vi.spyOn(FfmpegResolver, 'findFfprobe').mockReturnValue(null);

      const result = await GeminiWatermarkDetector.detect('any_path.mp4', { ratio: '16:9' });
      expect(result.detected).toBe(true);
      expect(result.method).toBe('fixed_fallback');
      expect(result.boundingBox).toEqual({ x: 1130, y: 570, w: 60, h: 60 });
    });

    it('Tier 4: falls back to portrait fixed coordinates when ffmpeg is not available', async () => {
      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
      vi.spyOn(FfmpegResolver, 'findFfprobe').mockReturnValue(null);

      const result = await GeminiWatermarkDetector.detect('any_path.mp4', { ratio: '9:16' });
      expect(result.detected).toBe(true);
      expect(result.method).toBe('fixed_fallback');
      expect(result.boundingBox).toEqual({ x: 570, y: 1130, w: 60, h: 60 });
    });
  });

  // 3. No-Watermark Detection & Preservation
  describe('3. No-Watermark Videos & Source Preservation', () => {
    it('skips delogo when watermark is not detected on video', async () => {
      const dummyPath = path.join(__dirname, 'test_clean_video.mp4');
      fs.writeFileSync(dummyPath, 'valid-clean-mp4-data');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
        vi.spyOn(GeminiWatermarkDetector, 'detect').mockResolvedValue({
          detected: false,
          method: 'template_zncc',
          confidence: 0.95,
          boundingBox: { x: 0, y: 0, w: 0, h: 0 },
          videoDimensions: { width: 1280, height: 720 },
        });

        const res = await GeminiPostProcessingService.cleanVideoWatermark(dummyPath);
        expect(res.success).toBe(true);
        expect(res.watermarkCleaned).toBe(false);
        expect(res.cleanVideoPath).toBe(dummyPath);
        expect(res.originalVideoPath).toBe(dummyPath);
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      }
    });

    it('executes reverse_alpha_blending on valid video with watermark and preserves audio stream', async () => {
      const realVideo = 'C:\\Users\\mrand\\AppData\\Local\\GoogleFlowApp\\projects\\proj_49a40c43157d\\videos\\slot_00_slot_533c716d2dcb_job_ecc74aa915e1.mp4';
      if (!fs.existsSync(realVideo)) return;

      const outputClean = path.join(__dirname, 'test_output_video_cleaned.mp4');
      try {
        const res = await GeminiPostProcessingService.cleanVideoWatermark(realVideo, outputClean, { ratio: '16:9' });
        expect(res.success).toBe(true);
        expect(res.watermarkCleaned).toBe(true);
        expect(res.reconstructionMethod).toBe('reverse_alpha_blending');
        expect(fs.existsSync(outputClean)).toBe(true);

        // Verify audio stream is preserved via ffprobe
        const ffprobePath = FfmpegResolver.findFfprobe();
        if (ffprobePath) {
          const { execFileSync } = require('child_process');
          const streams = execFileSync(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            outputClean,
          ]).toString();
          expect(streams).toContain('audio');
        }
      } finally {
        if (fs.existsSync(outputClean)) fs.unlinkSync(outputClean);
      }
    }, 25000);

    it('reverse-alpha failure preserves original without delogo fallback', async () => {
      const dummyPath = path.join(__dirname, 'test_fail_video.mp4');
      fs.writeFileSync(dummyPath, 'not-a-valid-video-stream');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
        vi.spyOn(GeminiWatermarkDetector, 'detect').mockResolvedValue({
          detected: true,
          method: 'geometry_derived',
          confidence: 0.85,
          boundingBox: { x: 1130, y: 570, w: 60, h: 60 },
          videoDimensions: { width: 1280, height: 720 },
          variant: '48',
        });

        const res = await GeminiPostProcessingService.cleanVideoWatermark(dummyPath);
        expect(res.success).toBe(false);
        expect(res.watermarkCleaned).toBe(false);
        expect(res.cleanVideoPath).toBe(dummyPath);
        expect(res.reconstructionMethod).toBeUndefined();
        expect(res.error).toBeDefined();
        expect(res.error).not.toContain('delogo');
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      }
    });
  });

  // 4. Robust Error Handling & Malformed Media
  describe('4. Robust Error Handling & Malformed Media', () => {
    it('returns graceful failure when file does not exist on disk', async () => {
      const res = await GeminiPostProcessingService.cleanVideoWatermark('C:\\missing\\video.mp4');
      expect(res.success).toBe(false);
      expect(res.error).toContain('does not exist');
      expect(res.cleanVideoPath).toBe('C:\\missing\\video.mp4');
    });

    it('returns graceful failure when ffmpeg binary cannot be found', async () => {
      const dummyPath = path.join(__dirname, 'test_dummy.mp4');
      fs.writeFileSync(dummyPath, 'dummy-data');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
        const res = await GeminiPostProcessingService.cleanVideoWatermark(dummyPath);
        expect(res.success).toBe(false);
        expect(res.error).toContain('FFmpeg binary not found');
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      }
    });

    it('survives malformed corrupt media without crashing or throwing unhandled errors', async () => {
      const corruptPath = path.join(__dirname, 'corrupt_video.mp4');
      fs.writeFileSync(corruptPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]));

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
        vi.spyOn(GeminiWatermarkDetector, 'detect').mockResolvedValue({
          detected: true,
          method: 'geometry_derived',
          confidence: 0.8,
          boundingBox: { x: 1130, y: 570, w: 60, h: 60 },
          videoDimensions: { width: 1280, height: 720 },
        });

        const res = await GeminiPostProcessingService.cleanVideoWatermark(corruptPath);
        // Clean fails on corrupt input, but original file is preserved and returned safely
        expect(res.success).toBe(false);
        expect(res.originalVideoPath).toBe(corruptPath);
        expect(fs.existsSync(corruptPath)).toBe(true);
      } finally {
        if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
      }
    });
  });
});
