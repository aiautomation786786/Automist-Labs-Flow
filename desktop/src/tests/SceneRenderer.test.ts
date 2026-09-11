import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { SceneRenderer } from '../main/render/SceneRenderer';
import { SubtitleGenerator } from '../main/render/SubtitleGenerator';

describe('SceneRenderer', () => {
  let tempDir: string;
  let testImagePath: string;
  let testAudioPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-renderer-test-'));
    testImagePath = path.join(tempDir, 'test_image.png');
    testAudioPath = path.join(tempDir, 'test_audio.mp3');

    // Create real test image (1280x720) via FFmpeg lavfi
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=navy:s=1280x720:d=1',
      '-vframes', '1',
      testImagePath,
    ], { stdio: 'ignore' });

    // Create real test audio (1.5s silent/tone MP3) via FFmpeg lavfi
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1.5',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      testAudioPath,
    ], { stdio: 'ignore' });
  });

  afterEach(async () => {
    // Wait a brief moment to allow any aborted child processes on Windows to release locks
    await new Promise((r) => setTimeout(r, 150));
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  it('1. Renders a complete scene clip with zoompan motion and audio', async () => {
    const outputPath = path.join(tempDir, 'scene-001.mp4');

    const result = await SceneRenderer.renderScene({
      sceneNumber: 1,
      imagePath: testImagePath,
      audioPath: testAudioPath,
      outputPath,
      motionStyle: 'breathe',
      durationSeconds: 1.5,
      aspectRatio: '16:9',
    });

    expect(result.sceneNumber).toBe(1);
    expect(result.absoluteVideoPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
    expect(result.status).toBe('completed');
    expect(result.durationSeconds).toBeCloseTo(1.5, 1);

    // Validate using ffprobe
    const probe = await SceneRenderer.probeMedia(outputPath);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(1280);
    expect(probe.height).toBe(720);
    expect(probe.durationSeconds).toBeGreaterThanOrEqual(1.3);
  });

  it('2. Renders scene with burned subtitles when subtitle file is provided', async () => {
    const subtitlePath = path.join(tempDir, 'scene-001.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Burned subtitle test.',
      durationSeconds: 1.5,
      subtitleStyle: 'neon_punch',
      aspectRatio: '16:9',
      outputPath: subtitlePath,
    });

    const outputPath = path.join(tempDir, 'scene-001-subtitled.mp4');
    const result = await SceneRenderer.renderScene({
      sceneNumber: 1,
      imagePath: testImagePath,
      audioPath: testAudioPath,
      subtitlePath,
      outputPath,
      motionStyle: 'zoom_in',
      durationSeconds: 1.5,
      aspectRatio: '16:9',
      subtitlesEnabled: true,
    });

    expect(result.subtitleFile).toBeDefined();
    expect(fs.existsSync(outputPath)).toBe(true);
    const probe = await SceneRenderer.probeMedia(outputPath);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
  });

  it('3. Renders 9:16 vertical video correctly', async () => {
    const vertImagePath = path.join(tempDir, 'test_vert.png');
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=darkred:s=720x1280:d=1',
      '-vframes', '1',
      vertImagePath,
    ], { stdio: 'ignore' });

    const outputPath = path.join(tempDir, 'scene-vert.mp4');
    const result = await SceneRenderer.renderScene({
      sceneNumber: 1,
      imagePath: vertImagePath,
      audioPath: testAudioPath,
      outputPath,
      motionStyle: 'pan_left',
      durationSeconds: 1.5,
      aspectRatio: '9:16',
    });

    expect(result.status).toBe('completed');
    const probe = await SceneRenderer.probeMedia(outputPath);
    expect(probe.width).toBe(720);
    expect(probe.height).toBe(1280);
  });

  it('4. Rejects when image file does not exist', async () => {
    const nonExistentImage = path.join(tempDir, 'non_existent.png');
    const outputPath = path.join(tempDir, 'scene-fail.mp4');

    await expect(
      SceneRenderer.renderScene({
        sceneNumber: 1,
        imagePath: nonExistentImage,
        audioPath: testAudioPath,
        outputPath,
        motionStyle: 'breathe',
        durationSeconds: 1.5,
        aspectRatio: '16:9',
      })
    ).rejects.toThrow(/image file not found/i);
  });

  it('5. Rejects when audio file does not exist', async () => {
    const nonExistentAudio = path.join(tempDir, 'non_existent.mp3');
    const outputPath = path.join(tempDir, 'scene-fail.mp4');

    await expect(
      SceneRenderer.renderScene({
        sceneNumber: 1,
        imagePath: testImagePath,
        audioPath: nonExistentAudio,
        outputPath,
        motionStyle: 'breathe',
        durationSeconds: 1.5,
        aspectRatio: '16:9',
      })
    ).rejects.toThrow(/audio file not found/i);
  });

  it('6. Aborts rendering cleanly when AbortSignal triggers', async () => {
    const controller = new AbortController();
    const outputPath = path.join(tempDir, 'scene-abort.mp4');

    const renderPromise = SceneRenderer.renderScene({
      sceneNumber: 1,
      imagePath: testImagePath,
      audioPath: testAudioPath,
      outputPath,
      motionStyle: 'breathe',
      durationSeconds: 3.0,
      aspectRatio: '16:9',
      signal: controller.signal,
    });

    // Abort almost immediately
    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(renderPromise).rejects.toThrow();
  });
});
