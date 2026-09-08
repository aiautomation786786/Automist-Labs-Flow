/**
 * VideoDuration – Extracts duration from video files using ffprobe with pure MP4 box parser fallback.
 */

import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AppLogger } from './AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export interface VideoDurationResult {
  durationSeconds: number;
  durationFormatted: string; // e.g. "4.0s"
  method: 'ffprobe' | 'internal_parser';
}

/**
 * Searches for ffprobe in common Windows paths or PATH.
 */
function findFfprobe(): string | null {
  const candidates = [
    'ffprobe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
  ];

  for (const p of candidates) {
    if (p === 'ffprobe') continue; // Will be tested in execution
    if (fs.existsSync(p)) return p;
  }
  return 'ffprobe';
}

/**
 * Pure Node.js MP4 container parser to extract duration from 'mvhd' atom.
 */
export function parseMp4DurationFromBuffer(buffer: Buffer): number | null {
  try {
    let offset = 0;
    while (offset < buffer.length - 8) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);

      if (size === 0) {
        // Extends to end of file
        size = buffer.length - offset;
      } else if (size === 1) {
        // 64-bit large size
        if (offset + 16 > buffer.length) break;
        size = Number(buffer.readBigUInt64BE(offset + 8));
      }

      if (type === 'moov') {
        // Parse inside moov
        const moovEnd = Math.min(offset + size, buffer.length);
        let innerOffset = offset + 8;
        while (innerOffset < moovEnd - 8) {
          const innerSize = buffer.readUInt32BE(innerOffset);
          const innerType = buffer.toString('ascii', innerOffset + 4, innerOffset + 8);

          if (innerType === 'mvhd') {
            const version = buffer.readUInt8(innerOffset + 8);
            let timescale: number;
            let duration: number;

            if (version === 0) {
              timescale = buffer.readUInt32BE(innerOffset + 8 + 4 + 4 + 4);
              duration = buffer.readUInt32BE(innerOffset + 8 + 4 + 4 + 4 + 4);
            } else {
              timescale = buffer.readUInt32BE(innerOffset + 8 + 4 + 8 + 8);
              duration = Number(buffer.readBigUInt64BE(innerOffset + 8 + 4 + 8 + 8 + 4));
            }

            if (timescale > 0 && duration > 0) {
              return duration / timescale;
            }
          }
          if (innerSize <= 0) break;
          innerOffset += innerSize;
        }
      }

      if (size <= 0) break;
      offset += size;
    }
  } catch (err) {
    logger.warn('video_duration', 'Internal MP4 parser encountered error', { error: (err as Error).message });
  }
  return null;
}

export class VideoDuration {
  /**
   * Probes the video file duration using ffprobe first, falling back to internal MP4 box parser.
   */
  static async getDuration(filePath: string): Promise<VideoDurationResult | null> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Video file does not exist: ${filePath}`);
    }

    // Attempt 1: ffprobe
    const ffprobePath = findFfprobe();
    if (ffprobePath) {
      try {
        const { stdout } = await execFileAsync(ffprobePath, [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          filePath,
        ], { timeout: 10000 });

        const parsed = parseFloat(stdout.trim());
        if (!isNaN(parsed) && parsed > 0) {
          return {
            durationSeconds: parsed,
            durationFormatted: `${parsed.toFixed(1)}s`,
            method: 'ffprobe',
          };
        }
      } catch {
        // ffprobe failed or not installed in PATH, fall through to internal parser
      }
    }

    // Attempt 2: Internal MP4 box parser
    try {
      const buffer = fs.readFileSync(filePath);
      const parsedSeconds = parseMp4DurationFromBuffer(buffer);
      if (parsedSeconds !== null && parsedSeconds > 0) {
        return {
          durationSeconds: parsedSeconds,
          durationFormatted: `${parsedSeconds.toFixed(1)}s`,
          method: 'internal_parser',
        };
      }
    } catch (err) {
      logger.warn('video_duration', 'Internal duration extraction failed', { error: (err as Error).message });
    }

    return null;
  }
}
