import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  MotionFilterBuilder,
  getAllMotionStyles,
  getProMotionStyles,
  getUltraMotionStyles,
  isMotionStyleSupported,
} from '../main/render/MotionFilterBuilder';
import {
  MotionPlanner,
  CLIP_RENDER_VERSION,
  AUTO_ROTATION_POOL,
} from '../main/render/MotionPlanner';
import { SceneRenderer } from '../main/render/SceneRenderer';
import { RenderManager } from '../main/render/RenderManager';
import { PipelineStageValidator } from '../main/pipeline/PipelineStageValidator';
import { StoryRepository } from '../main/storage/StoryRepository';
import { AssetManager } from '../main/storage/AssetManager';
import type {
  MotionStyle,
  SceneEntity,
  StoryManifest,
  RenderSceneResult,
} from '../shared/types';

const setMockBehavior = (b: 'success' | 'hang' | 'pass-through') => {
  (globalThis as any).__mockSpawnBehavior = b;
};

vi.mock('child_process', async (importOriginal) => {
  const actual: any = await importOriginal();
  const { EventEmitter } = await import('events');

  const customSpawn = (...args: any[]) => {
    const behavior = (globalThis as any).__mockSpawnBehavior || 'pass-through';
    if (behavior === 'pass-through') {
      const origSpawn = actual.spawn || actual.default?.spawn;
      return origSpawn ? origSpawn.apply(actual, args) : actual.spawn(...args);
    }

    const proc: any = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.killed = false;
    proc.kill = vi.fn((sig) => {
      proc.killed = true;
      proc.emit('close', 1, sig);
    });
    (globalThis as any).__lastSpawnedChild = proc;

    if (behavior === 'success') {
      const argsList = args[1];
      const targetFile = Array.isArray(argsList) ? argsList[argsList.length - 1] : null;
      if (targetFile && typeof targetFile === 'string' && targetFile.includes('.mp4')) {
        try {
          fs.writeFileSync(targetFile, Buffer.alloc(10000));
        } catch {}
      }
      setTimeout(() => {
        proc.emit('close', 0);
      }, 10);
    }
    return proc;
  };

  return {
    ...actual,
    default: {
      ...actual?.default,
      spawn: customSpawn,
    },
    spawn: customSpawn,
  };
});

