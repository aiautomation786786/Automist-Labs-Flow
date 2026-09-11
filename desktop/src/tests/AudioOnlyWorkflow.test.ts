import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TtsManager } from '../main/tts/TtsManager';
import { AssetManager } from '../main/storage/AssetManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { ScriptParser } from '../shared/ScriptParser';
import type { ITtsProvider, StoryEntity } from '../main/tts/TtsTypes';

describe('Audio Only Workflow (End-to-End)', () => {
  let tempDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-only-test-'));
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

  it('1. Parses multi-scene script, synthesizes per-scene audio, updates story, and creates master final_audio.mp3', async () => {
    const rawScript = `# Ocean Abyss

## SCENE 1
NARRATION: The deep sea trench plunges miles beneath the sunlit waves.

## SCENE 2
NARRATION: Here, otherworldly creatures glide silently in the dark.

## SCENE 3
NARRATION: Hydrothermal vents erupt with mineral-rich plumes supporting rare ecosystems.`;

    const parsed = ScriptParser.parse(rawScript);
    expect(parsed.scenes.length).toBe(3);

    const projectId = 'proj_audio_only_e2e_01';
    AssetManager.ensureProjectDirectories(projectId);

    const story: StoryEntity = {
      title: 'Ocean Trench Journey',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rawScript,
      scenes: parsed.scenes,
    };
    await StoryRepository.saveStory(projectId, story as any);

    // Register deterministic mock provider
    const mockAudio = Buffer.alloc(12000, 0x55);
    const mockEdge: ITtsProvider = {
      id: 'edge-tts',
      name: 'Mock Edge TTS',
      badge: 'FREE',
      audioExtension: 'mp3',
      defaultVoiceId: 'en-US-ChristopherNeural',
      supportsWordTimings: true,
      isAvailable: async () => true,
      getUnavailableReason: () => null,
      listVoices: async () => [],
      synthesize: async (opts) => {
        if (opts.outputPath) {
          fs.writeFileSync(opts.outputPath, mockAudio);
        }
        return {
          audioBuffer: mockAudio,
          durationSeconds: 2.5,
          sizeBytes: mockAudio.length,
          format: 'mp3',
          providerUsed: 'edge-tts',
          wordTimings: [
            { word: 'The', startMs: 0, durationMs: 250 },
            { word: 'deep', startMs: 250, durationMs: 250 },
          ],
        };
      },
    };
    TtsManager.registerProvider(mockEdge);

    // 1. Synthesize project voice narration
    const manifest = await TtsManager.synthesizeProjectNarration(projectId, {
      provider: 'edge-tts',
      voiceId: 'en-US-ChristopherNeural',
    });

    expect(manifest.projectId).toBe(projectId);
    expect(manifest.totalScenes).toBe(3);
    expect(manifest.scenes.length).toBe(3);
    expect(manifest.fallbackOccurred).toBe(false);

    for (let i = 0; i < 3; i++) {
      const sc = manifest.scenes[i]!;
      expect(sc.status).toBe('completed');
      expect(sc.audioFile).toBe(`audio/scene-00${i + 1}.mp3`);
      expect(fs.existsSync(sc.absolutePath)).toBe(true);
      expect(sc.durationSeconds).toBe(2.5);
    }

    // Verify story scene durations were updated
    const updatedStory = await StoryRepository.getStory(projectId);
    expect(updatedStory).not.toBeNull();
    expect(updatedStory!.scenes[0]?.durationSeconds).toBe(2.5);
    expect(updatedStory!.scenes[1]?.durationSeconds).toBe(2.5);
    expect(updatedStory!.scenes[2]?.durationSeconds).toBe(2.5);

    // 2. Combine into master track
    const combineResult = await TtsManager.combineProjectAudio(projectId, 'final_audio.mp3');
    expect(combineResult.masterAudioPath).toBeDefined();
    expect(fs.existsSync(combineResult.masterAudioPath)).toBe(true);
    expect(combineResult.durationSeconds).toBeGreaterThan(0);

    // Verify audio.json was updated with master audio file
    const manifestPath = path.join(AssetManager.getProjectDir(projectId), 'metadata', 'audio.json');
    const finalManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(finalManifest.masterAudioFile).toBe('audio/final_audio.mp3');
    expect(finalManifest.masterAudioPath).toBe(combineResult.masterAudioPath);
    expect(finalManifest.totalDurationSeconds).toBe(combineResult.durationSeconds);
  });
});
