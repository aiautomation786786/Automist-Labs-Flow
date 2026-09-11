import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { TransitionService } from '../main/render/TransitionService';
import { SceneRenderer } from '../main/render/SceneRenderer';

describe('TransitionService', () => {
  let tempDir: string;
  let sceneAPath: string;
  let sceneBPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-test-'));
    sceneAPath = path.join(tempDir, 'scene-a.mp4');
    sceneBPath = path.join(tempDir, 'scene-b.mp4');

    // Create real 2.0s Scene A (Blue color + 440Hz sine tone)
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:d=2.0',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k',
      sceneAPath,
    ], { stdio: 'ignore' });

    // Create real 2.0s Scene B (Green color + 880Hz sine tone)
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=green:s=1280x720:d=2.0',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2.0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k',
      sceneBPath,
    ], { stdio: 'ignore' });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Renders a clean Hard Cut transition between two scenes', async () => {
    const outputPath = path.join(tempDir, 'hard_cut_output.mp4');

    const result = await TransitionService.renderTransitionPreview({
      sceneAVideoPath: sceneAPath,
      sceneBVideoPath: sceneBPath,
      outputPath,
      transitionStyle: 'hard_cut',
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);

    const probe = await SceneRenderer.probeMedia(outputPath);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    // 2.0s + 2.0s = ~4.0s
    expect(probe.durationSeconds).toBeCloseTo(4.0, 1);
  });

  it('2. Renders a smooth Cross Fade transition between two scenes with xfade + acrossfade', async () => {
    const outputPath = path.join(tempDir, 'cross_fade_output.mp4');
    const transDuration = 0.5;

    const result = await TransitionService.renderTransitionPreview({
      sceneAVideoPath: sceneAPath,
      sceneBVideoPath: sceneBPath,
      outputPath,
      transitionStyle: 'cross_fade',
      duration: transDuration,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);

    const probe = await SceneRenderer.probeMedia(outputPath);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    // In cross fade: total duration = durA + durB - transDuration = 2.0 + 2.0 - 0.5 = 3.5s
    expect(probe.durationSeconds).toBeCloseTo(3.5, 1);
  });

  it('3. Throws when input files do not exist', async () => {
    const missing = path.join(tempDir, 'non_existent.mp4');
    const outputPath = path.join(tempDir, 'output.mp4');

    await expect(
      TransitionService.renderTransitionPreview({
        sceneAVideoPath: missing,
        sceneBVideoPath: sceneBPath,
        outputPath,
        transitionStyle: 'cross_fade',
      })
    ).rejects.toThrow(/not found/i);
  });
});
