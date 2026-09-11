import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FinalAssemblyService } from '../main/render/FinalAssemblyService';
import { SceneRenderer } from '../main/render/SceneRenderer';
import type { SceneClipInfo } from '../main/render/FinalRenderTypes';

const execFileAsync = promisify(execFile);

describe('FinalAssemblyService (Real FFmpeg Execution)', () => {
  let tempDir: string;
  let sceneClips: SceneClipInfo[] = [];
  let shortMusicPath: string;
  let longMusicPath: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly_service_test_'));
    const ffmpegBin = SceneRenderer.getFfmpegPath();

    // Generate 3 small valid test video clips with audio:
    // Scene 1: 2.0s, red screen with 440Hz tone
    // Scene 2: 2.0s, green screen with 550Hz tone
    // Scene 3: 2.0s, blue screen with 660Hz tone
    const colors = ['red', 'green', 'blue'];
    const freqs = [440, 550, 660];

    for (let i = 0; i < 3; i++) {
      const clipPath = path.join(tempDir, `scene-${String(i + 1).padStart(3, '0')}.mp4`);
      await execFileAsync(ffmpegBin, [
        '-y',
        '-f', 'lavfi',
        '-i', `color=c=${colors[i]}:s=320x240:r=25:d=2.0`,
        '-f', 'lavfi',
        '-i', `sine=f=${freqs[i]}:d=2.0`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        clipPath,
      ]);

      sceneClips.push({
        sceneNumber: i + 1,
        videoPath: clipPath,
        durationSeconds: 2.0,
      });
    }

    // Generate short music (1.5s, shorter than 6.0s video total) to test looping
    shortMusicPath = path.join(tempDir, 'short_bgm.mp3');
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=f=220:d=1.5',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      shortMusicPath,
    ]);

    // Generate long music (10.0s, longer than 6.0s video total) to test trimming
    longMusicPath = path.join(tempDir, 'long_bgm.mp3');
    await execFileAsync(ffmpegBin, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=f=330:d=10.0',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      longMusicPath,
    ]);
  }, 40000);

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('assembles 3 scenes with Hard Cut concat and validates output', async () => {
    const outputVideoPath = path.join(tempDir, 'hard_cut_final.mp4');
    const outputThumbnailPath = path.join(tempDir, 'hard_cut_thumb.jpg');
    const outputPosterPath = path.join(tempDir, 'hard_cut_poster.jpg');

    const progressEvents: string[] = [];

    const result = await FinalAssemblyService.assembleFinalVideo({
      projectId: 'proj_test_hc',
      sceneClips,
      outputVideoPath,
      outputThumbnailPath,
      outputPosterPath,
      options: {
        transitionStyle: 'hard_cut',
      },
      onProgress: (ev) => progressEvents.push(ev.status),
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputVideoPath)).toBe(true);
    expect(fs.existsSync(outputThumbnailPath)).toBe(true);
    expect(fs.existsSync(outputPosterPath)).toBe(true);

    // Duration should be approximately 3 * 2.0s = 6.0s
    expect(result.durationSeconds).toBeGreaterThanOrEqual(5.8);
    expect(result.durationSeconds).toBeLessThanOrEqual(6.3);

    // Check codecs and dimensions
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);

    // Verify progress progression
    expect(progressEvents).toContain('preparing');
    expect(progressEvents).toContain('muxing');
    expect(progressEvents).toContain('validating');
    expect(progressEvents).toContain('generating_thumbnail');
    expect(progressEvents).toContain('completed');
  }, 35000);

  it('assembles 3 scenes with Cross Fade (xfade/acrossfade) and validates duration', async () => {
    const outputVideoPath = path.join(tempDir, 'cross_fade_final.mp4');
    const outputThumbnailPath = path.join(tempDir, 'cross_fade_thumb.jpg');
    const outputPosterPath = path.join(tempDir, 'cross_fade_poster.jpg');

    const result = await FinalAssemblyService.assembleFinalVideo({
      projectId: 'proj_test_xf',
      sceneClips,
      outputVideoPath,
      outputThumbnailPath,
      outputPosterPath,
      options: {
        transitionStyle: 'cross_fade',
        crossfadeDuration: 0.5,
      },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputVideoPath)).toBe(true);

    // Expected duration = 2.0 + 2.0 + 2.0 - (2 * 0.5) = 5.0s
    expect(result.durationSeconds).toBeGreaterThanOrEqual(4.8);
    expect(result.durationSeconds).toBeLessThanOrEqual(5.3);

    const probe = await FinalAssemblyService.validateFinalVideo(outputVideoPath);
    expect(probe.valid).toBe(true);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
  }, 35000);

  it('assembles with background music shorter than video and tests looping & ducking', async () => {
    const outputVideoPath = path.join(tempDir, 'bgm_loop_final.mp4');
    const outputThumbnailPath = path.join(tempDir, 'bgm_loop_thumb.jpg');
    const outputPosterPath = path.join(tempDir, 'bgm_loop_poster.jpg');

    const result = await FinalAssemblyService.assembleFinalVideo({
      projectId: 'proj_test_bgm_loop',
      sceneClips,
      outputVideoPath,
      outputThumbnailPath,
      outputPosterPath,
      options: {
        transitionStyle: 'hard_cut',
        musicPath: shortMusicPath,
        musicEnabled: true,
        musicVolume: 0.20,
        duckingEnabled: true,
      },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputVideoPath)).toBe(true);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(5.8);

    // Verify music metadata returned
    expect(result.musicTrack).toBeDefined();
    expect(result.musicTrack?.looped).toBe(true);
    expect(result.musicTrack?.duckingEnabled).toBe(true);
    expect(result.musicTrack?.volume).toBe(0.20);
  }, 35000);

  it('assembles with background music longer than video and tests trimming', async () => {
    const outputVideoPath = path.join(tempDir, 'bgm_trim_final.mp4');
    const outputThumbnailPath = path.join(tempDir, 'bgm_trim_thumb.jpg');
    const outputPosterPath = path.join(tempDir, 'bgm_trim_poster.jpg');

    const result = await FinalAssemblyService.assembleFinalVideo({
      projectId: 'proj_test_bgm_trim',
      sceneClips,
      outputVideoPath,
      outputThumbnailPath,
      outputPosterPath,
      options: {
        transitionStyle: 'hard_cut',
        musicPath: longMusicPath,
        musicEnabled: true,
        musicVolume: 0.30,
        duckingEnabled: true,
      },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputVideoPath)).toBe(true);
    // Duration must match video duration (~6.0s), NOT the 10.0s music duration!
    expect(result.durationSeconds).toBeGreaterThanOrEqual(5.8);
    expect(result.durationSeconds).toBeLessThanOrEqual(6.3);
  }, 35000);

  it('throws error when sceneClips is empty', async () => {
    await expect(
      FinalAssemblyService.assembleFinalVideo({
        projectId: 'empty_proj',
        sceneClips: [],
        outputVideoPath: path.join(tempDir, 'empty.mp4'),
        outputThumbnailPath: path.join(tempDir, 'empty_thumb.jpg'),
        outputPosterPath: path.join(tempDir, 'empty_poster.jpg'),
        options: {},
      })
    ).rejects.toThrow('has no scene clips');
  });

  it('throws error when a scene clip file is missing on disk', async () => {
    await expect(
      FinalAssemblyService.assembleFinalVideo({
        projectId: 'missing_clip_proj',
        sceneClips: [
          {
            sceneNumber: 1,
            videoPath: path.join(tempDir, 'non_existent_scene.mp4'),
            durationSeconds: 2.0,
          },
        ],
        outputVideoPath: path.join(tempDir, 'missing.mp4'),
        outputThumbnailPath: path.join(tempDir, 'missing_thumb.jpg'),
        outputPosterPath: path.join(tempDir, 'missing_poster.jpg'),
        options: {},
      })
    ).rejects.toThrow('video clip not found');
  });

  it('aborts cleanly when signal is triggered', async () => {
    const abortController = new AbortController();
    abortController.abort(); // pre-aborted

    await expect(
      FinalAssemblyService.assembleFinalVideo({
        projectId: 'abort_proj',
        sceneClips,
        outputVideoPath: path.join(tempDir, 'aborted.mp4'),
        outputThumbnailPath: path.join(tempDir, 'aborted_thumb.jpg'),
        outputPosterPath: path.join(tempDir, 'aborted_poster.jpg'),
        options: {},
        signal: abortController.signal,
      })
    ).rejects.toThrow('cancelled');
  });
});
