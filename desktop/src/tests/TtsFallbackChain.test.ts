import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TtsManager } from '../main/tts/TtsManager';
import { AssetManager } from '../main/storage/AssetManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { TtsError } from '../main/tts/TtsErrorClassifier';
import type { ITtsProvider, StoryEntity } from '../main/tts/TtsTypes';

describe('ZBot Centralized Fallback Chain & Strict Invariants', () => {
  let tempDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-fallback-test-'));
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
    vi.restoreAllMocks();
  });

  it('1. Chosen engine succeeds on first try: no retry and no fallback', async () => {
    let callCount = 0;
    const mockPrimary: ITtsProvider = {
      id: 'azure',
      name: 'Mock Azure',
      badge: 'API KEY',
      audioExtension: 'mp3',
      defaultVoiceId: 'en-US-JennyNeural',
      supportsWordTimings: false,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        callCount++;
        return {
          audioBuffer: Buffer.alloc(1000, 0x11),
          durationSeconds: 2.0,
          sizeBytes: 1000,
          format: 'mp3',
          providerUsed: 'azure',
        };
      },
    };

    TtsManager.registerProvider(mockPrimary);

    const result = await TtsManager.synthesizeSceneWithFallback(
      'Primary success test.',
      'azure',
      'en-US-JennyNeural'
    );

    expect(callCount).toBe(1);
    expect(result.providerUsed).toBe('azure');
    expect(result.fallbackOccurred).toBe(false);
  });

  it('2. Chosen engine fails once, immediate retry succeeds: no cross-engine fallback', async () => {
    let callCount = 0;
    const mockRetryingPrimary: ITtsProvider = {
      id: 'ai33',
      name: 'Mock ai33',
      badge: 'API KEY',
      audioExtension: 'mp3',
      defaultVoiceId: 'elevenlabs:adam',
      supportsWordTimings: true,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        callCount++;
        if (callCount === 1) {
          throw new TtsError('Transient network glitch', 'network', 'ai33');
        }
        return {
          audioBuffer: Buffer.alloc(1500, 0x22),
          durationSeconds: 2.5,
          sizeBytes: 1500,
          format: 'mp3',
          providerUsed: 'ai33',
        };
      },
    };

    TtsManager.registerProvider(mockRetryingPrimary);

    const result = await TtsManager.synthesizeSceneWithFallback(
      'Retry success test.',
      'ai33',
      'elevenlabs:adam'
    );

    expect(callCount).toBe(2); // Failed once, retried once
    expect(result.providerUsed).toBe('ai33');
    expect(result.fallbackOccurred).toBe(false);
  });

  it('3. Chosen engine fails twice, gracefully downgrades to Kokoro', async () => {
    let primaryCalls = 0;
    let kokoroCalls = 0;

    const mockFailingPrimary: ITtsProvider = {
      id: 'famespeak',
      name: 'Mock FameSpeak',
      badge: 'API KEY',
      audioExtension: 'mp3',
      defaultVoiceId: 'fs_morgan_freeman',
      supportsWordTimings: false,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        primaryCalls++;
        throw new TtsError('Quota exhausted (403)', 'quota', 'famespeak', null, 403);
      },
    };

    const mockWorkingKokoro: ITtsProvider = {
      id: 'kokoro',
      name: 'Mock Kokoro',
      badge: 'LOCAL',
      audioExtension: 'wav',
      defaultVoiceId: 'am_eric',
      supportsWordTimings: false,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        kokoroCalls++;
        return {
          audioBuffer: Buffer.alloc(2000, 0x33),
          durationSeconds: 3.0,
          sizeBytes: 2000,
          format: 'wav',
          providerUsed: 'kokoro',
        };
      },
    };

    TtsManager.registerProvider(mockFailingPrimary);
    TtsManager.registerProvider(mockWorkingKokoro);

    const result = await TtsManager.synthesizeSceneWithFallback(
      'Downgrade to Kokoro test.',
      'famespeak',
      'fs_morgan_freeman'
    );

    expect(primaryCalls).toBe(2); // 1 initial + 1 immediate retry
    expect(kokoroCalls).toBe(1);  // Downgraded to Kokoro
    expect(result.providerUsed).toBe('kokoro');
    expect(result.fallbackOccurred).toBe(true);
  });

  it('4. Both chosen engine and Kokoro fail, gracefully downgrades to Edge TTS', async () => {
    let edgeCalls = 0;

    const mockFailingAzure: ITtsProvider = {
      id: 'azure',
      name: 'Failing Azure',
      badge: 'API KEY',
      audioExtension: 'mp3',
      defaultVoiceId: 'en-US-JennyNeural',
      supportsWordTimings: false,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        throw new TtsError('Invalid subscription key', 'invalid_key', 'azure', null, 401);
      },
    };

    const mockFailingKokoro: ITtsProvider = {
      id: 'kokoro',
      name: 'Failing Kokoro',
      badge: 'LOCAL',
      audioExtension: 'wav',
      defaultVoiceId: 'am_eric',
      supportsWordTimings: false,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        throw new TtsError('Model weights missing', 'unavailable', 'kokoro');
      },
    };

    const mockWorkingEdge: ITtsProvider = {
      id: 'edge-tts',
      name: 'Mock Edge TTS',
      badge: 'FREE',
      audioExtension: 'mp3',
      defaultVoiceId: 'en-US-ChristopherNeural',
      supportsWordTimings: true,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        edgeCalls++;
        return {
          audioBuffer: Buffer.alloc(2500, 0x44),
          durationSeconds: 4.0,
          sizeBytes: 2500,
          format: 'mp3',
          providerUsed: 'edge-tts',
        };
      },
    };

    TtsManager.registerProvider(mockFailingAzure);
    TtsManager.registerProvider(mockFailingKokoro);
    TtsManager.registerProvider(mockWorkingEdge);

    const result = await TtsManager.synthesizeSceneWithFallback(
      'Final fallback to Edge test.',
      'azure',
      'en-US-JennyNeural'
    );

    expect(edgeCalls).toBe(1);
    expect(result.providerUsed).toBe('edge-tts');
    expect(result.fallbackOccurred).toBe(true);
  });

  it('5. PREVIEW INVARIANT: Voice preview strictly DOES NOT cross-fallback', async () => {
    let fallbackAttempted = false;

    const mockFailingProvider: ITtsProvider = {
      id: 'famespeak',
      name: 'Mock FameSpeak',
      badge: 'API KEY',
      audioExtension: 'mp3',
      defaultVoiceId: 'fs_morgan_freeman',
      supportsWordTimings: false,
      isAvailable: async () => false,
      getUnavailableReason: () => 'API key missing',
      listVoices: async () => [],
      synthesize: async () => {
        throw new TtsError('Key missing', 'missing_key', 'famespeak');
      },
    };

    const mockEdge: ITtsProvider = {
      id: 'edge-tts',
      name: 'Mock Edge',
      badge: 'FREE',
      audioExtension: 'mp3',
      defaultVoiceId: 'en-US-ChristopherNeural',
      supportsWordTimings: true,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        fallbackAttempted = true;
        return {
          audioBuffer: Buffer.alloc(100),
          durationSeconds: 1,
          sizeBytes: 100,
          format: 'mp3',
        };
      },
    };

    TtsManager.registerProvider(mockFailingProvider);
    TtsManager.registerProvider(mockEdge);

    const preview = await TtsManager.previewVoice('famespeak', 'fs_morgan_freeman');

    // Must fail without lying with Edge audio
    expect(preview.success).toBe(false);
    expect(preview.error).toBeDefined();
    expect(preview.error).toContain('API key missing');
    expect(fallbackAttempted).toBe(false);
  });

  it('6. CANCELLATION INVARIANT: AbortSignal strictly aborts immediately without triggering fallback', async () => {
    let kokoroCalled = false;
    let edgeCalled = false;

    const mockAbortingPrimary: ITtsProvider = {
      id: 'ai33',
      name: 'Mock ai33',
      badge: 'API KEY',
      audioExtension: 'mp3',
      defaultVoiceId: 'elevenlabs:rachel',
      supportsWordTimings: true,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async (opts) => {
        if (opts.signal?.aborted) {
          throw new TtsError('Aborted by caller', 'cancelled', 'ai33');
        }
        return {
          audioBuffer: Buffer.alloc(100),
          durationSeconds: 1,
          sizeBytes: 100,
          format: 'mp3',
        };
      },
    };

    const mockKokoro: ITtsProvider = {
      id: 'kokoro',
      name: 'Mock Kokoro',
      badge: 'LOCAL',
      audioExtension: 'wav',
      defaultVoiceId: 'am_eric',
      supportsWordTimings: false,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        kokoroCalled = true;
        return { audioBuffer: Buffer.alloc(100), durationSeconds: 1, sizeBytes: 100, format: 'wav' };
      },
    };

    const mockEdge: ITtsProvider = {
      id: 'edge-tts',
      name: 'Mock Edge',
      badge: 'FREE',
      audioExtension: 'mp3',
      defaultVoiceId: 'en-US-ChristopherNeural',
      supportsWordTimings: true,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async () => {
        edgeCalled = true;
        return { audioBuffer: Buffer.alloc(100), durationSeconds: 1, sizeBytes: 100, format: 'mp3' };
      },
    };

    TtsManager.registerProvider(mockAbortingPrimary);
    TtsManager.registerProvider(mockKokoro);
    TtsManager.registerProvider(mockEdge);

    const ac = new AbortController();
    ac.abort();

    await expect(
      TtsManager.synthesizeSceneWithFallback(
        'Cancellation test',
        'ai33',
        undefined,
        undefined,
        ac.signal
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('cancelled');
      return true;
    });

    expect(kokoroCalled).toBe(false);
    expect(edgeCalled).toBe(false);
  });

  it('7. Audio combination: combines multi-scene audio files into master final_audio.mp3', async () => {
    const projectId = 'proj_combine_test_01';
    const audioDir = AssetManager.ensureProjectDirectories(projectId).audioDir;
    fs.mkdirSync(audioDir, { recursive: true });

    // Create 2 mock scene audio files
    const scene1Audio = Buffer.alloc(6000, 0x11);
    const scene2Audio = Buffer.alloc(9000, 0x22);

    fs.writeFileSync(path.join(audioDir, 'scene-001.mp3'), scene1Audio);
    fs.writeFileSync(path.join(audioDir, 'scene-002.mp3'), scene2Audio);

    const story: StoryEntity = {
      title: 'Combination Story',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [
        { sceneNumber: 1, narration: 'Scene one narration.', imagePrompt: '' },
        { sceneNumber: 2, narration: 'Scene two narration.', imagePrompt: '' },
      ],
    };
    await StoryRepository.saveStory(projectId, story as any);

    // Save audio manifest
    const manifest = {
      projectId,
      provider: 'edge-tts' as const,
      voiceId: 'en-US-ChristopherNeural',
      totalScenes: 2,
      totalDurationSeconds: 5.0,
      generatedAt: new Date().toISOString(),
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Scene one',
          audioFile: 'audio/scene-001.mp3',
          absolutePath: path.join(audioDir, 'scene-001.mp3'),
          durationSeconds: 2.0,
          fileSizeBytes: 6000,
          status: 'completed' as const,
        },
        {
          sceneNumber: 2,
          narration: 'Scene two',
          audioFile: 'audio/scene-002.mp3',
          absolutePath: path.join(audioDir, 'scene-002.mp3'),
          durationSeconds: 3.0,
          fileSizeBytes: 9000,
          status: 'completed' as const,
        },
      ],
    };
    const metadataDir = path.join(AssetManager.getProjectDir(projectId), 'metadata');
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(path.join(metadataDir, 'audio.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    const result = await TtsManager.combineProjectAudio(projectId, 'final_audio.mp3');

    expect(result.masterAudioPath).toBeDefined();
    expect(fs.existsSync(result.masterAudioPath)).toBe(true);
    expect(result.durationSeconds).toBeGreaterThan(0);

    const masterStats = fs.statSync(result.masterAudioPath);
    expect(masterStats.size).toBeGreaterThan(0);
  });
});