describe('Phase 5 — Complete ZBot Motion System Parity', () => {
  const tmpDirs: string[] = [];

  const createTempProject = (projectId: string) => {
    const root = path.join(os.tmpdir(), `if-phase5-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(root, { recursive: true });
    tmpDirs.push(root);

    // Mock AssetManager root
    vi.spyOn(AssetManager, 'getProjectDir').mockImplementation((pid: string) => {
      const p = path.join(root, pid);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      return p;
    });

    return root;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of tmpDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    tmpDirs.length = 0;
  });

  // =========================================================================
  // 1. COMPLETE MOTION CATALOGUE & FILTER SYNTHESIS
  // =========================================================================
  describe('1. Motion Catalogue & Filter Synthesis', () => {
    const allConcreteStyles = getAllMotionStyles();

    it('advertises all 20 concrete motion styles across PRO, ULTRA, and static', () => {
      expect(allConcreteStyles).toHaveLength(20);
      expect(getProMotionStyles()).toHaveLength(10);
      expect(getUltraMotionStyles()).toHaveLength(9);

      // PRO Tier
      const proExpected = [
        'breathe', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right',
        'pan_up', 'pan_down', 'cinematic_dolly', 'drift', 'parallax',
      ];
      for (const p of proExpected) {
        expect(getProMotionStyles()).toContain(p);
        expect(isMotionStyleSupported(p as MotionStyle)).toBe(true);
      }

      // ULTRA Tier
      const ultraExpected = [
        'crash_zoom', 'bullet_time', 'ken_burns', 'whip_pan_left', 'whip_pan_right',
        'snap_zoom', 'dolly_zoom', 'shake', 'pulse',
      ];
      for (const u of ultraExpected) {
        expect(getUltraMotionStyles()).toContain(u);
        expect(isMotionStyleSupported(u as MotionStyle)).toBe(true);
      }

      // Static
      expect(allConcreteStyles).toContain('none');
      expect(isMotionStyleSupported('none')).toBe(true);

      // Smart modes supported check
      expect(isMotionStyleSupported('auto')).toBe(true);
      expect(isMotionStyleSupported('ai_director')).toBe(true);
    });

    it('generates valid FFmpeg filtergraphs for every advertised motion style without expression syntax errors', () => {
      for (const style of allConcreteStyles) {
        const filterStr = MotionFilterBuilder.buildFilter({
          motionStyle: style,
          durationSeconds: 4.0,
          aspectRatio: '16:9',
          fps: 25,
        });

        expect(filterStr).toBeTruthy();
        expect(typeof filterStr).toBe('string');

        if (style === 'none') {
          expect(filterStr).toContain('scale=1280:720');
          expect(filterStr).not.toContain('zoompan');
        } else {
          expect(filterStr).toContain('zoompan=');
          expect(filterStr).toContain('s=1280x720');
          expect(filterStr).toContain('d=100'); // 4.0s * 25fps = 100 frames

          // FFmpeg expression safety checks:
          // Never use bare '/d' in zoompan expression (FFmpeg parser bug)
          expect(filterStr).not.toMatch(/\/d[\),]/);
          // Never leave un-substituted duration or totalFrames tokens
          expect(filterStr).not.toContain('NaN');
          expect(filterStr).not.toContain('undefined');
        }
      }
    });

    it('generates accurate 9:16 vertical dimensions for portrait videos', () => {
      const verticalFilter = MotionFilterBuilder.buildFilter({
        motionStyle: 'crash_zoom',
        durationSeconds: 2.5,
        aspectRatio: '9:16',
        fps: 30,
      });

      expect(verticalFilter).toContain('s=720x1280');
      expect(verticalFilter).toContain('d=75'); // 2.5 * 30 = 75
    });
  });

  // =========================================================================
  // 2. AUTO MODE (ANTI-REPETITION CINEMATIC ROTATION)
  // =========================================================================
  describe('2. AUTO Mode Rotation', () => {
    it('rotates deterministically through the curated cinematic pool across consecutive scenes', () => {
      const dummyScene: SceneEntity = {
        sceneNumber: 1,
        narration: 'A scene description',
        imagePrompt: 'A dramatic vista',
      };

      const stylesSelected: MotionStyle[] = [];
      let lastStyle: MotionStyle | undefined;

      for (let i = 0; i < 15; i++) {
        const resolved = MotionPlanner.resolveSceneMotion({
          mode: 'auto',
          motionEnabled: true,
          transitionStyle: 'hard_cut',
          scene: { ...dummyScene, sceneNumber: i + 1 },
          sceneIndex: i,
          totalScenes: 15,
          previousStyle: lastStyle,
        });

        stylesSelected.push(resolved.motionStyle);
        // Consecutive scenes must never repeat the exact same motion style
        if (lastStyle) {
          expect(resolved.motionStyle).not.toBe(lastStyle);
        }
        lastStyle = resolved.motionStyle;
      }

      expect(stylesSelected.length).toBe(15);
      // Ensure variety: at least 5 different styles used over 15 scenes
      const uniqueStyles = new Set(stylesSelected);
      expect(uniqueStyles.size).toBeGreaterThanOrEqual(5);
    });

    it('actively avoids repeat when raw index would land on previousStyle', () => {
      const pool = AUTO_ROTATION_POOL;
      const targetStyle = pool[0]; // e.g. 'breathe'

      // Force previousStyle to match what index 0 would pick
      const resolved = MotionPlanner.resolveAutoMotion(0, targetStyle);
      expect(resolved).not.toBe(targetStyle);
    });
  });

  // =========================================================================
  // 3. AI DIRECTOR MODE (MOOD-DRIVEN CAMERA SELECTION)
  // =========================================================================
  describe('3. AI Director Mode', () => {
    it('selects high-energy action styles for epic/intense moods', () => {
      const epicScene: SceneEntity = {
        sceneNumber: 1,
        mood: 'epic battle climax with explosions',
        narration: 'The warriors clashed with fury.',
      };

      const resolved = MotionPlanner.resolveSceneMotion({
        mode: 'ai_director',
        scene: epicScene,
        sceneIndex: 0,
      });

      const epicCandidates: MotionStyle[] = ['crash_zoom', 'snap_zoom', 'whip_pan_right', 'zoom_in', 'shake'];
      expect(epicCandidates).toContain(resolved.motionStyle);
    });

    it('selects calming ambient styles for serene/peaceful moods', () => {
      const calmScene: SceneEntity = {
        sceneNumber: 1,
        mood: 'calm and serene zen garden',
        narration: 'Water gently trickles past the stones.',
      };

      const resolved = MotionPlanner.resolveSceneMotion({
        mode: 'ai_director',
        scene: calmScene,
        sceneIndex: 0,
      });

      const calmCandidates: MotionStyle[] = ['breathe', 'drift', 'pan_right', 'zoom_out'];
      expect(calmCandidates).toContain(resolved.motionStyle);
    });

    it('selects documentary styles (ken_burns, pan) for historical/educational scenes', () => {
      const docScene: SceneEntity = {
        sceneNumber: 1,
        mood: 'historical documentary narrative',
        narration: 'In the ancient archives of 1842...',
      };

      const resolved = MotionPlanner.resolveSceneMotion({
        mode: 'ai_director',
        scene: docScene,
        sceneIndex: 0,
      });

      const docCandidates: MotionStyle[] = ['ken_burns', 'pan_left', 'pan_right', 'zoom_out'];
      expect(docCandidates).toContain(resolved.motionStyle);
    });

    it('falls back to narration sentiment when scene mood is not explicitly provided', () => {
      const sceneNoMood: SceneEntity = {
        sceneNumber: 2,
        narration: 'An extreme high-speed car chase sprinted through the highway.',
      };

      const resolved = MotionPlanner.resolveSceneMotion({
        mode: 'ai_director',
        scene: sceneNoMood,
        sceneIndex: 1,
      });

      const speedCandidates: MotionStyle[] = ['whip_pan_left', 'whip_pan_right', 'crash_zoom', 'snap_zoom'];
      expect(speedCandidates).toContain(resolved.motionStyle);
    });

    it('enforces anti-repetition protection across consecutive AI Director scenes with similar mood', () => {
      const scene1: SceneEntity = { sceneNumber: 1, mood: 'epic battle', narration: 'Strike one' };
      const scene2: SceneEntity = { sceneNumber: 2, mood: 'epic explosion', narration: 'Strike two' };

      const res1 = MotionPlanner.resolveSceneMotion({
        mode: 'ai_director',
        scene: scene1,
        sceneIndex: 0,
      });

      const res2 = MotionPlanner.resolveSceneMotion({
        mode: 'ai_director',
        scene: scene2,
        sceneIndex: 1,
        previousStyle: res1.motionStyle,
      });

      expect(res2.motionStyle).not.toBe(res1.motionStyle);
    });
  });

  // =========================================================================
  // 4. CLIP MOTION KEY DETERMINISM & COMPLIANCE
  // =========================================================================
  describe('4. clipMotionKey Determinism', () => {
    it('produces standard "on|<style>|<transition>" when motion is enabled', () => {
      const key1 = MotionPlanner.buildClipMotionKey(true, 'crash_zoom', 'hard_cut');
      expect(key1).toBe('on|crash_zoom|hard_cut');

      const key2 = MotionPlanner.buildClipMotionKey(true, 'ken_burns', 'cross_fade');
      expect(key2).toBe('on|ken_burns|cross_fade');
    });

    it('produces standard "off|<transition>" when motion is disabled or style is "none"', () => {
      const keyOff = MotionPlanner.buildClipMotionKey(false, 'breathe', 'hard_cut');
      expect(keyOff).toBe('off|hard_cut');

      const keyNone = MotionPlanner.buildClipMotionKey(true, 'none', 'cross_fade');
      expect(keyNone).toBe('off|cross_fade');
    });

    it('defaults transition to "hard_cut" when omitted', () => {
      const key = MotionPlanner.buildClipMotionKey(true, 'parallax');
      expect(key).toBe('on|parallax|hard_cut');
    });
  });

  // =========================================================================
  // 5. CACHE VALIDATION & INVALIDATION RULES
  // =========================================================================
  describe('5. Cache Validation & Invalidation', () => {
    const validClipResult: RenderSceneResult = {
      sceneNumber: 1,
      videoFile: 'renders/scene-001.mp4',
      absoluteVideoPath: '/tmp/renders/scene-001.mp4',
      durationSeconds: 4.5,
      fileSizeBytes: 250_000,
      status: 'completed',
      clipMotionKey: 'on|breathe|hard_cut',
      renderVersion: CLIP_RENDER_VERSION,
    };

    it('identifies valid cache hit when key, version, and file exist', () => {
      const isValid = MotionPlanner.isClipCacheValid(
        validClipResult,
        'on|breathe|hard_cut',
        CLIP_RENDER_VERSION
      );
      expect(isValid).toBe(true);
    });

    it('invalidates cache when motion style or transition changed', () => {
      const isValidStyleChanged = MotionPlanner.isClipCacheValid(
        validClipResult,
        'on|zoom_in|hard_cut', // changed from breathe
        CLIP_RENDER_VERSION
      );
      expect(isValidStyleChanged).toBe(false);

      const isValidTransChanged = MotionPlanner.isClipCacheValid(
        validClipResult,
        'on|breathe|cross_fade', // changed from hard_cut
        CLIP_RENDER_VERSION
      );
      expect(isValidTransChanged).toBe(false);
    });

    it('invalidates cache when motion toggled from ON to OFF', () => {
      const isValidToggled = MotionPlanner.isClipCacheValid(
        validClipResult,
        'off|hard_cut',
        CLIP_RENDER_VERSION
      );
      expect(isValidToggled).toBe(false);
    });

    it('invalidates cache when CLIP_RENDER_VERSION is bumped', () => {
      const isValidBumped = MotionPlanner.isClipCacheValid(
        validClipResult,
        'on|breathe|hard_cut',
        CLIP_RENDER_VERSION + 1 // New engine version
      );
      expect(isValidBumped).toBe(false);
    });

    it('invalidates cache when result was incomplete or corrupted', () => {
      const failedResult: RenderSceneResult = {
        ...validClipResult,
        status: 'failed',
      };
      expect(MotionPlanner.isClipCacheValid(failedResult, 'on|breathe|hard_cut')).toBe(false);

      const emptyFileResult: RenderSceneResult = {
        ...validClipResult,
        fileSizeBytes: 100, // Too small
      };
      expect(MotionPlanner.isClipCacheValid(emptyFileResult, 'on|breathe|hard_cut')).toBe(false);
    });
  });

  // =========================================================================
  // 6. ATTEMPT 3 FALLBACK & WATCHDOG TIMEOUT
  // =========================================================================
  describe('6. Attempt 3 Fallback & Watchdog', () => {
    it('applies static fallback (none + hard_cut) when attempt >= 3', async () => {
      const tmpDir = path.join(os.tmpdir(), `if-fallback-test-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      tmpDirs.push(tmpDir);

      const imgPath = path.join(tmpDir, 'test.png');
      const audioPath = path.join(tmpDir, 'test.mp3');
      const outPath = path.join(tmpDir, 'out.mp4');

      fs.writeFileSync(imgPath, Buffer.alloc(100));
      fs.writeFileSync(audioPath, Buffer.alloc(100));

      // Spy on MotionFilterBuilder.buildFilter to observe applied style
      const buildFilterSpy = vi.spyOn(MotionFilterBuilder, 'buildFilter');

      // Mock validateClip to verify fallback without needing real ffprobe on temp output
      vi.spyOn(SceneRenderer as any, 'validateClip').mockResolvedValue({
        valid: true,
        duration: 2.0,
        sizeBytes: 50_000,
      });

      setMockBehavior('success');

      const result = await SceneRenderer.renderScene({
        projectId: 'test-fallback',
        sceneNumber: 1,
        imagePath: imgPath,
        audioPath: audioPath,
        durationSeconds: 2.0,
        motionStyle: 'crash_zoom', // aggressive style requested
        transitionStyle: 'cross_fade',
        attempt: 3, // ATTEMPT 3 FALLBACK TRIGGER
        outputVideoPath: outPath,
      });

      setMockBehavior('pass-through');

      // Must have invoked buildFilter with 'none'
      expect(buildFilterSpy).toHaveBeenCalledWith(
        expect.objectContaining({ motionStyle: 'none' })
      );

      // Result metadata must record fallback
      expect(result.fallbackApplied).toBe(true);
      expect(result.appliedMotionStyle).toBe('none');
      expect(result.clipMotionKey).toBe('off|hard_cut');
      expect(result.attempt).toBe(3);
    });

    it('triggers watchdog and terminates child process on timeout', async () => {
      const tmpDir = path.join(os.tmpdir(), `if-watchdog-test-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      tmpDirs.push(tmpDir);

      const imgPath = path.join(tmpDir, 'test.png');
      const audioPath = path.join(tmpDir, 'test.mp3');
      const outPath = path.join(tmpDir, 'out.mp4');

      fs.writeFileSync(imgPath, Buffer.alloc(100));
      fs.writeFileSync(audioPath, Buffer.alloc(100));

      setMockBehavior('hang');

      await expect(
        SceneRenderer.renderScene({
          projectId: 'test-watchdog',
          sceneNumber: 1,
          imagePath: imgPath,
          audioPath: audioPath,
          durationSeconds: 2.0,
          motionStyle: 'breathe',
          outputVideoPath: outPath,
          watchdogTimeoutMs: 50, // 50ms fast timeout
        })
      ).rejects.toThrow(/watchdog triggered/);

      expect((globalThis as any).__lastSpawnedChild?.kill).toHaveBeenCalledWith('SIGKILL');
      setMockBehavior('pass-through');
    });
  });

  // =========================================================================
  // 7. RENDER MANAGER CACHE REUSE & RE-RENDER ON MOTION CHANGE
  // =========================================================================
  describe('7. RenderManager Multi-Scene & Cache Invalidation', () => {
    it('skips FFmpeg on cache hit and re-renders only affected clips when motion style changes', async () => {
      const projectId = 'test-cache-proj';
      const root = createTempProject(projectId);
      const projDir = path.join(root, projectId);
      const rendersDir = path.join(projDir, 'renders');
      const audioDir = path.join(projDir, 'audio');
      fs.mkdirSync(rendersDir, { recursive: true });
      fs.mkdirSync(audioDir, { recursive: true });

      const story: StoryManifest = {
        title: 'Cache Test Story',
        scenes: [
          { sceneNumber: 1, narration: 'First scene', durationSeconds: 3.0 },
          { sceneNumber: 2, narration: 'Second scene', durationSeconds: 3.0 },
        ],
      };
      await StoryRepository.saveStory(projectId, story);

      // Create dummy audio files
      fs.writeFileSync(path.join(audioDir, 'scene-001.mp3'), Buffer.alloc(100));
      fs.writeFileSync(path.join(audioDir, 'scene-002.mp3'), Buffer.alloc(100));

      let renderSceneCallCount = 0;
      vi.spyOn(SceneRenderer, 'renderScene').mockImplementation(async (opts: any) => {
        renderSceneCallCount++;
        const dummyOut = opts.outputVideoPath;
        fs.writeFileSync(dummyOut, Buffer.alloc(50_000));
        return {
          sceneNumber: opts.sceneNumber,
          videoFile: `renders/scene-${String(opts.sceneNumber).padStart(3, '0')}.mp4`,
          absoluteVideoPath: dummyOut,
          durationSeconds: opts.durationSeconds,
          fileSizeBytes: 50_000,
          status: 'completed',
          clipMotionKey: opts.clipMotionKey,
          appliedMotionStyle: opts.motionStyle,
          renderVersion: opts.renderVersion,
          attempt: opts.attempt,
        };
      });

      // FIRST PASS: Initial render with 'breathe'
      const manifest1 = await RenderManager.renderProjectClips(projectId, {
        projectId,
        motionStyle: 'breathe',
        transitionStyle: 'hard_cut',
      });

      expect(manifest1.renderedScenes).toBe(2);
      expect(renderSceneCallCount).toBe(2);
      expect(manifest1.clipRenderVersion).toBe(CLIP_RENDER_VERSION);
      expect(manifest1.clipMotionKeys?.[1]).toBe('on|breathe|hard_cut');
      expect(manifest1.clipMotionKeys?.[2]).toBe('on|breathe|hard_cut');

      // SECOND PASS: Re-render with identical settings -> CACHE HIT!
      renderSceneCallCount = 0;
      const manifest2 = await RenderManager.renderProjectClips(projectId, {
        projectId,
        motionStyle: 'breathe',
        transitionStyle: 'hard_cut',
      });

      // No calls to SceneRenderer.renderScene because both clips were cache hits!
      expect(renderSceneCallCount).toBe(0);
      expect(manifest2.renderedScenes).toBe(2);

      // THIRD PASS: Changed motion style to 'crash_zoom' -> CACHE INVALIDATION!
      renderSceneCallCount = 0;
      const manifest3 = await RenderManager.renderProjectClips(projectId, {
        projectId,
        motionStyle: 'crash_zoom',
        transitionStyle: 'hard_cut',
      });

      // Both clips re-rendered with new motion key
      expect(renderSceneCallCount).toBe(2);
      expect(manifest3.clipMotionKeys?.[1]).toBe('on|crash_zoom|hard_cut');
      expect(manifest3.clipMotionKeys?.[2]).toBe('on|crash_zoom|hard_cut');
    });
  });

  // =========================================================================
  // 8. PIPELINE STAGE VALIDATOR INTEGRATION
  // =========================================================================
  describe('8. PipelineStageValidator Version Invalidation', () => {
    it('detects mismatched clipRenderVersion in manifest and demands re-render', async () => {
      const projectId = 'test-validator-proj';
      const root = createTempProject(projectId);
      const projDir = path.join(root, projectId);
      const rendersDir = path.join(projDir, 'renders');
      fs.mkdirSync(rendersDir, { recursive: true });

      const story: StoryManifest = {
        title: 'Validator Story',
        scenes: [{ sceneNumber: 1, narration: 'Scene 1', durationSeconds: 3.0 }],
      };
      await StoryRepository.saveStory(projectId, story);

      // Create dummy clip file on disk
      fs.writeFileSync(path.join(rendersDir, 'scene-001.mp4'), Buffer.alloc(10_000));
      vi.spyOn(PipelineStageValidator, 'probeMedia').mockResolvedValue({
        duration: 3.0,
        hasVideo: true,
        hasAudio: true,
      });

      // Save manifest with OLD render version
      await StoryRepository.saveRenderManifest(projectId, {
        projectId,
        motionStyle: 'breathe',
        totalScenes: 1,
        renderedScenes: 1,
        totalDurationSeconds: 3.0,
        renderedAt: new Date().toISOString(),
        clipRenderVersion: CLIP_RENDER_VERSION - 1, // OUTDATED ENGINE VERSION!
        scenes: [
          {
            sceneNumber: 1,
            videoFile: 'renders/scene-001.mp4',
            absoluteVideoPath: path.join(rendersDir, 'scene-001.mp4'),
            durationSeconds: 3.0,
            fileSizeBytes: 10_000,
            status: 'completed',
          },
        ],
      });

      const validation = await PipelineStageValidator.validateClips(projectId);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('does not match current CLIP_RENDER_VERSION');
    });
  });
});
