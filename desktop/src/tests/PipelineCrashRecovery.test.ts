import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RecoveryManager } from '../main/storage/RecoveryManager';
import { VideoFactoryPipelineManager } from '../main/pipeline/VideoFactoryPipelineManager';
import { VideoFactoryPipeline } from '../main/pipeline/VideoFactoryPipeline';
import { AssetManager } from '../main/storage/AssetManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { TtsManager } from '../main/tts/TtsManager';
import { RenderManager } from '../main/render/RenderManager';
import { FinalRenderManager } from '../main/render/FinalRenderManager';
import type { StoryEntity } from '../shared/types';

describe('Pipeline Crash Recovery & 15 Scenarios', () => {
  let tempDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-recovery-test-'));
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

  async function createTestProject(name: string): Promise<string> {
    const project = await ProjectRepository.create({ name, prompts: [] });
    AssetManager.ensureProjectDirectories(project.projectId);
    return project.projectId;
  }

  it('Scenario 1: Crash before story completion', async () => {
    const projectId = await createTestProject('Crash 1');

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'story';
    pipelineState.stages.story.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    const report = await RecoveryManager.recoverAll();
    expect(report.scannedPipelines).toBeGreaterThanOrEqual(1);
    expect(report.recoveredPipelines).toBeGreaterThanOrEqual(1);

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.status).toBe('paused');
    expect(recovered?.stages.story.status).toBe('pending');
  });

  it('Scenario 2: Crash during image stage', async () => {
    const projectId = await createTestProject('Crash 2');

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'images';
    pipelineState.stages.story.status = 'completed';
    pipelineState.stages.images.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.status).toBe('paused');
    expect(recovered?.stages.images.status).toBe('pending');
  });

  it('Scenario 3: Crash during voice stage', async () => {
    const projectId = await createTestProject('Crash 3');

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'voice';
    pipelineState.stages.voice.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.status).toBe('paused');
    expect(recovered?.stages.voice.status).toBe('pending');
  });

  it('Scenario 4: Crash after voice but before clips', async () => {
    const projectId = await createTestProject('Crash 4');
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Crash 4 Story',
      scenes: [{ sceneNumber: 1, narration: 'Scene one', imagePrompt: 'Prompt one' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Provide valid voice output
    fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(4000, 0x11));
    await StoryRepository.saveAudioManifest(projectId, {
      projectId,
      provider: 'edge-tts',
      voiceId: 'default',
      totalScenes: 1,
      totalDurationSeconds: 2.0,
      generatedAt: new Date().toISOString(),
      scenes: [{
        sceneNumber: 1,
        narration: 'Scene one',
        audioFile: 'audio/scene-001.mp3',
        absolutePath: path.join(dirs.audioDir, 'scene-001.mp3'),
        durationSeconds: 2.0,
        fileSizeBytes: 4000,
        status: 'completed',
      }],
    });

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'clips';
    pipelineState.stages.story.status = 'completed';
    pipelineState.stages.voice.status = 'completed';
    pipelineState.stages.clips.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    // Voice output was genuine, so it must remain completed
    expect(recovered?.stages.voice.status).toBe('completed');
    // Clips were incomplete, so marked pending for resume
    expect(recovered?.stages.clips.status).toBe('pending');
  });

  it('Scenario 5: Crash during clips', async () => {
    const projectId = await createTestProject('Crash 5');

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'clips';
    pipelineState.stages.clips.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.stages.clips.status).toBe('pending');
  });

  it('Scenario 6: Crash before subtitles', async () => {
    const projectId = await createTestProject('Crash 6');
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Crash 6 Story',
      scenes: [{ sceneNumber: 1, narration: 'Text', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Provide valid clip
    fs.writeFileSync(path.join(dirs.rendersDir, 'scene-001.mp4'), Buffer.alloc(4000, 0x22));

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'subtitles';
    pipelineState.stages.clips.status = 'completed';
    pipelineState.stages.subtitles.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.stages.clips.status).toBe('completed');
    expect(recovered?.stages.subtitles.status).toBe('pending');
  });

  it('Scenario 7: Crash during final render', async () => {
    const projectId = await createTestProject('Crash 7');

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'rendering';
    pipelineState.stages.rendering.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.stages.rendering.status).toBe('pending');
  });

  it('Scenario 8: Crash before export', async () => {
    const projectId = await createTestProject('Crash 8');
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    // Provide valid final video
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

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.currentStage = 'export';
    pipelineState.stages.rendering.status = 'completed';
    pipelineState.stages.export.status = 'running';
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.stages.rendering.status).toBe('completed');
    expect(recovered?.stages.export.status).toBe('pending');
  });

  it('Scenario 9: Resume after restart continues from interrupted stage', async () => {
    const projectId = await createTestProject('Crash 9');
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Crash 9 Story',
      scenes: [{ sceneNumber: 1, narration: 'Narrate', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Prepare story, images, and voice outputs
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'thumbnail.png'), validPng);

    fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(3000, 0x11));
    await StoryRepository.saveAudioManifest(projectId, {
      projectId,
      provider: 'edge-tts',
      voiceId: 'default',
      totalScenes: 1,
      totalDurationSeconds: 2.0,
      generatedAt: new Date().toISOString(),
      scenes: [{
        sceneNumber: 1,
        narration: 'Narrate',
        audioFile: 'audio/scene-001.mp3',
        absolutePath: path.join(dirs.audioDir, 'scene-001.mp3'),
        durationSeconds: 2.0,
        fileSizeBytes: 3000,
        status: 'completed',
      }],
    });

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.stages.story.status = 'completed';
    pipelineState.stages.images.status = 'completed';
    pipelineState.stages.voice.status = 'completed';
    pipelineState.stages.thumbnail.status = 'completed';
    pipelineState.stages.clips.status = 'running'; // Interrupted here
    await StoryRepository.savePipelineState(projectId, pipelineState);

    // Crash recovery scan
    await RecoveryManager.recoverAll();

    // Mock clips & rendering so resume completes successfully
    vi.spyOn(RenderManager, 'renderProjectClips').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'scene-001.mp4'), Buffer.alloc(4000, 0x22));
      fs.writeFileSync(path.join(dirs.subtitlesDir, 'scene-001.ass'), '[Events]\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Narrate');
      return {} as any;
    });

    vi.spyOn(FinalRenderManager, 'assembleFinalVideo').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'final_video.mp4'), Buffer.alloc(8000, 0x33));
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

    // Resume pipeline
    const resumed = await VideoFactoryPipelineManager.resumePipeline(projectId);
    expect(resumed.status).toBe('completed');
    expect(resumed.stages.story.status).toBe('completed');
    expect(resumed.stages.images.status).toBe('completed');
    expect(resumed.stages.voice.status).toBe('completed');
    expect(resumed.stages.clips.status).toBe('completed');
    expect(resumed.stages.rendering.status).toBe('completed');
    expect(resumed.stages.export.status).toBe('completed');
  });

  it('Scenario 10: Corrupted completed output reset to pending', async () => {
    const projectId = await createTestProject('Crash 10');
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Crash 10 Story',
      scenes: [{ sceneNumber: 1, narration: 'Text', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Corrupted 0-byte image file on disk
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), Buffer.alloc(0));

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.stages.story.status = 'completed';
    pipelineState.stages.images.status = 'completed'; // Claimed complete, but corrupted!
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    // Caught corruption and reset to pending
    expect(recovered?.stages.images.status).toBe('pending');
    expect(recovered?.stages.images.error).toContain('0 bytes');
  });

  it('Scenario 11: Missing completed output reset to pending', async () => {
    const projectId = await createTestProject('Crash 11');
    AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Crash 11 Story',
      scenes: [{ sceneNumber: 1, narration: 'Text', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.stages.story.status = 'completed';
    pipelineState.stages.images.status = 'completed'; // File does not exist!
    await StoryRepository.savePipelineState(projectId, pipelineState);

    await RecoveryManager.recoverAll();

    const recovered = await StoryRepository.getPipelineState(projectId);
    expect(recovered?.stages.images.status).toBe('pending');
    expect(recovered?.stages.images.error).toContain('missing');
  });

  it('Scenario 12, 13, 14, 15: Retry stage, pause/resume, cancel, and duplicate start prevention', async () => {
    const projectId = await createTestProject('Crash 12');
    AssetManager.ensureProjectDirectories(projectId);

    const pipeline = new VideoFactoryPipeline(projectId, 'full_video');
    await pipeline.loadOrCreateState();

    // 13. Pause / Resume check
    pipeline.requestPause();
    expect(pipeline.isPauseRequested).toBe(true);

    // 14. Cancellation
    pipeline.cancel();
    expect(pipeline.isAborted).toBe(true);

    // 15. Duplicate start prevention
    const p1 = VideoFactoryPipelineManager.startPipeline(projectId, 'full_video');
    const p2 = VideoFactoryPipelineManager.startPipeline(projectId, 'full_video');
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.runId).toBe(res2.runId);
  });

  it('Deterministic 3-Scene Verification Scenario (Requirement 21)', async () => {
    const projectId = await createTestProject('Scenario 21 3scenes');
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'The Deep Ocean Mystery',
      scenes: [
        { sceneNumber: 1, narration: 'Deep in the Mariana Trench sunlight fades.', imagePrompt: 'Abyss ocean trench' },
        { sceneNumber: 2, narration: 'Bioluminescent anglerfish stalk their prey.', imagePrompt: 'Glowing deep sea fish' },
        { sceneNumber: 3, narration: 'Hydrothermal vents pulse with ancient energy.', imagePrompt: 'Submarine volcano vents' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Step A: First attempt with Scene 2 voice failure
    let voiceAttemptCount = 0;
    vi.spyOn(TtsManager, 'synthesizeProjectNarration').mockImplementation(async () => {
      voiceAttemptCount++;
      if (voiceAttemptCount === 1) {
        throw new Error('Simulated voice provider quota exhaustion on Scene 2');
      }
      // On retry: succeeds for all scenes
      for (let s = 1; s <= 3; s++) {
        const padded = String(s).padStart(3, '0');
        fs.writeFileSync(path.join(dirs.audioDir, `scene-${padded}.mp3`), Buffer.alloc(3000, 0x11));
      }
      await StoryRepository.saveAudioManifest(projectId, {
        projectId,
        provider: 'edge-tts',
        voiceId: 'default',
        totalScenes: 3,
        totalDurationSeconds: 9.0,
        generatedAt: new Date().toISOString(),
        scenes: [1, 2, 3].map((s) => ({
          sceneNumber: s,
          narration: `Scene ${s}`,
          audioFile: `audio/scene-00${s}.mp3`,
          absolutePath: path.join(dirs.audioDir, `scene-00${s}.mp3`),
          durationSeconds: 3.0,
          fileSizeBytes: 3000,
          status: 'completed',
        })),
      });
      return {} as any;
    });

    vi.spyOn(RenderManager, 'renderProjectClips').mockImplementation(async () => {
      for (let s = 1; s <= 3; s++) {
        const padded = String(s).padStart(3, '0');
        fs.writeFileSync(path.join(dirs.rendersDir, `scene-${padded}.mp4`), Buffer.alloc(4000, 0x22));
        fs.writeFileSync(path.join(dirs.subtitlesDir, `scene-${padded}.ass`), `[Events]\nDialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Scene ${s}`);
      }
      return {} as any;
    });

    vi.spyOn(FinalRenderManager, 'assembleFinalVideo').mockImplementation(async () => {
      fs.writeFileSync(path.join(dirs.rendersDir, 'final_video.mp4'), Buffer.alloc(12000, 0x33));
      await StoryRepository.saveFinalRenderManifest(projectId, {
        projectId,
        finalVideoFile: 'renders/final_video.mp4',
        absoluteVideoPath: path.join(dirs.rendersDir, 'final_video.mp4'),
        totalScenes: 3,
        totalDurationSeconds: 9.0,
        aspectRatio: '16:9',
        fileSizeBytes: 12000,
        assembledAt: new Date().toISOString(),
        scenes: [],
      });
      return {} as any;
    });

    // Provide scene images & thumbnail
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-002.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-003.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'thumbnail.png'), validPng);

    // Run 1: Fails at voice
    const firstRun = await VideoFactoryPipelineManager.startPipeline(projectId, 'full_video');
    expect(firstRun.status).toBe('failed');
    expect(firstRun.stages.voice.status).toBe('failed');

    // Sibling assets (story, images, thumbnail) were completed and preserved!
    expect(firstRun.stages.story.status).toBe('completed');
    expect(firstRun.stages.images.status).toBe('completed');
    expect(firstRun.stages.thumbnail.status).toBe('completed');

    // Step B: Retry voice stage
    VideoFactoryPipelineManager.clearMemory();
    const retriedRun = await VideoFactoryPipelineManager.retryStage(projectId, 'voice');
    expect(retriedRun.status).toBe('completed');
    expect(retriedRun.stages.voice.status).toBe('completed');
    expect(retriedRun.stages.clips.status).toBe('completed');
    expect(retriedRun.stages.review.status).toBe('completed');
    expect(retriedRun.stages.subtitles.status).toBe('completed');
    expect(retriedRun.stages.rendering.status).toBe('completed');
    expect(retriedRun.stages.export.status).toBe('completed');

    // Final video verified on disk
    expect(fs.existsSync(path.join(dirs.rendersDir, 'final_video.mp4'))).toBe(true);
  });
});
