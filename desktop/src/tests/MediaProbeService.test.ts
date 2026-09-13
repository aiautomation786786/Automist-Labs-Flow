import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { MediaProbeService } from '../main/import/MediaProbeService';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('MediaProbeService', () => {
  let tmpDir: string;
  let ffmpegBin: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media_probe_test_'));
    ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  it('probes valid MP4 with video and audio tracks accurately', async () => {
    const videoPath = path.join(tmpDir, 'valid_test.mp4');
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=blue:s=320x240:r=25:d=2.0',
        '-f', 'lavfi',
        '-i', 'sine=f=440:d=2.0',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        videoPath,
      ],
      { stdio: 'ignore' }
    );

    const probe = await MediaProbeService.probeMedia(videoPath);
    expect(probe.valid).toBe(true);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.durationSeconds).toBeGreaterThan(1.8);
    expect(probe.durationSeconds).toBeLessThan(2.2);
    expect(probe.hasAudio).toBe(true);
    expect(probe.audioCodec).toBe('aac');
    expect(probe.fileSizeBytes).toBeGreaterThan(0);
    expect(probe.error).toBeUndefined();
  });

  it('probes media without audio track and reports hasAudio = false', async () => {
    const videoPath = path.join(tmpDir, 'silent_test.mp4');
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=red:s=640x360:r=30:d=1.0',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        videoPath,
      ],
      { stdio: 'ignore' }
    );

    const probe = await MediaProbeService.probeMedia(videoPath);
    expect(probe.valid).toBe(true);
    expect(probe.width).toBe(640);
    expect(probe.height).toBe(360);
    expect(probe.hasAudio).toBe(false);
    expect(probe.audioCodec).toBeUndefined();
  });

  it('fails gracefully with actionable error when file does not exist', async () => {
    const missingPath = path.join(tmpDir, 'does_not_exist.mp4');
    const probe = await MediaProbeService.probeMedia(missingPath);
    expect(probe.valid).toBe(false);
    expect(probe.error).toContain('does not exist');
  });

  it('fails gracefully when file is 0 bytes', async () => {
    const emptyPath = path.join(tmpDir, 'empty.mp4');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));

    const probe = await MediaProbeService.probeMedia(emptyPath);
    expect(probe.valid).toBe(false);
    expect(probe.error).toContain('0 bytes');
  });

  it('fails gracefully when file is non-video plain text', async () => {
    const textPath = path.join(tmpDir, 'not_video.mp4');
    fs.writeFileSync(textPath, 'This is plain text pretending to be an mp4.');

    const probe = await MediaProbeService.probeMedia(textPath);
    expect(probe.valid).toBe(false);
    expect(probe.error).toBeDefined();
  });
});
