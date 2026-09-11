/**
 * MotionPlanner – Resolves camera motion styles, manages clipMotionKey,
 * and coordinates AUTO / AI Director per-scene motion planning.
 *
 * Responsibilities:
 *  1. CLIP_RENDER_VERSION: Integer tracking rendering engine version.
 *  2. clipMotionKey: Standardized key 'on|<style>|<transition>' or 'off|<transition>'.
 *  3. AUTO Mode: Anti-repetition cinematic rotation across scenes.
 *  4. AI Director Mode: Mood-driven camera motion selection with anti-repetition guards.
 *  5. Cache Validation & Invalidation: Determines whether existing clips on disk are still valid.
 */

import type {
  MotionStyle,
  TransitionStyle,
  SceneEntity,
  RenderSceneResult,
} from '../../shared/types';
import { CLIP_RENDER_VERSION } from '../../shared/types';

export { CLIP_RENDER_VERSION };

/**
 * Curated list of complementary cinematic motion styles for AUTO mode.
 * Rotates smoothly so consecutive scenes never repeat the same motion.
 */
export const AUTO_ROTATION_POOL: MotionStyle[] = [
  'breathe',
  'pan_right',
  'zoom_in',
  'pan_left',
  'cinematic_dolly',
  'drift',
  'ken_burns',
  'parallax',
  'zoom_out',
];

export interface ResolveMotionOptions {
  mode: MotionStyle;
  motionEnabled?: boolean;
  transitionStyle?: TransitionStyle;
  scene: SceneEntity;
  sceneIndex: number;
  totalScenes?: number;
  previousStyle?: MotionStyle;
}

export interface ResolvedSceneMotion {
  motionStyle: MotionStyle;
  motionEnabled: boolean;
  transitionStyle: TransitionStyle;
  clipMotionKey: string;
  renderVersion: number;
}

export class MotionPlanner {
  /**
   * Generates a deterministic clipMotionKey.
   * Format:
   *  - When motion is ON:  'on|<motionStyle>|<transitionStyle>'
   *  - When motion is OFF: 'off|<transitionStyle>'
   */
  static buildClipMotionKey(
    motionEnabled: boolean,
    motionStyle: MotionStyle,
    transitionStyle: TransitionStyle = 'hard_cut'
  ): string {
    const cleanTrans = transitionStyle || 'hard_cut';
    if (!motionEnabled || motionStyle === 'none') {
      return `off|${cleanTrans}`;
    }
    const cleanStyle = motionStyle || 'breathe';
    return `on|${cleanStyle}|${cleanTrans}`;
  }

  /**
   * Resolves the effective camera motion style for a specific scene.
   */
  static resolveSceneMotion(options: ResolveMotionOptions): ResolvedSceneMotion {
    const {
      mode,
      motionEnabled = true,
      transitionStyle = 'hard_cut',
      scene,
      sceneIndex,
      previousStyle,
    } = options;

    // Master motion OFF or explicitly 'none'
    if (!motionEnabled || mode === 'none') {
      return {
        motionStyle: 'none',
        motionEnabled: false,
        transitionStyle,
        clipMotionKey: this.buildClipMotionKey(false, 'none', transitionStyle),
        renderVersion: CLIP_RENDER_VERSION,
      };
    }

    let resolvedStyle: MotionStyle;

    if (mode === 'auto') {
      resolvedStyle = this.resolveAutoMotion(sceneIndex, previousStyle);
    } else if (mode === 'ai_director') {
      resolvedStyle = this.resolveAiDirectorMotion(scene, sceneIndex, previousStyle);
    } else {
      // Explicit concrete motion style (e.g. 'breathe', 'crash_zoom', etc.)
      resolvedStyle = mode || 'breathe';
    }

    return {
      motionStyle: resolvedStyle,
      motionEnabled: true,
      transitionStyle,
      clipMotionKey: this.buildClipMotionKey(true, resolvedStyle, transitionStyle),
      renderVersion: CLIP_RENDER_VERSION,
    };
  }

  /**
   * AUTO Mode: Deterministic anti-repetition rotation across scenes.
   */
  static resolveAutoMotion(sceneIndex: number, previousStyle?: MotionStyle): MotionStyle {
    const pool = AUTO_ROTATION_POOL;
    let chosen = pool[sceneIndex % pool.length]!;

    // Anti-repetition safeguard
    if (chosen === previousStyle) {
      chosen = pool[(sceneIndex + 1) % pool.length]!;
    }
    return chosen;
  }

