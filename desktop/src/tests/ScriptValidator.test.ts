import { describe, it, expect } from 'vitest';
import { ScriptValidator } from '../shared/ScriptValidator';
import type { StoryEntity, SceneEntity } from '../shared/types';

describe('ScriptValidator Unit Tests', () => {
  it('1. Validates a well-formed story with 0 errors', () => {
    const story: StoryEntity = {
      title: 'Voyage to the Deep',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Deep underwater creatures live in eternal darkness.',
          imagePrompt: 'Bioluminescent anglerfish swimming near hydrothermal vent, dark water',
          mood: 'mysterious',
        },
        {
          sceneNumber: 2,
          narration: 'Submersibles bring illumination to the seabed.',
          imagePrompt: 'Yellow exploration submarine with bright searchlights on ocean floor',
          mood: 'adventurous',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.stats.sceneCount).toBe(2);
    expect(res.stats.validSceneCount).toBe(2);
    expect(res.stats.totalWords).toBeGreaterThan(10);
    expect(res.stats.estimatedDurationSeconds).toBeGreaterThan(5);
  });

  it('2. Flags empty title as error', () => {
    const story: Partial<StoryEntity> = {
      title: '   ',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Hello',
          imagePrompt: 'A futuristic city',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.field === 'title')).toBe(true);
  });

  it('3. Flags excessively long title (> 250 characters)', () => {
    const longTitle = 'A'.repeat(251);
    const story: Partial<StoryEntity> = {
      title: longTitle,
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Narration text',
          imagePrompt: 'Prompt text',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.errors.some((e) => e.field === 'title' && e.message.includes('250'))).toBe(true);
  });

  it('4. Flags empty scene list (scene count = 0)', () => {
    const story: Partial<StoryEntity> = {
      title: 'Valid Title',
      scenes: [],
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.field === 'scenes')).toBe(true);
  });

  it('5. Flags scene with missing or empty image prompt', () => {
    const story: Partial<StoryEntity> = {
      title: 'Missing Prompt Story',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Narration without an image prompt.',
          imagePrompt: '   ',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.sceneNumber === 1 && e.field === 'imagePrompt')).toBe(true);
    expect(res.stats.errorSceneCount).toBe(1);
  });

  it('6. Flags completely empty scene (no prompt and no narration)', () => {
    const story: Partial<StoryEntity> = {
      title: 'Empty Scene Story',
      scenes: [
        {
          sceneNumber: 1,
          narration: '',
          imagePrompt: '',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.sceneNumber === 1 && e.field === 'scene')).toBe(true);
  });

  it('7. Flags duplicate scene numbers', () => {
    const story: Partial<StoryEntity> = {
      title: 'Duplicate Scene Numbers',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'First scene',
          imagePrompt: 'First scene prompt',
        },
        {
          sceneNumber: 1,
          narration: 'Duplicate first scene',
          imagePrompt: 'Duplicate scene prompt',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.field === 'sceneNumber' && e.message.includes('Duplicate'))).toBe(true);
  });

  it('8. Flags non-contiguous scene numbers or gaps', () => {
    const story: Partial<StoryEntity> = {
      title: 'Gapped Scene Numbers',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Scene 1',
          imagePrompt: 'Prompt 1',
        },
        {
          sceneNumber: 3, // gap!
          narration: 'Scene 3',
          imagePrompt: 'Prompt 3',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.field === 'sceneNumber' && e.message.includes('expected 2'))).toBe(true);
  });

  it('9. Detects preamble keywords leaked into scene narration or prompt', () => {
    const story: Partial<StoryEntity> = {
      title: 'Preamble Leak',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'TITLE: Leaked title in narration',
          imagePrompt: 'THUMBNAIL: Leaked thumbnail in image prompt',
        },
      ],
    };

    const res = ScriptValidator.validate(story);
    expect(res.warnings.some((w) => w.sceneNumber === 1 && w.message.includes('TITLE:'))).toBe(true);
    expect(res.warnings.some((w) => w.sceneNumber === 1 && w.message.includes('THUMBNAIL:'))).toBe(true);
  });

  it('10. computeSceneMetrics calculates word count and duration properly', () => {
    // 10 words at 2.5 words/sec -> 4 seconds
    const metrics1 = ScriptValidator.computeSceneMetrics('One two three four five six seven eight nine ten.');
    expect(metrics1.wordCount).toBe(10);
    expect(metrics1.durationSeconds).toBe(4);

    // Empty narration falls back to minimum 3 seconds
    const metrics2 = ScriptValidator.computeSceneMetrics('');
    expect(metrics2.wordCount).toBe(0);
    expect(metrics2.durationSeconds).toBe(3);

    // 2 words -> 2 / 2.5 = 0.8s, clamped to minimum 3 seconds
    const metrics3 = ScriptValidator.computeSceneMetrics('Quick shot');
    expect(metrics3.wordCount).toBe(2);
    expect(metrics3.durationSeconds).toBe(3);
  });

  it('11. renumberScenes correctly normalizes scene numbers to 1..N sequence', () => {
    const disorderlyScenes: SceneEntity[] = [
      { sceneNumber: 99, narration: 'Ninety nine', imagePrompt: 'Prompt 99' },
      { sceneNumber: 5, narration: 'Five', imagePrompt: 'Prompt 5' },
      { sceneNumber: 12, narration: 'Twelve', imagePrompt: 'Prompt 12' },
    ];

    const renumbered = ScriptValidator.renumberScenes(disorderlyScenes);
    expect(renumbered).toHaveLength(3);
    expect(renumbered[0]!.sceneNumber).toBe(1);
    expect(renumbered[0]!.imagePrompt).toBe('Prompt 99');
    expect(renumbered[1]!.sceneNumber).toBe(2);
    expect(renumbered[1]!.imagePrompt).toBe('Prompt 5');
    expect(renumbered[2]!.sceneNumber).toBe(3);
    expect(renumbered[2]!.imagePrompt).toBe('Prompt 12');
  });
});
