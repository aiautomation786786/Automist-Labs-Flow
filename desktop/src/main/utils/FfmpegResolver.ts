/**
 * FfmpegResolver – Production-safe resolution and execution of FFmpeg & FFprobe.
 *
 * Responsibilities:
 *  - Discovers ffmpeg / ffprobe binaries across packaged Electron resources,
 *    environment overrides, PATH, and common Windows install directories.
 *  - Safely extracts 1-frame video posters (JPEG) for card and preview rendering.
 *  - Provides a robust fallback so thumbnail generation never fails or crashes
 *    the app even when running on a machine without FFmpeg installed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AppLogger } from './AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

/** Minimal valid 1x1 black JPEG buffer for graceful fallback poster generation */
const FALLBACK_JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x00, 0xff, 0xd9,
]);

export class FfmpegResolver {
  private static cachedFfmpegPath: string | null = null;
  private static cachedFfprobePath: string | null = null;

  /**
   * Resolves the ffmpeg executable path safely across packaged app, PATH, and disk.
   */
  static findFfmpeg(): string | null {
    if (this.cachedFfmpegPath) return this.cachedFfmpegPath;

    // 1. Explicit env override
    if (process.env['FFMPEG_PATH'] && fs.existsSync(process.env['FFMPEG_PATH'])) {
      this.cachedFfmpegPath = process.env['FFMPEG_PATH'];
      return this.cachedFfmpegPath;
    }

    // 2. Packaged Electron application resource paths
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) {
      const candidates = [
        path.join(resourcesPath, 'bin', 'ffmpeg.exe'),
        path.join(resourcesPath, 'ffmpeg.exe'),
        path.join(resourcesPath, 'app.asar.unpacked', 'bin', 'ffmpeg.exe'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          this.cachedFfmpegPath = c;
          return this.cachedFfmpegPath;
        }
      }
    }

    // 3. Common Windows install locations
    const localAppData = process.env['LOCALAPPDATA'] || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const diskCandidates = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
      path.join(localAppData, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ];

    for (const c of diskCandidates) {
      if (fs.existsSync(c)) {
        this.cachedFfmpegPath = c;
        return this.cachedFfmpegPath;
      }
    }

    // 4. Default to system PATH binary
    this.cachedFfmpegPath = 'ffmpeg';
    return this.cachedFfmpegPath;
  }

  /**
   * Resolves the ffprobe executable path safely.
   */
  static findFfprobe(): string | null {
    if (this.cachedFfprobePath) return this.cachedFfprobePath;

    if (process.env['FFPROBE_PATH'] && fs.existsSync(process.env['FFPROBE_PATH'])) {
      this.cachedFfprobePath = process.env['FFPROBE_PATH'];
      return this.cachedFfprobePath;
    }

    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) {
      const candidates = [
        path.join(resourcesPath, 'bin', 'ffprobe.exe'),
        path.join(resourcesPath, 'ffprobe.exe'),
        path.join(resourcesPath, 'app.asar.unpacked', 'bin', 'ffprobe.exe'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          this.cachedFfprobePath = c;
          return this.cachedFfprobePath;
        }
      }
    }

    const localAppData = process.env['LOCALAPPDATA'] || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const diskCandidates = [
      'C:\\ffmpeg\\bin\\ffprobe.exe',
      path.join(programFiles, 'ffmpeg', 'bin', 'ffprobe.exe'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe'),
      path.join(localAppData, 'ffmpeg', 'bin', 'ffprobe.exe'),
    ];

    for (const c of diskCandidates) {
      if (fs.existsSync(c)) {
        this.cachedFfprobePath = c;
        return this.cachedFfprobePath;
      }
    }

    this.cachedFfprobePath = 'ffprobe';
    return this.cachedFfprobePath;
  }

  /**
   * Extracts a single video frame as a JPEG poster image.
   * If FFmpeg is unavailable or fails, writes a valid fallback JPEG image
   * so card preview never hangs or errors.
   */
  static async extractPoster(videoPath: string, posterPath: string): Promise<boolean> {
    fs.mkdirSync(path.dirname(posterPath), { recursive: true });

    const ffmpegPath = this.findFfmpeg();
    if (ffmpegPath) {
      try {
        await execFileAsync(
          ffmpegPath,
          [
            '-y',
            '-ss', '00:00:00.500',
            '-i', videoPath,
            '-vframes', '1',
            '-q:v', '2',
            posterPath,
          ],
          { timeout: 12000 }
        );

        if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) {
          logger.info('ffmpeg_resolver', `Extracted video poster via FFmpeg: ${posterPath}`);
          return true;
        }
      } catch (err) {
        logger.warn('ffmpeg_resolver', 'FFmpeg poster extraction failed; using fallback', {
          error: (err as Error).message,
        });
      }
    }

    // Graceful fallback: Write valid JPEG image payload
    try {
      fs.writeFileSync(posterPath, FALLBACK_JPEG_HEADER);
      logger.info('ffmpeg_resolver', `Generated fallback video poster: ${posterPath}`);
      return true;
    } catch (fallbackErr) {
      logger.error('ffmpeg_resolver', 'Failed to write fallback poster', fallbackErr as Error);
      return false;
    }
  }

  /**
   * Generates or copies an image thumbnail file.
   */
  static async generateImageThumbnail(imagePath: string, thumbPath: string): Promise<boolean> {
    try {
      fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
      if (fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
        fs.copyFileSync(imagePath, thumbPath);
        return true;
      }
      fs.writeFileSync(thumbPath, FALLBACK_JPEG_HEADER);
      return true;
    } catch (err) {
      logger.error('ffmpeg_resolver', 'Failed to generate image thumbnail', err as Error);
      return false;
    }
  }
}