  /**
   * AI Director Mode: Resolves camera motion from scene mood and narration sentiment.
   */
  static resolveAiDirectorMotion(
    scene: SceneEntity,
    sceneIndex: number,
    previousStyle?: MotionStyle
  ): MotionStyle {
    const moodText = (scene.mood || '').toLowerCase().trim();
    const narrationText = (scene.narration || '').toLowerCase();
    const combined = `${moodText} ${narrationText}`;

    let candidates: MotionStyle[];

    if (this.matchesAny(combined, ['epic', 'intense', 'battle', 'war', 'heroic', 'explosion', 'urgent', 'shock', 'climax', 'danger', 'fury', 'action', 'extreme'])) {
      candidates = ['crash_zoom', 'snap_zoom', 'whip_pan_right', 'zoom_in', 'shake'];
    } else if (this.matchesAny(combined, ['calm', 'peaceful', 'relaxing', 'nature', 'ambient', 'serene', 'wonder', 'beautiful', 'gentle', 'soft', 'slow', 'zen', 'soothing'])) {
      candidates = ['breathe', 'drift', 'pan_right', 'zoom_out'];
    } else if (this.matchesAny(combined, ['mystery', 'mysterious', 'dark', 'suspense', 'thriller', 'noir', 'shadow', 'eerie', 'curious', 'secret', 'hidden', 'fear'])) {
      candidates = ['cinematic_dolly', 'parallax', 'zoom_in', 'pan_left'];
    } else if (this.matchesAny(combined, ['documentary', 'history', 'historical', 'ancient', 'narrative', 'biography', 'informative', 'educational', 'science', 'facts'])) {
      candidates = ['ken_burns', 'pan_left', 'pan_right', 'zoom_out'];
    } else if (this.matchesAny(combined, ['fast', 'sprint', 'race', 'run', 'chase', 'kinetic', 'quick', 'speed'])) {
      candidates = ['whip_pan_left', 'whip_pan_right', 'crash_zoom', 'snap_zoom'];
    } else if (this.matchesAny(combined, ['sad', 'melancholy', 'somber', 'emotional', 'thoughtful', 'nostalgic', 'reflective', 'tragic', 'grief'])) {
      candidates = ['zoom_out', 'breathe', 'drift'];
    } else {
      // Default cinematic pool
      candidates = ['breathe', 'pan_right', 'zoom_in', 'cinematic_dolly', 'pan_left', 'drift'];
    }

    // Pick candidate based on scene index for variety
    let chosen = candidates[sceneIndex % candidates.length]!;

    // Anti-repetition safeguard: avoid consecutive duplicate motion
    if (chosen === previousStyle && candidates.length > 1) {
      chosen = candidates[(sceneIndex + 1) % candidates.length]!;
    }

    return chosen;
  }

  private static matchesAny(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }

  /**
   * Evaluates whether an existing rendered clip is still valid or must be invalidated.
   *
   * Cache Invalidation Rules:
   *  1. Matching clipMotionKey + matching CLIP_RENDER_VERSION + valid file on disk -> CACHE HIT.
   *  2. Changed motion setting (motionStyle, motionEnabled, transitionStyle) -> CACHE INVALIDATION.
   *  3. Bumped CLIP_RENDER_VERSION -> CACHE INVALIDATION.
   *  4. Missing or corrupted output -> CACHE INVALIDATION.
   */
  static isClipCacheValid(
    existingClipResult: RenderSceneResult | undefined,
    expectedKey: string,
    expectedVersion: number = CLIP_RENDER_VERSION
  ): boolean {
    if (!existingClipResult) return false;
    if (existingClipResult.status !== 'completed') return false;
    if (!existingClipResult.durationSeconds || existingClipResult.durationSeconds <= 0) return false;
    if (!existingClipResult.fileSizeBytes || existingClipResult.fileSizeBytes <= 1000) return false;

    // Check version
    if (existingClipResult.renderVersion !== expectedVersion) {
      return false;
    }

    // Check motion key
    if (existingClipResult.clipMotionKey !== expectedKey) {
      return false;
    }

    return true;
  }
}
