/**
 * MediaProbeService – Low-level media validation and technical metadata inspection via ffprobe.
 *
 * Guarantees:
 *  1. Actionable Error Mapping: Clearly distinguishes missing files, empty files,
 *     corrupted headers, and audio-less media.
 *  2. Non-Destructive: Pure read-only inspection; never writes or locks the candidate media.
 *  3. Codec & Stream Verification: Accurately identifies video codec, dimensions, framerate,
 *     duration, and audio presence.
 */

import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { MediaProbeResult } from '../../shared/types';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export class MediaProbeService {
  /**
   * Probes a local video file using ffprobe.
   */
  static async probeMedia(filePath: string): Promise<MediaProbeResult> {
    if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
      return {
        valid: false,
        durationSeconds: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        hasAudio: false,
        fileSizeBytes: 0,
        error: 'No file path provided for media inspection.',
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        durationSeconds: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        hasAudio: false,
        fileSizeBytes: 0,
        error: `Source media file does not exist on disk: ${filePath}`,
      };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (err: any) {
      return {
        valid: false,
        durationSeconds: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        hasAudio: false,
        fileSizeBytes: 0,
        error: `Unable to access source media: ${err?.message || 'Access error'}`,
      };
    }

    if (stat.size === 0) {
      return {
        valid: false,
        durationSeconds: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        hasAudio: false,
        fileSizeBytes: 0,
        error: 'The selected file is empty (0 bytes). Please select a valid video.',
      };
    }

    // Check read permissions
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      return {
        valid: false,
        durationSeconds: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        hasAudio: false,
        fileSizeBytes: stat.size,
        error: `Permission denied reading media file: ${filePath}`,
      };
    }

    const ffprobeBin = FfmpegResolver.findFfprobe() || 'ffprobe';

    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name,codec_type,width,height,r_frame_rate,duration:format=duration,size',
          '-of',
          'json',
          filePath,
        ],
        { timeout: 15_000 }
      );

      const probe = JSON.parse(stdout);
      const streams: any[] = probe.streams || [];
      const format: any = probe.format || {};

      const videoStream = streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        return {
          valid: false,
          durationSeconds: 0,
          width: 0,
          height: 0,
          fps: 0,
          videoCodec: '',
          hasAudio: false,
          fileSizeBytes: stat.size,
          error: 'The selected file does not contain a valid video stream.',
        };
      }

      const audioStream = streams.find((s) => s.codec_type === 'audio');
      const hasAudio = Boolean(audioStream && audioStream.codec_name && audioStream.codec_name !== 'none');

      // Parse dimensions
      const width = parseInt(videoStream.width, 10) || 0;
      const height = parseInt(videoStream.height, 10) || 0;

      // Parse framerate
      let fps = 30;
      if (typeof videoStream.r_frame_rate === 'string' && videoStream.r_frame_rate.includes('/')) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (num && den && den > 0) {
          fps = Math.round((num / den) * 100) / 100;
        }
      }

      // Parse duration
      let durationSeconds = parseFloat(format.duration);
      if (isNaN(durationSeconds) || durationSeconds <= 0) {
        durationSeconds = parseFloat(videoStream.duration);
      }
      if (isNaN(durationSeconds) || durationSeconds < 0) {
        durationSeconds = 0;
      }

      return {
        valid: width > 0 && height > 0,
        durationSeconds: Math.round(durationSeconds * 100) / 100,
        width,
        height,
        fps,
        videoCodec: videoStream.codec_name || 'unknown',
        audioCodec: audioStream?.codec_name,
        hasAudio,
        fileSizeBytes: stat.size,
      };
    } catch (err: any) {
      logger.error('media_probe', `Failed to probe media file ${filePath}`, { error: err.message });
      return {
        valid: false,
        durationSeconds: 0,
        width: 0,
        height: 0,
        fps: 0,
        videoCodec: '',
        hasAudio: false,
        fileSizeBytes: stat.size,
        error: `Media probe failed: ${err.message?.includes('Invalid data found') ? 'Corrupted or unreadable media container' : err.message}`,
      };
    }
  }
}
