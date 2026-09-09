/**
 * GeminiWatermarkDetector – Production-safe multi-tier detection of Gemini video watermarks.
 *
 * Detection Hierarchy:
 *  1. Official Watermark Metadata / UI check (when available).
 *  2. Template / Alpha-Mask ZNCC Detection: High-precision Normalized Cross-Correlation
 *     using calibrated 48x48 Gemini sparkle diamond template.
 *  3. Dynamic Geometry & Aspect-Ratio Derivation: Calculates exact coordinates from
 *     video width, height, and orientation.
 *  4. Fixed Baseline Coordinates: Production-safe final fallback.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const log = new AppLogger({ mirrorToStderr: false });

export interface WatermarkBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WatermarkDetectionResult {
  detected: boolean;
  method: 'official_metadata' | 'template_zncc' | 'geometry_derived' | 'fixed_fallback';
  confidence: number;
  boundingBox: WatermarkBoundingBox;
  videoDimensions: { width: number; height: number };
  durationSeconds?: number;
  variant?: '48' | '96';
  alphaGain?: number;
  exactCoordinates?: { x0: number; y0: number };
}

export interface DetectOptions {
  ratio?: string;
  width?: number;
  height?: number;
  officialOptOut?: boolean;
}

// 48x48 pre-calibrated luminance template of Gemini sparkle diamond (base64 encoded)
const GEMINI_SPARKLE_TEMPLATE_B64 = 
  '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Q0REQEUiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAy9CQ0NEQUJIPzUCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABA9RkNGRUBGQQcAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlQURGQkdFJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAANQkNDQ0I+CwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALkJDQkMsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADUVEQkcRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD9DRTwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAChDRiMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxCQQwCAQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8OwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class GeminiWatermarkDetector {
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
   * Derives ideal geometry coordinates mathematically from dimensions and ratio.
   */
  static deriveGeometryCoordinates(
    width: number,
    height: number,
    ratio?: string
  ): WatermarkBoundingBox {
    const isPortrait = ratio === '9:16' || height > width;

    if (isPortrait) {
      const scale = width / 720;
      const size = Math.round(48 * scale);
      const marginX = Math.round(96 * scale);
      const marginY = Math.round(96 * scale);

      return {
        x: Math.max(0, width - marginX - size - 2),
        y: Math.max(0, height - marginY - size - 2),
        w: size + 4,
        h: size + 4,
      };
    }

    // Landscape (16:9)
    const scale = height / 720;
    const size = Math.round(48 * scale);
    const margin = Math.round(96 * scale);

    return {
      x: Math.max(0, width - margin - size - 2),
      y: Math.max(0, height - margin - size - 2),
      w: size + 4,
      h: size + 4,
    };
  }

  /**
   * Probes video stream to extract width, height, duration safely.
   */
  static async probeVideo(videoPath: string): Promise<{ width: number; height: number; duration: number } | null> {
    const ffprobePath = FfmpegResolver.findFfprobe();
    if (!ffprobePath) return null;

    try {
      const { stdout } = await execFileAsync(
        ffprobePath,
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,duration',
          '-of', 'json',
          videoPath,
        ],
        { timeout: 8000 }
      );

      const parsed = JSON.parse(stdout);
      const v = parsed.streams?.[0];
      if (v?.width && v?.height) {
        return {
          width: Number(v.width),
          height: Number(v.height),
          duration: parseFloat(v.duration || '10.0'),
        };
      }
    } catch (err) {
      log.warn('gemini_watermark_detector', `ffprobe failed on ${videoPath}: ${(err as Error).message}`);
    }

    return null;
  }

  /**
   * Main multi-tier watermark detection.
   */
  static async detect(
    videoPath: string,
    options: DetectOptions = {}
  ): Promise<WatermarkDetectionResult> {
    // TIER 1: Official metadata / UI setting check
    if (options.officialOptOut) {
      return {
        detected: false,
        method: 'official_metadata',
        confidence: 1.0,
        boundingBox: { x: 0, y: 0, w: 0, h: 0 },
        videoDimensions: { width: options.width || 1280, height: options.height || 720 },
      };
    }

    const probe = await this.probeVideo(videoPath);
    const width = probe?.width || options.width || 1280;
    const height = probe?.height || options.height || 720;
    const duration = probe?.duration || 10.0;
    const dimensions = { width, height };

    const ffmpegPath = FfmpegResolver.findFfmpeg();
    if (!ffmpegPath) {
      // TIER 4: Fixed fallback if no binaries available
      const fallbackBbox = options.ratio === '9:16'
        ? { x: 570, y: 1130, w: 60, h: 60 }
        : { x: 1130, y: 570, w: 60, h: 60 };
      return {
        detected: true,
        method: 'fixed_fallback',
        confidence: 0.6,
        boundingBox: fallbackBbox,
        videoDimensions: dimensions,
        durationSeconds: duration,
      };
    }

    // TIER 2: Template / Alpha-Mask ZNCC Detection
    try {
      const cropW = 200;
      const cropH = 200;
      const cropX = Math.max(0, width - cropW);
      const cropY = Math.max(0, height - cropH);
      const sampleTime = duration > 1.5 ? '00:00:01.000' : '00:00:00.200';

      const { stdout: rawBuffer } = await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-ss', sampleTime,
          '-i', videoPath,
          '-vf', `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
          '-vframes', '1',
          '-f', 'rawvideo',
          '-pix_fmt', 'rgb24',
          '-',
        ],
        { encoding: 'buffer' as any, maxBuffer: 1024 * 1024, timeout: 8000 }
      );

      if (rawBuffer && rawBuffer.length >= cropW * cropH * 3) {
        const { template, norm: normT } = this.getTemplate();
        let bestZNCC = -1;
        let bestX = 0;
        let bestY = 0;

        // Search window in the bottom-right quadrant of the crop
        const minScanY = Math.max(0, cropH - 160);
        const maxScanY = cropH - 48;
        const minScanX = Math.max(0, cropW - 160);
        const maxScanX = cropW - 48;

        for (let dy = minScanY; dy <= maxScanY; dy += 2) {
          for (let dx = minScanX; dx <= maxScanX; dx += 2) {
            let sumP = 0;
            for (let ty = 0; ty < 48; ty += 2) {
              for (let tx = 0; tx < 48; tx += 2) {
                const idx = ((dy + ty) * cropW + (dx + tx)) * 3;
                sumP += 0.299 * rawBuffer[idx] + 0.587 * rawBuffer[idx + 1] + 0.114 * rawBuffer[idx + 2];
              }
            }
            const meanP = sumP / (24 * 24);

            let dot = 0;
            let normP = 0;
            for (let ty = 0; ty < 48; ty += 2) {
              for (let tx = 0; tx < 48; tx += 2) {
                const idx = ((dy + ty) * cropW + (dx + tx)) * 3;
                const pVal = (0.299 * rawBuffer[idx] + 0.587 * rawBuffer[idx + 1] + 0.114 * rawBuffer[idx + 2]) - meanP;
                const tVal = template[ty * 48 + tx];
                dot += pVal * tVal;
                normP += pVal * pVal;
              }
            }

            const zncc = dot / (normP > 0 ? (normT * Math.sqrt(normP)) : 1);
            if (zncc > bestZNCC) {
              bestZNCC = zncc;
              bestX = dx;
              bestY = dy;
            }
          }
        }

        log.info('gemini_watermark_detector', `ZNCC search on ${videoPath}: bestScore=${bestZNCC.toFixed(4)} at crop(${bestX}, ${bestY})`);

        // If high correlation, confirmed detection
        if (bestZNCC >= 0.40) {
          const globalX = cropX + bestX;
          const globalY = cropY + bestY;
          // Add 2px padding for clean delogo bounds
          const boundingBox: WatermarkBoundingBox = {
            x: Math.max(0, globalX - 2),
            y: Math.max(0, globalY - 2),
            w: 52,
            h: 52,
          };

          return {
            detected: true,
            method: 'template_zncc',
            confidence: bestZNCC,
            boundingBox,
            videoDimensions: dimensions,
            durationSeconds: duration,
            variant: width >= 1080 && height >= 1080 ? '96' : '48',
            alphaGain: 0.60,
            exactCoordinates: { x0: globalX, y0: globalY },
          };
        }

        // If low correlation (< 0.22), no watermark present
        if (bestZNCC < 0.22) {
          return {
            detected: false,
            method: 'template_zncc',
            confidence: 1 - bestZNCC,
            boundingBox: { x: 0, y: 0, w: 0, h: 0 },
            videoDimensions: dimensions,
            durationSeconds: duration,
          };
        }
      }
    } catch (err) {
      log.warn('gemini_watermark_detector', `ZNCC template detection encountered error: ${(err as Error).message}`);
    }

    // TIER 3: Geometry & Aspect-Ratio Derivation
    const geomBox = this.deriveGeometryCoordinates(width, height, options.ratio);
    const isPortrait = options.ratio === '9:16' || height > width;
    const geomVariant: '48' | '96' = width >= 1080 && height >= 1080 ? '96' : '48';
    const scale = isPortrait ? width / 720 : height / 720;
    const geomSize = Math.round(48 * scale);
    const geomMargin = Math.round(96 * scale);
    const x0 = Math.max(0, width - geomMargin - geomSize);
    const y0 = Math.max(0, height - geomMargin - geomSize);

    return {
      detected: true,
      method: 'geometry_derived',
      confidence: 0.85,
      boundingBox: geomBox,
      videoDimensions: dimensions,
      durationSeconds: duration,
      variant: geomVariant,
      alphaGain: 0.60,
      exactCoordinates: { x0, y0 },
    };
  }
}
