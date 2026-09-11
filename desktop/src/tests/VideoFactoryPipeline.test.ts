import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VideoFactoryPipelineManager } from '../main/pipeline/VideoFactoryPipelineManager';
import { VideoFactoryPipeline } from '../main/pipeline/VideoFactoryPipeline';
import { AssetManager } from '../main/storage/AssetManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { TtsManager } from '../main/tts/TtsManager';
import { RenderManager } from '../main/render/RenderManager';
import { FinalRenderManager } from '../main/render/FinalRenderManager';
import type { StoryEntity } from '../shared/types';

describe('VideoFactoryPipeline & Manager Integration', () => {
  let tempDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tempDir;
    VideoFactoryPipelineManager.clearMemory();
  });

  afterEach(() => {
    VideoFactoryPipelineManager.clearMemory();
    if (prevLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = prevLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Initializes and persists pipeline state with all 9 stages', async () => {
    const projectId = 'proj_pipe_init_01';
    AssetManager.ensureProjectDirectories(projectId);

    const pipeline = new VideoFactoryPipeline(projectId, 'full_video');
    const state = await pipeline.loadOrCreateState();

    expect(state.projectId).toBe(projectId);
    expect(state.mode).toBe('full_video');
    expect(state.status).toBe('idle');
    expect(Object.keys(state.stages).length).toBe(9);
    expect(state.stages.story.status).toBe('pending');
    expect(state.stages.export.status).toBe('pending');

    // Verify on disk
    const onDisk = await StoryRepository.getPipelineState(projectId);
    expect(onDisk).not.toBeNull();
    expect(onDisk?.projectId).toBe(projectId);
  });

  it('2. Enforces idempotency: multiple startPipeline calls share the same execution promise', async () => {
    const projectId = 'proj_pipe_idempotent_01';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Idempotency Test',
      scenes: [{ sceneNumber: 1, narration: 'Scene one', imagePrompt: 'Prompt one' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Mock stages
    vi.spyOn(TtsManager, 'synthesizeProjectNarration').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(5000, 0x11));
      await StoryRepository.saveAudioManifest(projectId, {
        projectId,
        provider: 'edge-tts',
        voiceId: 'default',
        totalScenes: 1,
        totalDurationSeconds: 3.0,
        generatedAt: new Date().toISOString(),
        scenes: [{
          sceneNumber: 1,
          narration: 'Scene one',
          audioFile: 'audio/scene-001.mp3',
          absolutePath: path.join(dirs.audioDir, 'scene-001.mp3'),
          durationSeconds: 3.0,
          fileSizeBytes: 5000,
          status: 'completed',
        }],
      });
      return {} as any;
    });

    vi.spyOn(RenderManager, 'renderProjectClips').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'scene-001.mp4'), Buffer.alloc(5000, 0x22));
      fs.writeFileSync(path.join(dirs.subtitlesDir, 'scene-001.ass'), '[Events]\nDialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Scene one');
      return {} as any;
    });

    vi.spyOn(FinalRenderManager, 'assembleFinalVideo').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'final_video.mp4'), Buffer.alloc(10000, 0x33));
      await StoryRepository.saveFinalRenderManifest(projectId, {
        projectId,
        finalVideoFile: 'renders/final_video.mp4',
        absoluteVideoPath: path.join(dirs.rendersDir, 'final_video.mp4'),
        totalScenes: 1,
        totalDurationSeconds: 3.0,
        aspectRatio: '16:9',
        fileSizeBytes: 10000,
        assembledAt: new Date().toISOString(),
        scenes: [],
      });
      return {} as any;
    });

    // Write PNG image
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'thumbnail.png'), validPng);

    // Call start twice in parallel
    const p1 = VideoFactoryPipelineManager.startPipeline(projectId, 'full_video');
    const p2 = VideoFactoryPipelineManager.startPipeline(projectId, 'full_video');

    // Both calls must resolve to the identical pipeline execution
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.status).toBe('completed');
    expect(res2.status).toBe('completed');
    expect(res1.runId).toBe(res2.runId);
  });

  it('3. Runs Audio Only pipeline: skips clips, subtitles, and final video rendering', async () => {
    const projectId = 'proj_pipe_audio_only_01';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Podcast Narration',
      scenes: [
        { sceneNumber: 1, narration: 'Chapter 1 intro', imagePrompt: 'Prompt 1' },
        { sceneNumber: 2, narration: 'Chapter 2 body', imagePrompt: 'Prompt 2' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    vi.spyOn(TtsManager, 'synthesizeProjectNarration').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(4000, 0xaa));
      fs.writeFileSync(path.join(dirs.audioDir, 'scene-002.mp3'), Buffer.alloc(4000, 0xbb));
      await StoryRepository.saveAudioManifest(projectId, {
        projectId,
        provider: 'edge-tts',
        voiceId: 'en-US-GuyNeural',
        totalScenes: 2,
        totalDurationSeconds: 8.0,
        generatedAt: new Date().toISOString(),
        scenes: [
          {
            sceneNumber: 1,
            narration: 'Chapter 1 intro',
            audioFile: 'audio/scene-001.mp3',
            absolutePath: path.join(dirs.audioDir, 'scene-001.mp3'),
            durationSeconds: 4.0,
            fileSizeBytes: 4000,
            status: 'completed',
          },
          {
            sceneNumber: 2,
            narration: 'Chapter 2 body',
            audioFile: 'audio/scene-002.mp3',
            absolutePath: path.join(dirs.audioDir, 'scene-002.mp3'),
            durationSeconds: 4.0,
            fileSizeBytes: 4000,
            status: 'completed',
          },
        ],
      });
      return {} as any;
    });

    vi.spyOn(TtsManager, 'combineProjectAudio').mockImplementation(async () => {
      const masterPath = path.join(dirs.audioDir, 'final_audio.mp3');
      fs.writeFileSync(masterPath, Buffer.alloc(8000, 0xcc));
      return { masterAudioPath: masterPath, durationSeconds: 8.0 };
    });

    const pipeline = new VideoFactoryPipeline(projectId, 'audio_only');
    const state = await pipeline.run();

    expect(state.status).toBe('completed');
    expect(state.stages.story.status).toBe('completed');
    expect(state.stages.voice.status).toBe('completed');
    expect(state.stages.export.status).toBe('completed');

    // Skipped stages should remain pending
    expect(state.stages.images.status).toBe('pending');
    expect(state.stages.clips.status).toBe('pending');
    expect(state.stages.rendering.status).toBe('pending');

    // Master audio file exists on disk
    expect(fs.existsSync(path.join(dirs.audioDir, 'final_audio.mp3'))).toBe(true);
  });

  it('4. Supports cooperative pause and resume without starting from scratch', async () => {
    const projectId = 'proj_pipe_pause_resume_01';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Cosmic Voyage',
      scenes: [{ sceneNumber: 1, narration: 'Galaxies colliding', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    const pipeline = new VideoFactoryPipeline(projectId, 'full_video');
    await pipeline.loadOrCreateState();

    // Mark story completed
    await pipeline.updateStageState('story', { status: 'completed', progress: 100 });

    // Request pause
    pipeline.requestPause();
    expect(pipeline.isPauseRequested).toBe(true);

    // When run is called, it yields at checkpoint and persists 'paused'
    const pausedState = await pipeline.run();
    expect(pausedState.status).toBe('paused');
    expect(pausedState.stages.story.status).toBe('completed');

    // Verify persisted
    const onDisk = await StoryRepository.getPipelineState(projectId);
    expect(onDisk?.status).toBe('paused');
  });

  it('5. Supports stage-level retry without regenerating already completed upstream/sibling work', async () => {
    const projectId = 'proj_pipe_retry_stage_01';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Volcano Documentary',
      scenes: [{ sceneNumber: 1, narration: 'Magma chambers', imagePrompt: 'Volcano prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'thumbnail.png'), validPng);

    const pipeline = new VideoFactoryPipeline(projectId, 'full_video');
    await pipeline.loadOrCreateState();

    // Story, images, and thumbnail are completed
    await pipeline.updateStageState('story', { status: 'completed', progress: 100 });
    await pipeline.updateStageState('images', { status: 'completed', progress: 100 });
    await pipeline.updateStageState('thumbnail', { status: 'completed', progress: 100 });
    // Voice failed
    await pipeline.updateStageState('voice', { status: 'failed', error: 'Simulated voice error' });

    // Spy on voice synthesis to succeed on retry
    vi.spyOn(TtsManager, 'synthesizeProjectNarration').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(3000, 0x44));
      await StoryRepository.saveAudioManifest(projectId, {
        projectId,
        provider: 'edge-tts',
        voiceId: 'default',
        totalScenes: 1,
        totalDurationSeconds: 2.0,
        generatedAt: new Date().toISOString(),
        scenes: [{
          sceneNumber: 1,
          narration: 'Magma chambers',
          audioFile: 'audio/scene-001.mp3',
          absolutePath: path.join(dirs.audioDir, 'scene-001.mp3'),
          durationSeconds: 2.0,
          fileSizeBytes: 3000,
          status: 'completed',
        }],
      });
      return {} as any;
    });

    vi.spyOn(RenderManager, 'renderProjectClips').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'scene-001.mp4'), Buffer.alloc(4000, 0x55));
      fs.writeFileSync(path.join(dirs.subtitlesDir, 'scene-001.ass'), '[Events]\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Magma');
      return {} as any;
    });

    vi.spyOn(FinalRenderManager, 'assembleFinalVideo').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'final_video.mp4'), Buffer.alloc(8000, 0x66));
      await StoryRepository.saveFinalRenderManifest(projectId, {
        projectId,
        finalVideoFile: 'renders/final_video.mp4',
        absoluteVideoPath: path.join(dirs.rendersDir, 'final_video.mp4'),
        totalScenes: 1,
        totalDurationSeconds: 2.0,
        aspectRatio: '16:9',
        fileSizeBytes: 8000,
        assembledAt: new Date().toISOString(),
        scenes: [],
      });
      return {} as any;
    });

    // Retry voice stage
    const retriedState = await pipeline.retryStage('voice');
    expect(retriedState.status).toBe('completed');
    expect(retriedState.stages.voice.status).toBe('completed');

    // Sibling stages (story, images, thumbnail) remained completed without re-executing
    expect(retriedState.stages.story.status).toBe('completed');
    expect(retriedState.stages.images.status).toBe('completed');
    expect(retriedState.stages.thumbnail.status).toBe('completed');
  });

  it('6. Cancellation terminates pipeline immediately and persists cancelled state', async () => {
    const projectId = 'proj_pipe_cancel_01';
    AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Cancelled Run',
      scenes: [{ sceneNumber: 1, narration: 'Text', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    const pipeline = new VideoFactoryPipeline(projectId, 'full_video');
    await pipeline.loadOrCreateState();

    pipeline.cancel();
    expect(pipeline.isAborted).toBe(true);

    const state = await pipeline.run();
    expect(state.status).toBe('cancelled');

    const onDisk = await StoryRepository.getPipelineState(projectId);
    expect(onDisk?.status).toBe('cancelled');
  });
});
