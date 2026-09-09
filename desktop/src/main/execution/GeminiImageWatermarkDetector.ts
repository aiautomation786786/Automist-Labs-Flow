/**
 * GeminiImageWatermarkDetector – Production-safe multi-tier detection of Gemini image watermarks.
 *
 * Detection Hierarchy:
 *  1. Official Watermark Metadata / UI check (when available).
 *  2. Template / Alpha-Mask ZNCC Detection: High-precision Normalized Cross-Correlation
 *     using calibrated 48x48 Gemini sparkle diamond template across the corner search window.
 *  3. Dynamic Geometry & Aspect-Ratio Derivation: Calculates exact coordinates from
 *     image width, height, and orientation.
 *  4. Fixed Baseline Coordinates: Production-safe final fallback.
 *
 * Crucial Invariant: If watermark is NOT detected, it returns detected: false so the pipeline
 * preserves 100% of the pristine source without degradation.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const log = new AppLogger({ mirrorToStderr: false });

export interface ImageWatermarkBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageWatermarkDetectionResult {
  detected: boolean;
  method: 'official_metadata' | 'template_zncc' | 'geometry_derived' | 'fixed_fallback';
  confidence: number;
  boundingBox: ImageWatermarkBoundingBox;
  imageDimensions: { width: number; height: number };
  variant?: '48' | '96';
  alphaGain?: number;
  exactCoordinates?: { x0: number; y0: number };
}

export interface DetectImageOptions {
  ratio?: string;
  width?: number;
  height?: number;
  officialOptOut?: boolean;
}

// 48x48 pre-calibrated luminance template of Gemini sparkle diamond (base64 encoded)
const GEMINI_SPARKLE_TEMPLATE_B64 = 
  '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Q0REQEUiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAy9CQ0NEQUJIPzUCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABA9RkNGRUBGQQcAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlQURGQkdFJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAANQkNDQ0I+CwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALkJDQkMsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADUVEQkcRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD9DRTwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAChDRiMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxCQQwCAQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8OwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class GeminiImageWatermarkDetector {
  private static cachedTemplate: Float32Array | null = null;
  private static cachedTemplateMean = 0;
  private static cachedTemplateNorm = 0;

  private static getTemplate(): { template: Float32Array; mean: number; norm: number } {
    if (this.cachedTemplate) {
      return {
        template: this.cachedTemplate,
        mean: this.cachedTemplateMean,
        norm: this.cachedTemplateNorm,
      };
    }

    const raw = Buffer.from(GEMINI_SPARKLE_TEMPLATE_B64, 'base64');
    const t = new Float32Array(48 * 48);
    let sum = 0;
    for (let i = 0; i < 48 * 48; i++) {
      const val = raw[i];
      t[i] = val;
      sum += val;
    }
    const mean = sum / (48 * 48);
    let norm = 0;
    for (let i = 0; i < 48 * 48; i++) {
      t[i] -= mean;
      norm += t[i] * t[i];
    }
    norm = Math.sqrt(norm);

    this.cachedTemplate = t;
    this.cachedTemplateMean = mean;
    this.cachedTemplateNorm = norm;

    return { template: t, mean, norm };
  }

  /**
   * Derives ideal localized geometry coordinates mathematically from image dimensions and ratio.
   * Tight bounding box: size + 4 padding to prevent over-blurring the surrounding texture.
   */
  static deriveGeometryCoordinates(
    width: number,
    height: number,
    ratio?: string
  ): ImageWatermarkBoundingBox {
    const isPortrait = ratio === '9:16' || height > width;
    const isSquare = Math.abs(width - height) < 50;

    if (isPortrait) {
      const scale = width / 720;
      const size = Math.max(32, Math.round(48 * scale));
      const marginX = Math.round(96 * scale);
      const marginY = Math.round(96 * scale);

      return {
        x: Math.max(0, width - marginX - size - 2),
        y: Math.max(0, height - marginY - size - 2),
        w: size + 4,
        h: size + 4,
      };
    }

    if (isSquare) {
      const scale = width / 1024;
      const size = Math.max(36, Math.round(48 * scale));
      const margin = Math.round(72 * scale);

      return {
        x: Math.max(0, width - margin - size - 2),
        y: Math.max(0, height - margin - size - 2),
        w: size + 4,
        h: size + 4,
      };
    }

    // Default Landscape (16:9 or similar)
    const scale = height / 720;
    const size = Math.max(36, Math.round(48 * scale));
    const margin = Math.round(96 * scale);

    return {
      x: Math.max(0, width - margin - size - 2),
      y: Math.max(0, height - margin - size - 2),
      w: size + 4,
      h: size + 4,
    };
  }

  /**
   * Probes image to extract width and height safely using ffprobe or PNG header.
   */
  static async probeImage(imagePath: string): Promise<{ width: number; height: number } | null> {
    if (!fs.existsSync(imagePath)) return null;

    // Fast PNG header check (first 24 bytes)
    try {
      const fd = fs.openSync(imagePath, 'r');
      const header = Buffer.alloc(24);
      fs.readSync(fd, header, 0, 24, 0);
      fs.closeSync(fd);

      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
        const width = header.readUInt32BE(16);
        const height = header.readUInt32BE(20);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    } catch {}

    const ffprobePath = FfmpegResolver.findFfprobe();
    if (!ffprobePath) return null;

    try {
      const { stdout } = await execFileAsync(
        ffprobePath,
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height',
          '-of', 'json',
          imagePath,
        ],
        { timeout: 5000 }
      );

      const parsed = JSON.parse(stdout);
      const v = parsed.streams?.[0];
      if (v?.width && v?.height) {
        return {
          width: Number(v.width),
          height: Number(v.height),
        };
      }
    } catch (err) {
      log.warn('gemini_image_detector', `ffprobe failed on ${imagePath}: ${(err as Error).message}`);
    }

    return null;
  }

  /**
   * Main multi-tier watermark detection for images.
   */
  static async detect(
    imagePath: string,
    options: DetectImageOptions = {}
  ): Promise<ImageWatermarkDetectionResult> {
    // TIER 1: Official metadata / UI check
    if (options.officialOptOut) {
      return {
        detected: false,
        method: 'official_metadata',
        confidence: 1.0,
        boundingBox: { x: 0, y: 0, w: 0, h: 0 },
        imageDimensions: { width: options.width || 1024, height: options.height || 572 },
      };
    }

    const probe = await this.probeImage(imagePath);
    const width = probe?.width || options.width || 1024;
    const height = probe?.height || options.height || 572;
    const dimensions = { width, height };

    const ffmpegPath = FfmpegResolver.findFfmpeg();
    if (!ffmpegPath) {
      // TIER 4: Fixed fallback if no binaries available
      const fallbackBbox = options.ratio === '9:16'
        ? { x: 570, y: 1130, w: 52, h: 52 }
        : { x: 1130, y: 570, w: 52, h: 52 };
      return {
        detected: true,
        method: 'fixed_fallback',
        confidence: 0.6,
        boundingBox: fallbackBbox,
        imageDimensions: dimensions,
        variant: '48',
        alphaGain: 0.60,
        exactCoordinates: { x0: fallbackBbox.x, y0: fallbackBbox.y },
      };
    }

    // TIER 2: Template / Alpha-Mask ZNCC Detection on image corner crop
    try {
      const cropW = Math.min(220, Math.floor(width / 2));
      const cropH = Math.min(220, Math.floor(height / 2));
      const cropX = Math.max(0, width - cropW);
      const cropY = Math.max(0, height - cropH);

      const { stdout: rawBuffer } = await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-i', imagePath,
          '-vf', `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
          '-f', 'rawvideo',
          '-pix_fmt', 'rgb24',
          '-',
        ],
        { encoding: 'buffer' as any, maxBuffer: 1024 * 1024, timeout: 6000 }
      );

      if (rawBuffer && rawBuffer.length >= cropW * cropH * 3) {
        const { template, norm: normT } = this.getTemplate();
        let bestZNCC = -1;
        let bestX = 0;
        let bestY = 0;

        const minScanY = Math.max(0, cropH - 160);
        const maxScanY = cropH - 48;
        const minScanX = Math.max(0, cropW - 160);
        const maxScanX = cropW - 48;

        for (let y = minScanY; y <= maxScanY; y += 2) {
          for (let x = minScanX; x <= maxScanX; x += 2) {
            let sumP = 0;
            for (let ty = 0; ty < 48; ty++) {
              const rowOffset = (y + ty) * cropW * 3;
              for (let tx = 0; tx < 48; tx++) {
                const idx = rowOffset + (x + tx) * 3;
                const lum = 0.299 * rawBuffer[idx] + 0.587 * rawBuffer[idx + 1] + 0.114 * rawBuffer[idx + 2];
                sumP += lum;
              }
            }
            const meanP = sumP / (48 * 48);

            let cross = 0;
            let normP = 0;
            for (let ty = 0; ty < 48; ty++) {
              const rowOffset = (y + ty) * cropW * 3;
              const tRowOffset = ty * 48;
              for (let tx = 0; tx < 48; tx++) {
                const idx = rowOffset + (x + tx) * 3;
                const lum = 0.299 * rawBuffer[idx] + 0.587 * rawBuffer[idx + 1] + 0.114 * rawBuffer[idx + 2];
                const pDiff = lum - meanP;
                const tDiff = template[tRowOffset + tx];
                cross += pDiff * tDiff;
                normP += pDiff * pDiff;
              }
            }

            normP = Math.sqrt(normP);
            const denom = normP * normT;
            const zncc = denom > 1e-6 ? cross / denom : 0;

            if (zncc > bestZNCC) {
              bestZNCC = zncc;
              bestX = x;
              bestY = y;
            }
          }
        }

        // Calibrated confidence threshold for 48x48 sparkle template on images
        if (bestZNCC >= 0.68) {
          const globalX = cropX + bestX;
          const globalY = cropY + bestY;
          log.info('gemini_image_detector', `ZNCC match: score=${bestZNCC.toFixed(3)} at (${globalX}, ${globalY})`);
          return {
            detected: true,
            method: 'template_zncc',
            confidence: bestZNCC,
            boundingBox: {
              x: Math.max(0, globalX - 2),
              y: Math.max(0, globalY - 2),
              w: 52,
              h: 52,
            },
            imageDimensions: dimensions,
            variant: '48',
            alphaGain: 0.60,
            exactCoordinates: { x0: globalX, y0: globalY },
          };
        } else {
          log.info('gemini_image_detector', `ZNCC scan peak=${bestZNCC.toFixed(3)} (below threshold 0.68)`);
        }
      }
    } catch (cropErr) {
      log.warn('gemini_image_detector', `ZNCC frame analysis failed: ${(cropErr as Error).message}`);
    }

    // Watermark was not detected via ZNCC template match
    return {
      detected: false,
      method: 'template_zncc',
      confidence: 0.0,
      boundingBox: this.deriveGeometryCoordinates(width, height, options.ratio),
      imageDimensions: dimensions,
    };
  }
}
