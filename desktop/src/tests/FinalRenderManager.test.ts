import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { FinalRenderManager } from '../main/render/FinalRenderManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { SceneRenderer } from '../main/render/SceneRenderer';
import type { StoryEntity, RenderManifest } from '../shared/types';

describe('FinalRenderManager Orchestration & Lifecycle', () => {
  let testAppDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    testAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'final_render_mgr_test_'));
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

  async function createTestProjectWithRenderedClips(sceneCount = 2): Promise<{
    projectId: string;
    clips: string[];
    bgmPath: string;
  }> {
    const project = await ProjectRepository.create({
      name: 'Final Assembly Test Project',
      imageRatio: '16:9',
      videoRatio: '16:9',
      prompts: Array.from({ length: sceneCount }, (_, i) => ({
        text: `Scene ${i + 1}`,
        type: 'video' as const,
      })),
    });

    const projectId = project.projectId;
    const dirs = AssetManager.ensureProjectDirectories(projectId);
    const ffmpegBin = SceneRenderer.getFfmpegPath();

    const clips: string[] = [];
    const scenesMeta: any[] = [];

    for (let i = 0; i < sceneCount; i++) {
      const sceneNum = i + 1;
      const paddedNum = String(sceneNum).padStart(3, '0');
      const clipPath = path.join(dirs.rendersDir, `scene-${paddedNum}.mp4`);

      // Generate a small 1.5s video clip with audio
      execFileSync(
        ffmpegBin,
        [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=${i === 0 ? 'blue' : 'coral'}:s=320x240:r=25:d=1.5`,
          '-f', 'lavfi',
          '-i', `sine=f=${440 + i * 110}:d=1.5`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-shortest',
          clipPath,
        ],
        { stdio: 'ignore' }
      );

      clips.push(clipPath);
      scenesMeta.push({
        sceneNumber: sceneNum,
        videoFile: `renders/scene-${paddedNum}.mp4`,
        absoluteVideoPath: clipPath,
        durationSeconds: 1.5,
        fileSizeBytes: fs.statSync(clipPath).size,
        status: 'completed',
      });
    }

    // Save StoryEntity
    const story: StoryEntity = {
      title: 'Final Test Story',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: Array.from({ length: sceneCount }, (_, i) => ({
        sceneNumber: i + 1,
        narration: `Narration for scene ${i + 1}`,
        imagePrompt: `Prompt for scene ${i + 1}`,
        durationSeconds: 1.5,
      })),
    };
    await StoryRepository.saveStory(projectId, story);

    // Save Phase 5 RenderManifest
    const renderManifest: RenderManifest = {
      projectId,
      motionStyle: 'breathe',
      transitionStyle: 'hard_cut',
      subtitlesEnabled: true,
      aspectRatio: '16:9',
      totalScenes: sceneCount,
      renderedScenes: sceneCount,
      totalDurationSeconds: sceneCount * 1.5,
      renderedAt: new Date().toISOString(),
      scenes: scenesMeta,
    };
    await StoryRepository.saveRenderManifest(projectId, renderManifest);

    // Generate external music file
    const externalMusicDir = path.join(testAppDir, 'external_music');
    fs.mkdirSync(externalMusicDir, { recursive: true });
    const bgmPath = path.join(externalMusicDir, 'cinematic_bgm.mp3');
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi',
        '-i', 'sine=f=260:d=5.0',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        bgmPath,
      ],
      { stdio: 'ignore' }
    );

    return { projectId, clips, bgmPath };
  }

  it('1. Assembles final video from Phase 5 clips and verifies outputs and manifest', async () => {
    const { projectId, clips } = await createTestProjectWithRenderedClips(2);

    const initialMtimes = clips.map((c) => fs.statSync(c).mtimeMs);
    const progressLog: string[] = [];

    const unsub = FinalRenderManager.onProgress((ev) => {
      if (ev.projectId === projectId) progressLog.push(ev.status);
    });

    const manifest = await FinalRenderManager.assembleFinalVideo(projectId, {
      transitionStyle: 'hard_cut',
    });

    unsub();

    expect(manifest.status).toBe('completed');
    expect(manifest.videoFile).toBe('final/final.mp4');
    expect(fs.existsSync(manifest.absoluteVideoPath)).toBe(true);
    expect(manifest.durationSeconds).toBeGreaterThanOrEqual(2.8);
    expect(manifest.totalScenes).toBe(2);

    // Verify thumbnail and poster
    expect(manifest.thumbnailFile).toBe('final/final-thumbnail.jpg');
    expect(fs.existsSync(manifest.absoluteThumbnailPath!)).toBe(true);
    expect(manifest.posterFile).toBe('final/final-poster.jpg');
    expect(fs.existsSync(manifest.absolutePosterPath!)).toBe(true);

    // Invariant: Phase 5 scene clips are untouched and reused!
    const afterMtimes = clips.map((c) => fs.statSync(c).mtimeMs);
    expect(afterMtimes).toEqual(initialMtimes);

    // Verify persistence in StoryRepository
    const retrieved = await StoryRepository.getFinalRenderManifest(projectId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe('completed');
    expect(retrieved?.durationSeconds).toBe(manifest.durationSeconds);

    expect(progressLog).toContain('queued');
    expect(progressLog).toContain('completed');
  }, 40000);

  it('2. Safely handles external music by copying to project-local music folder', async () => {
    const { projectId, bgmPath } = await createTestProjectWithRenderedClips(2);

    const originalStatBefore = fs.statSync(bgmPath);

    const manifest = await FinalRenderManager.assembleFinalVideo(projectId, {
      musicPath: bgmPath,
      musicEnabled: true,
      musicVolume: 0.22,
      duckingEnabled: true,
    });

    expect(manifest.status).toBe('completed');
    expect(manifest.musicTrack).toBeDefined();
    expect(manifest.musicTrack?.volume).toBe(0.22);
    expect(manifest.musicTrack?.duckingEnabled).toBe(true);

    // Music file was copied into project directory
    const musicDir = AssetManager.getMusicDir(projectId);
    const copiedFiles = fs.readdirSync(musicDir);
    expect(copiedFiles.length).toBeGreaterThan(0);

    // User's original file is completely intact
    const originalStatAfter = fs.statSync(bgmPath);
    expect(originalStatAfter.size).toBe(originalStatBefore.size);
  }, 40000);

  it('3. Supports independent retry: re-assembles with Cross Fade without re-rendering clips', async () => {
    const { projectId, clips } = await createTestProjectWithRenderedClips(2);

    // First assembly: Hard Cut
    await FinalRenderManager.assembleFinalVideo(projectId, {
      transitionStyle: 'hard_cut',
    });

    const clipMtimes = clips.map((c) => fs.statSync(c).mtimeMs);

    // Second assembly (Retry): Cross Fade
    const secondManifest = await FinalRenderManager.assembleFinalVideo(projectId, {
      transitionStyle: 'cross_fade',
      crossfadeDuration: 0.5,
    });

    expect(secondManifest.status).toBe('completed');
    expect(secondManifest.transitionStyle).toBe('cross_fade');
    // Expected duration = 1.5 + 1.5 - 0.5 = 2.5s
    expect(secondManifest.durationSeconds).toBeGreaterThanOrEqual(2.3);
    expect(secondManifest.durationSeconds).toBeLessThanOrEqual(2.8);

    // Scene clips were NOT regenerated during retry!
    const afterMtimes = clips.map((c) => fs.statSync(c).mtimeMs);
    expect(afterMtimes).toEqual(clipMtimes);
  }, 40000);

  it('4. Fails gracefully and records failed manifest when a scene clip is missing', async () => {
    const { projectId, clips } = await createTestProjectWithRenderedClips(2);

    // Delete scene 2
    fs.unlinkSync(clips[1]);

    await expect(
      FinalRenderManager.assembleFinalVideo(projectId)
    ).rejects.toThrow('scene 2');

    const manifest = await StoryRepository.getFinalRenderManifest(projectId);
    expect(manifest).not.toBeNull();
    expect(manifest?.status).toBe('failed');
    expect(manifest?.error).toContain('scene 2');
  }, 30000);

  it('5. Cancels active final render and updates manifest', async () => {
    const { projectId } = await createTestProjectWithRenderedClips(2);

    // Start assembly and cancel immediately
    const promise = FinalRenderManager.assembleFinalVideo(projectId);
    // Give it a tiny delay to register controller
    await new Promise((r) => setTimeout(r, 10));

    const cancelled = FinalRenderManager.cancelFinalRender(projectId);
    expect(cancelled).toBe(true);

    const result = await promise.catch((err) => err);
    // Either caught as error or resolved with status: 'cancelled'
    const manifest = await StoryRepository.getFinalRenderManifest(projectId);
    expect(manifest?.status).toBe('cancelled');
  }, 30000);
});
