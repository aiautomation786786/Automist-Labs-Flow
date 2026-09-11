/**
 * ScriptValidator – Deterministic validation for structured Story and Scene entities.
 *
 * Ensures data integrity before a Story is accepted into the Create Video pipeline.
 * Rules enforced:
 *  1. Title must be a valid, non-empty string (max 250 chars).
 *  2. Story must contain at least one valid scene.
 *  3. Scene numbers must be strictly continuous (1..N) without duplicates or gaps.
 *  4. Image prompt is mandatory on every scene (cannot be empty or whitespace only).
 *  5. Empty scenes (missing both image prompt and narration) are prohibited.
 *  6. Phantom scenes (e.g. accidental title or thumbnail preambles) are detected and flagged.
 *  7. Calculates accurate word counts and estimated speech durations (~2.5 words/sec, min 3s/scene).
 */

import type { SceneEntity, StoryEntity, StoryValidationIssue, StoryValidationResult } from './types';

export class ScriptValidator {
  /**
   * Words-per-second speech constant (~150 words per minute = 2.5 words/sec).
   */
  public static readonly WORDS_PER_SECOND = 2.5;
  public static readonly MIN_SCENE_DURATION_SECONDS = 3;
  public static readonly MAX_TITLE_LENGTH = 250;

  /**
   * Validates a partial or full StoryEntity.
   */
  static validate(story: Partial<StoryEntity>): StoryValidationResult {
    const errors: StoryValidationIssue[] = [];
    const warnings: StoryValidationIssue[] = [];

    // 1. Validate Title
    const rawTitle = story.title;
    if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
      errors.push({
        field: 'title',
        message: 'Project title is required and cannot be empty.',
        severity: 'error',
      });
    } else if (rawTitle.trim().length > this.MAX_TITLE_LENGTH) {
      errors.push({
        field: 'title',
        message: `Title exceeds ${this.MAX_TITLE_LENGTH} characters.`,
        severity: 'error',
      });
    }

    // 2. Validate Scenes Array Presence & Length
    const scenes = story.scenes;
    if (!Array.isArray(scenes) || scenes.length === 0) {
      errors.push({
        field: 'scenes',
        message: 'The story must contain at least one scene before project creation.',
        severity: 'error',
      });

      return {
        isValid: false,
        errors,
        warnings,
        totalWords: 0,
        estimatedDurationSeconds: 0,
        stats: {
          sceneCount: 0,
          validSceneCount: 0,
          errorSceneCount: 0,
          warningSceneCount: 0,
          totalWords: 0,
          estimatedDurationSeconds: 0,
        },
      };
    }

    // 3. Validate Scene Indexing & Sequential Continuity
    const seenNumbers = new Set<number>();

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (typeof s.sceneNumber !== 'number' || s.sceneNumber <= 0 || !Number.isInteger(s.sceneNumber)) {
        errors.push({
          field: 'sceneNumber',
          sceneNumber: s.sceneNumber,
          message: `Scene at position ${i + 1} has an invalid scene number (${s.sceneNumber}). Expected a positive integer.`,
          severity: 'error',
        });
      } else {
        if (seenNumbers.has(s.sceneNumber)) {
          errors.push({
            field: 'sceneNumber',
            sceneNumber: s.sceneNumber,
            message: `Duplicate scene number detected: Scene ${s.sceneNumber} appears more than once.`,
            severity: 'error',
          });
        }
        seenNumbers.add(s.sceneNumber);

        if (s.sceneNumber !== i + 1) {
          errors.push({
            field: 'sceneNumber',
            sceneNumber: s.sceneNumber,
            message: `Non-contiguous scene numbering: expected ${i + 1}, got ${s.sceneNumber}.`,
            severity: 'error',
          });
        }
      }
    }

    // 4. Validate Individual Scenes Content
    let totalWords = 0;
    let totalDuration = 0;

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const sceneNum = s.sceneNumber ?? i + 1;
      const promptText = (s.imagePrompt || '').trim();
      const narrationText = (s.narration || '').trim();

      // Check for completely empty scene
      if (!promptText && !narrationText) {
        errors.push({
          field: 'scene',
          sceneNumber: sceneNum,
          message: `Scene ${sceneNum} is completely empty (no image prompt or narration).`,
          severity: 'error',
        });
        continue;
      }

      // Check Image Prompt (Mandatory)
      if (!promptText) {
        errors.push({
          field: 'imagePrompt',
          sceneNumber: sceneNum,
          message: `Scene ${sceneNum} is missing an image prompt. Every scene requires a prompt to generate visuals.`,
          severity: 'error',
        });
      }

      // Check Narration
      if (!narrationText) {
        warnings.push({
          field: 'narration',
          sceneNumber: sceneNum,
          message: `Scene ${sceneNum} has no voiceover narration (will play silent visual).`,
          severity: 'warning',
        });
      }

      // Phantom Preamble Detection in prompt or narration
      if (promptText.includes('TITLE:') || promptText.includes('THUMBNAIL:')) {
        warnings.push({
          field: 'imagePrompt',
          sceneNumber: sceneNum,
          message: `Scene ${sceneNum} prompt contains metadata keyword (TITLE:/THUMBNAIL:). Verify this is intended.`,
          severity: 'warning',
        });
      }
      if (narrationText.includes('TITLE:') || narrationText.includes('THUMBNAIL:')) {
        warnings.push({
          field: 'narration',
          sceneNumber: sceneNum,
          message: `Scene ${sceneNum} narration contains metadata keyword (TITLE:/THUMBNAIL:). Verify this is intended.`,
          severity: 'warning',
        });
      }

      // Calculate Word Count and Duration
      const words = narrationText ? narrationText.split(/\s+/).filter(Boolean).length : 0;
      const duration = words > 0
        ? Math.max(this.MIN_SCENE_DURATION_SECONDS, Math.round(words / this.WORDS_PER_SECOND))
        : this.MIN_SCENE_DURATION_SECONDS;

      totalWords += words;
      totalDuration += duration;
    }

    const sceneErrorNumbers = new Set(
      errors.filter((e) => typeof e.sceneNumber === 'number').map((e) => e.sceneNumber as number)
    );
    const sceneWarningNumbers = new Set(
      warnings.filter((w) => typeof w.sceneNumber === 'number').map((w) => w.sceneNumber as number)
    );
    const errorSceneCount = sceneErrorNumbers.size;
    const validSceneCount = Math.max(0, scenes.length - errorSceneCount);
    const warningSceneCount = sceneWarningNumbers.size;

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      totalWords,
      estimatedDurationSeconds: totalDuration,
      stats: {
        sceneCount: scenes.length,
        validSceneCount,
        errorSceneCount,
        warningSceneCount,
        totalWords,
        estimatedDurationSeconds: totalDuration,
      },
    };
  }

  /**
   * Enforces contiguous 1..N scene numbering on a list of scenes.
   */
  static renumberScenes(scenes: SceneEntity[]): SceneEntity[] {
    return scenes.map((scene, idx) => ({
      ...scene,
      sceneNumber: idx + 1,
    }));
  }

  /**
   * Calculates metrics (word count and estimated duration) for a single scene.
   */
  static computeSceneMetrics(narration: string): { wordCount: number; durationSeconds: number } {
    const trimmed = (narration || '').trim();
    if (!trimmed) {
      return { wordCount: 0, durationSeconds: this.MIN_SCENE_DURATION_SECONDS };
    }
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(
      this.MIN_SCENE_DURATION_SECONDS,
      Math.round(wordCount / this.WORDS_PER_SECOND)
    );
    return { wordCount, durationSeconds };
  }
}
