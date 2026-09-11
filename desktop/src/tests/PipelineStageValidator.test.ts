import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PipelineStageValidator } from '../main/pipeline/PipelineStageValidator';
import { AssetManager } from '../main/storage/AssetManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import type { StoryEntity } from '../shared/types';

describe('PipelineStageValidator Tests', () => {
  let tempDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tempDir;
  });

  afterEach(() => {
    if (prevLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = prevLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Rejects story stage when story.json is missing or incomplete', async () => {
    const projectId = 'proj_val_01';
    AssetManager.ensureProjectDirectories(projectId);

    // Missing story
    const res1 = await PipelineStageValidator.validateStory(projectId);
    expect(res1.valid).toBe(false);
    expect(res1.reason).toContain('story.json does not exist');

    // Empty title
    const emptyTitleStory: StoryEntity = {
      title: '',
      scenes: [{ sceneNumber: 1, narration: 'Hello', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, emptyTitleStory);
    const res2 = await PipelineStageValidator.validateStory(projectId);
    expect(res2.valid).toBe(false);
    expect(res2.reason).toContain('title is empty');

    // Valid story
    emptyTitleStory.title = 'Valid Documentary';
    await StoryRepository.saveStory(projectId, emptyTitleStory);
    const res3 = await PipelineStageValidator.validateStory(projectId);
    expect(res3.valid).toBe(true);
    expect(res3.details?.sceneCount).toBe(1);
  });

  it('2. Validates image files on disk and catches 0-byte or missing images', async () => {
    const projectId = 'proj_val_02';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Deep Space',
      scenes: [
        { sceneNumber: 1, narration: 'Scene 1', imagePrompt: 'Prompt 1' },
        { sceneNumber: 2, narration: 'Scene 2', imagePrompt: 'Prompt 2' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Missing images
    const res1 = await PipelineStageValidator.validateImages(projectId);
    expect(res1.valid).toBe(false);
    expect(res1.reason).toContain('missing for Scene 1');

    // 0-byte image
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), Buffer.alloc(0));
    const res2 = await PipelineStageValidator.validateImages(projectId);
    expect(res2.valid).toBe(false);
    expect(res2.reason).toContain('0 bytes');

    // Valid PNG images (with PNG signature)
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-001.png'), validPng);
    fs.writeFileSync(path.join(dirs.imagesDir, 'scene-002.png'), validPng);

    const res3 = await PipelineStageValidator.validateImages(projectId);
    expect(res3.valid).toBe(true);
    expect(res3.details?.verifiedScenes).toBe(2);
  });

  it('3. Validates voice audio files on disk and catches missing manifests or audio', async () => {
    const projectId = 'proj_val_03';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Ocean Mysteries',
      scenes: [{ sceneNumber: 1, narration: 'Voiceover narration text', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Missing audio
    const res1 = await PipelineStageValidator.validateVoice(projectId);
    expect(res1.valid).toBe(false);
    expect(res1.reason).toContain('Audio file missing');

    // 0-byte audio
    fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(0));
    const res2 = await PipelineStageValidator.validateVoice(projectId);
    expect(res2.valid).toBe(false);
    expect(res2.reason).toContain('0 bytes');

    // Non-empty audio without manifest
    fs.writeFileSync(path.join(dirs.audioDir, 'scene-001.mp3'), Buffer.alloc(5000, 0x55));
    const res3 = await PipelineStageValidator.validateVoice(projectId);
    expect(res3.valid).toBe(false);
    expect(res3.reason).toContain('metadata/audio.json manifest missing');

    // With manifest
    await StoryRepository.saveAudioManifest(projectId, {
      projectId,
      provider: 'edge-tts',
      voiceId: 'en-US-ChristopherNeural',
      totalScenes: 1,
      totalDurationSeconds: 4.5,
      generatedAt: new Date().toISOString(),
      scenes: [{
        sceneNumber: 1,
        narration: 'Voiceover',
        audioFile: 'audio/scene-001.mp3',
        absolutePath: path.join(dirs.audioDir, 'scene-001.mp3'),
        durationSeconds: 4.5,
        fileSizeBytes: 5000,
        status: 'completed',
      }],
    });

    const res4 = await PipelineStageValidator.validateVoice(projectId);
    expect(res4.valid).toBe(true);
  });

  it('4. Validates thumbnail, clips, subtitles, and final rendering stages', async () => {
    const projectId = 'proj_val_04';
    const dirs = AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Ancient Egypt',
      scenes: [{ sceneNumber: 1, narration: 'Pyramids of Giza', imagePrompt: 'Prompt' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await StoryRepository.saveStory(projectId, story);

    // Thumbnail
    expect((await PipelineStageValidator.validateThumbnail(projectId)).valid).toBe(false);
    fs.writeFileSync(path.join(dirs.imagesDir, 'thumbnail.png'), Buffer.alloc(100, 0x11));
    expect((await PipelineStageValidator.validateThumbnail(projectId)).valid).toBe(true);

    // Clips
    expect((await PipelineStageValidator.validateClips(projectId)).valid).toBe(false);
    fs.writeFileSync(path.join(dirs.rendersDir, 'scene-001.mp4'), Buffer.alloc(5000, 0x22));
    expect((await PipelineStageValidator.validateClips(projectId)).valid).toBe(true);

    // Subtitles
    expect((await PipelineStageValidator.validateSubtitles(projectId)).valid).toBe(false);
    fs.writeFileSync(path.join(dirs.subtitlesDir, 'scene-001.ass'), '[Events]\nDialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,Ancient Egypt');
    expect((await PipelineStageValidator.validateSubtitles(projectId)).valid).toBe(true);

    // Rendering
    expect((await PipelineStageValidator.validateRendering(projectId)).valid).toBe(false);
    fs.writeFileSync(path.join(dirs.rendersDir, 'final_video.mp4'), Buffer.alloc(10000, 0x33));
    expect((await PipelineStageValidator.validateRendering(projectId)).valid).toBe(false); // missing manifest

    await StoryRepository.saveFinalRenderManifest(projectId, {
      projectId,
      finalVideoFile: 'renders/final_video.mp4',
      absoluteVideoPath: path.join(dirs.rendersDir, 'final_video.mp4'),
      totalScenes: 1,
      totalDurationSeconds: 4.0,
      aspectRatio: '16:9',
      fileSizeBytes: 10000,
      assembledAt: new Date().toISOString(),
      scenes: [],
    });
    expect((await PipelineStageValidator.validateRendering(projectId)).valid).toBe(true);

    // Export
    await StoryRepository.saveExportManifest(projectId, {
      projectId,
      exportedAt: new Date().toISOString(),
      finalVideoFile: 'renders/final_video.mp4',
    });
    expect((await PipelineStageValidator.validateExport(projectId)).valid).toBe(true);
  });

  it('5. Computes correct dependency-aware downstream stages', () => {
    // Full Video: invalidating voice invalidates clips, review, subtitles, rendering, export
    const voiceDownstream = PipelineStageValidator.getDownstreamStages('voice', 'full_video');
    expect(voiceDownstream).toEqual(['clips', 'review', 'subtitles', 'rendering', 'export']);

    // Images invalidation does NOT invalidate voice or thumbnail
    const imagesDownstream = PipelineStageValidator.getDownstreamStages('images', 'full_video');
    expect(imagesDownstream).toEqual(['clips', 'review', 'rendering', 'export']);
    expect(imagesDownstream).not.toContain('voice');
    expect(imagesDownstream).not.toContain('thumbnail');

    // Subtitles invalidation does NOT invalidate images, voice, or clips
    const subDownstream = PipelineStageValidator.getDownstreamStages('subtitles', 'full_video');
    expect(subDownstream).toEqual(['rendering', 'export']);
    expect(subDownstream).not.toContain('clips');
    expect(subDownstream).not.toContain('voice');

    // Audio Only mode: invalidating voice invalidates export only
    const audioVoiceDownstream = PipelineStageValidator.getDownstreamStages('voice', 'audio_only');
    expect(audioVoiceDownstream).toEqual(['export']);
  });
});
