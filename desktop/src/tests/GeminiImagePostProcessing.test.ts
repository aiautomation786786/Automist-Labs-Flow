import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiImagePostProcessingService } from '../main/execution/GeminiImagePostProcessingService';
import { GeminiImageWatermarkDetector } from '../main/execution/GeminiImageWatermarkDetector';
import { WatermarkMasks } from '../main/execution/WatermarkMasks';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('Gemini Image Watermark Quality & Detection Hardening Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Watermark Detection & Bounding-Box Scaling
  describe('1. Image Watermark Detection & Bounding-Box Scaling', () => {
    it('derives scaled bounding box for 16:9 landscape 1024x572', () => {
      const bbox = GeminiImageWatermarkDetector.deriveGeometryCoordinates(1024, 572, '16:9');
      // scale = 572 / 720 = 0.7944, size = 38, margin = 76
      expect(bbox.w).toBe(42);
      expect(bbox.h).toBe(42);
      expect(bbox.x).toBeGreaterThan(800);
      expect(bbox.y).toBeGreaterThan(400);
    });

    it('derives scaled bounding box for 16:9 landscape 1280x720', () => {
      const bbox = GeminiImageWatermarkDetector.deriveGeometryCoordinates(1280, 720, '16:9');
      // scale = 1.0, size = 48, margin = 96
      expect(bbox.x).toBe(1134); // 1280 - 96 - 48 - 2
      expect(bbox.y).toBe(574);  // 720 - 96 - 48 - 2
      expect(bbox.w).toBe(52);
      expect(bbox.h).toBe(52);
    });

    it('derives scaled bounding box for 9:16 portrait 572x1024', () => {
      const bbox = GeminiImageWatermarkDetector.deriveGeometryCoordinates(572, 1024, '9:16');
      expect(bbox.w).toBe(42);
      expect(bbox.h).toBe(42);
      expect(bbox.x).toBeGreaterThan(400);
      expect(bbox.y).toBeGreaterThan(800);
    });

    it('derives scaled bounding box for 9:16 portrait 720x1280', () => {
      const bbox = GeminiImageWatermarkDetector.deriveGeometryCoordinates(720, 1280, '9:16');
      expect(bbox.x).toBe(574);  // 720 - 96 - 48 - 2
      expect(bbox.y).toBe(1134); // 1280 - 96 - 48 - 2
      expect(bbox.w).toBe(52);
      expect(bbox.h).toBe(52);
    });

    it('derives scaled bounding box for 1:1 square 1024x1024', () => {
      const bbox = GeminiImageWatermarkDetector.deriveGeometryCoordinates(1024, 1024, '1:1');
      expect(bbox.x).toBe(902); // 1024 - 72 - 48 - 2
      expect(bbox.y).toBe(902); // 1024 - 72 - 48 - 2
      expect(bbox.w).toBe(52);
      expect(bbox.h).toBe(52);
    });
  });

  // 2. Multi-Tier Detection Order & Fallbacks
  describe('2. Multi-Tier Detection Order & Fallbacks', () => {
    it('Tier 1: honors official opt-out metadata and skips processing', async () => {
      const result = await GeminiImageWatermarkDetector.detect('any_path.png', { officialOptOut: true });
      expect(result.detected).toBe(false);
      expect(result.method).toBe('official_metadata');
      expect(result.confidence).toBe(1.0);
    });

    it('Tier 4: falls back to fixed coordinates when ffmpeg is not available', async () => {
      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
      vi.spyOn(FfmpegResolver, 'findFfprobe').mockReturnValue(null);

      const result = await GeminiImageWatermarkDetector.detect('any_path.png', { ratio: '16:9' });
      expect(result.detected).toBe(true);
      expect(result.method).toBe('fixed_fallback');
      expect(result.boundingBox).toEqual({ x: 1130, y: 570, w: 52, h: 52 });
    });

    it('Tier 4: falls back to portrait fixed coordinates when ffmpeg is not available', async () => {
      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
      vi.spyOn(FfmpegResolver, 'findFfprobe').mockReturnValue(null);

      const result = await GeminiImageWatermarkDetector.detect('any_path.png', { ratio: '9:16' });
      expect(result.detected).toBe(true);
      expect(result.method).toBe('fixed_fallback');
      expect(result.boundingBox).toEqual({ x: 570, y: 1130, w: 52, h: 52 });
    });
  });

  // 3. No-Watermark Detection & Source Preservation
  describe('3. No-Watermark Images & Source Preservation', () => {
    it('skips reconstruction when watermark is not detected on image', async () => {
      const dummyPath = path.join(__dirname, 'test_clean_image.png');
      fs.writeFileSync(dummyPath, 'valid-clean-png-payload');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
        vi.spyOn(GeminiImageWatermarkDetector, 'detect').mockResolvedValue({
          detected: false,
          method: 'template_zncc',
          confidence: 0.12,
          boundingBox: { x: 0, y: 0, w: 0, h: 0 },
          imageDimensions: { width: 1024, height: 572 },
        });

        const res = await GeminiImagePostProcessingService.cleanImageWatermark(dummyPath, undefined, { ratio: '16:9' });
        expect(res.success).toBe(true);
        expect(res.watermarkCleaned).toBe(false);
        expect(res.cleanImagePath).toBe(dummyPath);
        expect(res.originalImagePath).toBe(dummyPath);
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      }
    });

    it('executes watermark removal when watermark is detected, preserves original and outputs clean image', async () => {
      const src169 = path.join(__dirname, '..', '..', 'scratch', 'watermark_e2e_verification', 'source_watermarked_16_9.png');
      if (!fs.existsSync(src169)) return;

      const outputClean = path.join(__dirname, 'test_output_cleaned.png');
      try {
        const res = await GeminiImagePostProcessingService.cleanImageWatermark(src169, outputClean, { ratio: '16:9' });
        expect(res.success).toBe(true);
        expect(res.watermarkCleaned).toBe(true);
        expect(res.reconstructionMethod).toBe('reverse_alpha_blending');
        expect(res.cleanImagePath).toBe(outputClean);
        expect(fs.existsSync(outputClean)).toBe(true);
        expect(fs.existsSync(res.originalImagePath)).toBe(true);
      } finally {
        if (fs.existsSync(outputClean)) fs.unlinkSync(outputClean);
      }
    });

    it('localized pixel modification: touches only watermark pixels and preserves outside pixels byte-for-byte', () => {
      const W = 100, H = 100;
      const buf = Buffer.alloc(W * H * 3, 120); // filled with byte 120
      const copy = Buffer.from(buf);

      const { modifiedPixels } = WatermarkMasks.applyReverseAlphaBlend(buf, W, H, 20, 20, '48', { alphaGain: 0.60, channels: 3 });
      expect(modifiedPixels).toBeGreaterThan(0);
      expect(modifiedPixels).toBeLessThan(48 * 48);

      // Verify pixels outside the 48x48 footprint are 100% byte-for-byte identical to copy
      let outsideTouched = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (x < 20 || x >= 68 || y < 20 || y >= 68) {
            const idx = (y * W + x) * 3;
            if (buf[idx] !== 120 || buf[idx+1] !== 120 || buf[idx+2] !== 120) {
              outsideTouched++;
            }
          }
        }
      }
      expect(outsideTouched).toBe(0);
    });

    it('reverse-alpha failure preserves original without delogo fallback', async () => {
      const dummyPath = path.join(__dirname, 'test_fail_image.png');
      fs.writeFileSync(dummyPath, 'not-a-valid-image');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
        vi.spyOn(GeminiImageWatermarkDetector, 'detect').mockResolvedValue({
          detected: true,
          method: 'geometry_derived',
          confidence: 0.85,
          boundingBox: { x: 1130, y: 570, w: 52, h: 52 },
          imageDimensions: { width: 1280, height: 720 },
          variant: '48',
        });

        const res = await GeminiImagePostProcessingService.cleanImageWatermark(dummyPath);
        expect(res.success).toBe(false);
        expect(res.watermarkCleaned).toBe(false);
        expect(res.cleanImagePath).toBe(dummyPath);
        expect(res.reconstructionMethod).toBeUndefined();
        expect(res.error).toBeDefined();
        expect(res.error).not.toContain('delogo');
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
        const originalBackup = path.join(__dirname, 'test_fail_image_original.png');
        if (fs.existsSync(originalBackup)) fs.unlinkSync(originalBackup);
      }
    });
  });

  // 4. Robust Error Handling & Malformed Media
  describe('4. Robust Error Handling & Malformed Media', () => {
    it('returns graceful failure when file does not exist on disk', async () => {
      const res = await GeminiImagePostProcessingService.cleanImageWatermark('non_existent_image.png');
      expect(res.success).toBe(false);
      expect(res.error).toContain('does not exist');
    });

    it('returns graceful failure when ffmpeg binary cannot be found', async () => {
      vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue(null);
      const dummyPath = path.join(__dirname, 'test_missing_ffmpeg.png');
      fs.writeFileSync(dummyPath, 'temp');

      try {
        const res = await GeminiImagePostProcessingService.cleanImageWatermark(dummyPath);
        expect(res.success).toBe(false);
        expect(res.error).toContain('FFmpeg binary not found');
      } finally {
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
      }
    });

    it('survives corrupt image without crashing or throwing unhandled errors', async () => {
      const corruptPath = path.join(__dirname, 'test_corrupt.png');
      fs.writeFileSync(corruptPath, 'corrupted-data-not-a-real-png');

      try {
        vi.spyOn(FfmpegResolver, 'findFfmpeg').mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe');
        const res = await GeminiImagePostProcessingService.cleanImageWatermark(corruptPath, undefined, { ratio: '16:9' });
        expect(res).toBeDefined();
        expect(res.cleanImagePath).toBe(corruptPath);
      } finally {
        if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
      }
    });
  });
});
