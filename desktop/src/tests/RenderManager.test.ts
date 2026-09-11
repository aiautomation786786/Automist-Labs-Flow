import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { RenderManager } from '../main/render/RenderManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { SceneRenderer } from '../main/render/SceneRenderer';
import type { StoryEntity } from '../shared/types';

describe('RenderManager Central Orchestration', () => {
  let testAppDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    testAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-manager-test-'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = testAppDir;
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150));
    if (prevLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = prevLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (fs.existsSync(testAppDir)) {
      try {
        fs.rmSync(testAppDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  async function createTestProjectWithAudio(sceneCount = 2): Promise<string> {
    const project = await ProjectRepository.create({
      name: 'Render Test Project',
      imageRatio: '16:9',
      videoRatio: '16:9',
      prompts: Array.from({ length: sceneCount }, (_, i) => ({
        text: `Scene prompt ${i + 1}`,
        type: 'image' as const,
        narration: `Scene narration number ${i + 1} for testing motion engine.`,
      })),
    });

    const projectId = project.projectId;
    AssetManager.ensureProjectDirectories(projectId);
    const projectDir = AssetManager.getProjectDir(projectId);
    const audioDir = path.join(projectDir, 'audio');
    const imagesDir = path.join(projectDir, 'images');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const story: StoryEntity = {
      title: 'Render Test Story',
      aspectRatio: '16:9',
      scenes: Array.from({ length: sceneCount }, (_, i) => {
        const num = i + 1;
        const paddedNum = String(num).padStart(3, '0');
        const audioPath = path.join(audioDir, `scene-${paddedNum}.mp3`);
        const imagePath = path.join(imagesDir, `scene-${paddedNum}.png`);

        // Generate 1.2s tone audio
        execFileSync('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', `sine=frequency=${400 + num * 100}:duration=1.2`,
          '-c:a', 'libmp3lame', '-b:a', '128k', audioPath,
        ], { stdio: 'ignore' });

        // Generate simple test image
        execFileSync('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', `color=c=${num === 1 ? 'navy' : 'darkgreen'}:s=1280x720:d=1`,
          '-vframes', '1', imagePath,
        ], { stdio: 'ignore' });

        return {
          sceneNumber: num,
          promptSlotIndex: i,
          imagePrompt: `Visual scene ${num}`,
          narration: `Scene narration number ${num} for testing motion engine.`,
          durationSeconds: 1.2,
        };
      }),
    };

    await StoryRepository.saveStory(projectId, story);
    return projectId;
  }

  it('1. Renders a single scene independently and updates manifest', async () => {
    const projectId = await createTestProjectWithAudio(2);

    const result = await RenderManager.renderSingleScene(projectId, 1, {
      motionStyle: 'breathe',
      subtitleStyle: 'neon_punch',
      subtitlesEnabled: true,
    });

    expect(result.sceneNumber).toBe(1);
    expect(result.status).toBe('completed');
    expect(result.absoluteVideoPath).toBeDefined();
    expect(fs.existsSync(result.absoluteVideoPath)).toBe(true);

    const manifest = await RenderManager.getRenderManifest(projectId);
    expect(manifest).not.toBeNull();
    expect(manifest?.scenes.length).toBe(1);
    expect(manifest?.scenes[0].sceneNumber).toBe(1);
  });

  it('2. Renders all project scenes with bounded concurrency and progress events', async () => {
    const projectId = await createTestProjectWithAudio(2);
    RenderManager.setConcurrency(2);

    const progressEvents: any[] = [];
    const unsubscribe = RenderManager.onProgress((ev) => {
      if (ev.projectId === projectId) {
        progressEvents.push(ev);
      }
    });

    try {
      const manifest = await RenderManager.renderProjectClips(projectId, {
        motionStyle: 'zoom_in',
        subtitleStyle: 'bottom_glass',
        subtitlesEnabled: true,
        transitionStyle: 'hard_cut',
      });

      expect(manifest.projectId).toBe(projectId);
      expect(manifest.renderedScenes).toBe(2);
      expect(manifest.scenes.length).toBe(2);

      for (const sc of manifest.scenes) {
        expect(sc.status).toBe('completed');
        expect(sc.absoluteVideoPath).toBeDefined();
        expect(fs.existsSync(sc.absoluteVideoPath)).toBe(true);

        const probe = await SceneRenderer.probeMedia(sc.absoluteVideoPath);
        expect(probe.hasVideo).toBe(true);
        expect(probe.hasAudio).toBe(true);
      }

      // Check progress events
      expect(progressEvents.length).toBeGreaterThan(0);
      const scene1Events = progressEvents.filter((e) => e.sceneNumber === 1);
      expect(scene1Events.some((e) => e.status === 'completed')).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('3. Generates neutral cinematic placeholder card if scene image is missing', async () => {
    const projectId = await createTestProjectWithAudio(1);
    const projectDir = AssetManager.getProjectDir(projectId);
    const imagePath = path.join(projectDir, 'images', 'scene-001.png');
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    const result = await RenderManager.renderSingleScene(projectId, 1, {
      motionStyle: 'pan_right',
    });

    expect(result.status).toBe('completed');
    expect(fs.existsSync(result.absoluteVideoPath)).toBe(true);
  });

  it('4. Cancels active project rendering', async () => {
    const projectId = await createTestProjectWithAudio(3);

    const renderPromise = RenderManager.renderProjectClips(projectId, {
      motionStyle: 'breathe',
    });

    // Cancel shortly after
    setTimeout(() => {
      RenderManager.cancelProjectRender(projectId);
    }, 50);

    const manifest = await renderPromise;
    expect(manifest.scenes.some((s) => s.status === 'cancelled')).toBe(true);
  });
});
