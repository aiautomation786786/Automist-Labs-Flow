import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StoryRepository } from '../main/storage/StoryRepository';
import { AssetManager } from '../main/storage/AssetManager';
import type { StoryEntity, VideoFactoryConfig } from '../shared/types';

describe('StoryRepository Unit & Safety Tests', () => {
  let testDir: string;
  let customDraftPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-flow-story-test-'));
    customDraftPath = path.join(testDir, 'video_factory_draft.json');
    StoryRepository.setCustomDraftPath(customDraftPath);
    StoryRepository.clearCache();
  });

  afterEach(() => {
    StoryRepository.setCustomDraftPath(null);
    StoryRepository.clearCache();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('1. Returns default draft when no draft file exists on disk', async () => {
    expect(fs.existsSync(customDraftPath)).toBe(false);

    const draft = await StoryRepository.getDraft();
    expect(draft).toBeDefined();
    expect(draft.activeMode).toBe('full_video');
    expect(draft.step).toBe(1);
    expect(draft.aspectRatio).toBe('16:9');
    expect(draft.motionStyle).toBe('breathe');
    expect(draft.transitionStyle).toBe('hard_cut');
  });

  it('2. Atomically saves draft and restores state across sessions', async () => {
    await StoryRepository.saveDraft({
      title: 'Voyage to Jupiter',
      step: 3,
      aspectRatio: '9:16',
      subtitlesEnabled: false,
      motionStyle: 'zoom_in',
    });

    expect(fs.existsSync(customDraftPath)).toBe(true);

    const reloaded = await StoryRepository.getDraft();
    expect(reloaded.title).toBe('Voyage to Jupiter');
    expect(reloaded.step).toBe(3);
    expect(reloaded.aspectRatio).toBe('9:16');
    expect(reloaded.subtitlesEnabled).toBe(false);
    expect(reloaded.motionStyle).toBe('zoom_in');
    // Preserves other default fields
    expect(reloaded.transitionStyle).toBe('hard_cut');
  });

  it('3. Resilient against corrupted draft file: returns default draft without crashing', async () => {
    fs.writeFileSync(customDraftPath, '{ CORRUPT_DRAFT_JSON ...', 'utf-8');

    const draft = await StoryRepository.getDraft();
    expect(draft).toBeDefined();
    expect(draft.activeMode).toBe('full_video');
    expect(draft.step).toBe(1);
  });

  it('4. Saves and retrieves project story.json and factory_config.json', async () => {
    const mockProjectId = `proj_test_${Date.now()}`;
    const projectDir = AssetManager.getProjectDir(mockProjectId);

    try {
      const mockStory: StoryEntity = {
        title: 'Deep Space Odyssey',
        scenes: [
          {
            sceneNumber: 1,
            narration: 'The nebula glows with ionized gas.',
            imagePrompt: 'Vibrant purple and cyan interstellar nebula, Hubble telescope style',
            mood: 'wondrous',
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const savedStory = await StoryRepository.saveStory(mockProjectId, mockStory);
      expect(savedStory.title).toBe('Deep Space Odyssey');

      const retrievedStory = await StoryRepository.getStory(mockProjectId);
      expect(retrievedStory).not.toBeNull();
      expect(retrievedStory?.scenes).toHaveLength(1);
      expect(retrievedStory?.scenes[0]?.narration).toBe('The nebula glows with ionized gas.');

      const mockConfig: VideoFactoryConfig = {
        mode: 'full_video',
        story: mockStory,
        aspectRatio: '16:9',
        subtitlesEnabled: true,
        motionEnabled: true,
        motionStyle: 'breathe',
        transitionStyle: 'hard_cut',
        voiceEngine: 'edge-tts',
        voiceId: 'en-US-ChristopherNeural',
        stage: 'assets_queued',
      };

      await StoryRepository.saveConfig(mockProjectId, mockConfig);
      const retrievedConfig = await StoryRepository.getConfig(mockProjectId);
      expect(retrievedConfig).not.toBeNull();
      expect(retrievedConfig?.motionStyle).toBe('breathe');
      expect(retrievedConfig?.stage).toBe('assets_queued');
    } finally {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    }
  });

  it('5. updateStory updates existing story and updates timestamp', async () => {
    const mockProjectId = `proj_updatestory_${Date.now()}`;
    const projectDir = AssetManager.getProjectDir(mockProjectId);

    try {
      const initialStory: StoryEntity = {
        title: 'Initial Title',
        scenes: [
          {
            sceneNumber: 1,
            narration: 'Initial Narration',
            imagePrompt: 'Initial Prompt',
          },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      await StoryRepository.saveStory(mockProjectId, initialStory);

      const modifiedStory: StoryEntity = {
        ...initialStory,
        title: 'Updated Title',
        scenes: [
          {
            sceneNumber: 1,
            narration: 'Updated Narration',
            imagePrompt: 'Updated Prompt',
          },
        ],
      };

      const result = await StoryRepository.updateStory(mockProjectId, modifiedStory);
      expect(result.title).toBe('Updated Title');
      expect(result.scenes[0]!.narration).toBe('Updated Narration');
      expect(result.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');

      // Attempting to update a non-existent project story throws
      await expect(
        StoryRepository.updateStory('proj_non_existent', modifiedStory)
      ).rejects.toThrow(/does not exist/);
    } finally {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    }
  });

  it('6. updateScene patches a single scene while preserving sceneNumber', async () => {
    const mockProjectId = `proj_updatescene_${Date.now()}`;
    const projectDir = AssetManager.getProjectDir(mockProjectId);

    try {
      const story: StoryEntity = {
        title: 'Scene Patch Story',
        scenes: [
          {
            sceneNumber: 1,
            narration: 'Scene 1 original narration',
            imagePrompt: 'Scene 1 prompt',
          },
          {
            sceneNumber: 2,
            narration: 'Scene 2 original narration',
            imagePrompt: 'Scene 2 prompt',
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await StoryRepository.saveStory(mockProjectId, story);

      // Patch scene 2 narration and mood
      const updated = await StoryRepository.updateScene(mockProjectId, 2, {
        narration: 'Scene 2 patched narration',
        mood: 'cinematic',
      });

      expect(updated.scenes[1]!.sceneNumber).toBe(2);
      expect(updated.scenes[1]!.narration).toBe('Scene 2 patched narration');
      expect(updated.scenes[1]!.mood).toBe('cinematic');
      expect(updated.scenes[1]!.imagePrompt).toBe('Scene 2 prompt'); // preserved

      // Scene 1 untouched
      expect(updated.scenes[0]!.narration).toBe('Scene 1 original narration');

      // Attempting to update a non-existent scene throws
      await expect(
        StoryRepository.updateScene(mockProjectId, 99, { narration: 'Ghost' })
      ).rejects.toThrow(/Scene 99 not found/);
    } finally {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    }
  });
});
