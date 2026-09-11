import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TtsManager } from '../main/tts/TtsManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { AssetManager } from '../main/storage/AssetManager';
import type { StoryEntity, ITtsProvider } from '../main/tts/TtsTypes';

describe('TtsManager Central Orchestrator & Invariants', () => {
  let testAppDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    testAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-manager-test-'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = testAppDir;
  });

  afterEach(() => {
    if (prevLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = prevLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (fs.existsSync(testAppDir)) {
      fs.rmSync(testAppDir, { recursive: true, force: true });
    }
  });

  it('1. Resolves default narrator when voiceId is omitted or whitespace', () => {
    const res1 = TtsManager.resolveVoice('edge-tts', '');
    expect(res1.voiceId).toBe('en-US-ChristopherNeural');

    const res2 = TtsManager.resolveVoice('edge-tts', '   ');
    expect(res2.voiceId).toBe('en-US-ChristopherNeural');

    const res3 = TtsManager.resolveVoice('edge-tts', 'en-US-JennyNeural');
    expect(res3.voiceId).toBe('en-US-JennyNeural');

    const resKokoro = TtsManager.resolveVoice('kokoro', '');
    expect(resKokoro.voiceId).toBe('am_eric');
  });

  it('2. Gathers catalog of voices across registered providers', async () => {
    const all = await TtsManager.listAllVoices();
    expect(all.length).toBeGreaterThanOrEqual(7);

    const edgeVoices = all.filter((v) => v.provider === 'edge-tts');
    const kokoroVoices = all.filter((v) => v.provider === 'kokoro');

    expect(edgeVoices.length).toBeGreaterThan(0);
    expect(kokoroVoices.length).toBeGreaterThan(0);

    // Kokoro voices truthfully flagged as unavailable in this environment
    for (const kv of kokoroVoices) {
      expect(kv.isAvailable).toBe(false);
      expect(kv.unavailableReason).toBeDefined();
    }
  });

  it('3. Preview voice returns failure when requested provider is unavailable', async () => {
    const res = await TtsManager.previewVoice('kokoro', 'am_eric');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('onnxruntime-node');
  });

  it('4. Sequential per-scene narration synthesis and manifest generation', async () => {
    const projectId = 'proj_tts_test_001';
    AssetManager.ensureProjectDirectories(projectId);

    // Create a mock provider to guarantee fast deterministic offline execution for the test
    const mockProvider: ITtsProvider = {
      id: 'edge-tts',
      name: 'Mock Edge TTS',
      defaultVoiceId: 'en-US-ChristopherNeural',
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async (opts) => {
        // Write a small dummy file to opts.outputPath if given
        const dummyAudio = Buffer.alloc(12000, 0x55); // ~2.0 seconds at 48kbps
        if (opts.outputPath) {
          fs.writeFileSync(opts.outputPath, dummyAudio);
        }
        return {
          audioBuffer: dummyAudio,
          durationSeconds: 2.5,
          sizeBytes: dummyAudio.length,
          format: 'mp3',
        };
      },
    };

    TtsManager.registerProvider(mockProvider);

    const initialStory: StoryEntity = {
      title: 'Deep Ocean Mysteries',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Deep in the abyssal zone, darkness reigns supreme.',
          imagePrompt: 'Bioluminescent jellyfish floating in pitch black water',
          durationSeconds: 1.0, // initial estimate
          wordCount: 8,
        },
        {
          sceneNumber: 2,
          narration: '', // empty narration: should be skipped cleanly
          imagePrompt: 'Volcanic hydrothermal vent spewing mineral clouds',
          durationSeconds: 3.0,
          wordCount: 0,
        },
        {
          sceneNumber: 3,
          narration: 'Giant tubeworms flourish near volcanic plumes.',
          imagePrompt: 'Red hydrothermal tubeworms colony macro shot',
          durationSeconds: 1.0,
          wordCount: 6,
        },
      ],
    };

    await StoryRepository.saveStory(projectId, initialStory as any);

    // Execute synthesis
    const manifest = await TtsManager.synthesizeProjectNarration(projectId, {
      provider: 'edge-tts',
      voiceId: 'en-US-ChristopherNeural',
    });

    expect(manifest).toBeDefined();
    expect(manifest.projectId).toBe(projectId);
    expect(manifest.totalScenes).toBe(3);
    expect(manifest.scenes.length).toBe(3);

    // Scene 1: completed
    expect(manifest.scenes[0]!.sceneNumber).toBe(1);
    expect(manifest.scenes[0]!.status).toBe('completed');
    expect(manifest.scenes[0]!.audioFile).toBe('audio/scene-001.mp3');
    expect(manifest.scenes[0]!.durationSeconds).toBe(2.5);
    expect(fs.existsSync(manifest.scenes[0]!.absolutePath)).toBe(true);

    // Scene 2: skipped (empty narration)
    expect(manifest.scenes[1]!.sceneNumber).toBe(2);
    expect(manifest.scenes[1]!.status).toBe('skipped');
    expect(manifest.scenes[1]!.audioFile).toBe('');

    // Scene 3: completed
    expect(manifest.scenes[2]!.sceneNumber).toBe(3);
    expect(manifest.scenes[2]!.status).toBe('completed');
    expect(manifest.scenes[2]!.audioFile).toBe('audio/scene-003.mp3');
    expect(manifest.scenes[2]!.durationSeconds).toBe(2.5);
    expect(fs.existsSync(manifest.scenes[2]!.absolutePath)).toBe(true);

    // Verify story.json was updated with measured durations
    const updatedStory = await StoryRepository.getStory(projectId);
    expect(updatedStory).toBeDefined();
    expect(updatedStory!.scenes[0]!.durationSeconds).toBe(2.5);
    expect(updatedStory!.scenes[2]!.durationSeconds).toBe(2.5);

    // Verify metadata/audio.json manifest is retrievable
    const retrievedManifest = await TtsManager.getAudioManifest(projectId);
    expect(retrievedManifest).toBeDefined();
    expect(retrievedManifest!.projectId).toBe(projectId);
    expect(retrievedManifest!.scenes.length).toBe(3);
  });
});
