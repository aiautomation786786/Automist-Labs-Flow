/**
 * AudioDurationMeasurer – 3-tier duration measurement for synthesized narration audio.
 *
 * Tiers:
 *  1. Primary: Native ffprobe execution (exact millisecond duration).
 *  2. Secondary: Edge TTS word timing offset + duration.
 *  3. Tertiary: MP3 frame header / bit-rate estimation fallback.
 */

import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WordTiming } from './TtsTypes';

const execFileAsync = promisify(execFile);

export class AudioDurationMeasurer {
  private static ffprobePathCache: string | null = null;
  private static ffprobeChecked = false;

  /**
   * Discovers the ffprobe executable location.
   */
  static getFfprobePath(): string | null {
    if (this.ffprobeChecked) {
      return this.ffprobePathCache;
    }

    const candidates = [
      'C:\\ffmpeg\\bin\\ffprobe.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
      'ffprobe.exe',
      'ffprobe',
    ];

    for (const cand of candidates) {
      if (cand.includes('\\') || cand.includes('/')) {
        if (fs.existsSync(cand)) {
          this.ffprobePathCache = cand;
          this.ffprobeChecked = true;
          return cand;
        }
      }
    }

    // Default to 'ffprobe' on system PATH
    this.ffprobePathCache = 'ffprobe';
    this.ffprobeChecked = true;
    return 'ffprobe';
  }

  /**
   * Measures the duration of an audio file in seconds.
   */
  static async measureDurationSeconds(
    audioFilePath: string,
    options?: {
      wordTimings?: WordTiming[];
      fallbackBitrateKbps?: number;
    }
  ): Promise<number> {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Cannot measure duration: audio file not found at ${audioFilePath}`);
    }

    // 1. Try ffprobe (Primary)
    const ffprobeBin = this.getFfprobePath();
    if (ffprobeBin) {
      try {
        const { stdout } = await execFileAsync(ffprobeBin, [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          audioFilePath,
        ], { timeout: 5000 });

        const parsed = parseFloat(stdout.trim());
        if (!isNaN(parsed) && parsed > 0) {
          // Round to 2 decimal places (e.g. 7.03s)
          return Math.round(parsed * 100) / 100;
        }
      } catch (err) {
        // ffprobe not available or failed; proceed to fallbacks
      }
    }

    // 2. Try Word Timings (Secondary)
    if (options?.wordTimings && options.wordTimings.length > 0) {
      const lastTiming = options.wordTimings[options.wordTimings.length - 1];
      if (lastTiming) {
        const totalMs = lastTiming.startMs + lastTiming.durationMs;
        if (totalMs > 0) {
          return Math.round((totalMs / 1000) * 100) / 100;
        }
      }
    }

    // 3. Bitrate estimation fallback (Tertiary)
    // Default format is audio-24khz-48kbitrate-mono-mp3 = 48 kbps = 6,000 bytes/sec
    try {
      const stat = fs.statSync(audioFilePath);
      const bitrateKbps = options?.fallbackBitrateKbps || 48;
      const bytesPerSecond = (bitrateKbps * 1000) / 8;
      const estimated = stat.size / bytesPerSecond;
      return Math.max(1, Math.round(estimated * 100) / 100);
    } catch {
      return 3.0; // Minimal default
    }
  }
}
