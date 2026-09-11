import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FinalAudioMixer } from '../main/render/FinalAudioMixer';

describe('FinalAudioMixer', () => {
  let tempDir: string;
  let sampleAudioPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixer_test_'));
    sampleAudioPath = path.join(tempDir, 'sample_music.mp3');
    fs.writeFileSync(sampleAudioPath, Buffer.alloc(2048, 1));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates speech-only filtergraph when music is not enabled', () => {
    const res = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 1,
      finalDuration: 10.0,
      musicEnabled: false,
      applyLoudnorm: true,
    });

    expect(res.extraInputArgs).toHaveLength(0);
    expect(res.outputAudioPad).toBe('[a_final]');
    expect(res.filterComplexParts[0]).toContain('[a_speech]loudnorm=I=-14:TP=-1.5:LRA=11[a_final]');
    expect(res.musicTrackMetadata).toBeUndefined();
  });

  it('generates passthrough when loudnorm is disabled in speech-only mode', () => {
    const res = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 1,
      finalDuration: 10.0,
      musicEnabled: false,
      applyLoudnorm: false,
    });

    expect(res.extraInputArgs).toHaveLength(0);
    expect(res.outputAudioPad).toBe('[a_speech]');
    expect(res.filterComplexParts).toHaveLength(0);
  });

  it('falls back to speech-only when musicPath does not exist on disk', () => {
    const res = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 2,
      bgmPath: path.join(tempDir, 'non_existent_music.mp3'),
      finalDuration: 12.0,
      musicEnabled: true,
    });

    expect(res.extraInputArgs).toHaveLength(0);
    expect(res.outputAudioPad).toBe('[a_final]');
    expect(res.musicTrackMetadata).toBeUndefined();
  });

  it('builds looped music with sidechain ducking and outro fade', () => {
    const res = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 3,
      bgmPath: sampleAudioPath,
      finalDuration: 15.0,
      musicEnabled: true,
      musicVolume: 0.25,
      duckingEnabled: true,
      applyLoudnorm: true,
    });

    // Looping args
    expect(res.extraInputArgs).toEqual(['-stream_loop', '-1', '-i', sampleAudioPath]);

    // Trimming and volume
    const joined = res.filterComplexParts.join(';');
    expect(joined).toContain('[3:a]volume=0.250,atrim=0:15.000,afade=t=out:st=13.500:d=1.500[bgm_trimmed]');

    // Split speech pad to prevent multi-consumer error
    expect(joined).toContain('[a_speech]asplit=2[sc_voice][mix_voice]');

    // Sidechain compressor
    expect(joined).toContain('[bgm_trimmed][sc_voice]sidechaincompress=threshold=0.08:ratio=4:attack=20:release=250[ducked_bgm]');

    // Voice + ducked BGM mix
    expect(joined).toContain('[mix_voice][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2,volume=1.5[a_mixed]');

    // Loudnorm
    expect(joined).toContain('[a_mixed]loudnorm=I=-14:TP=-1.5:LRA=11[a_final]');
    expect(res.outputAudioPad).toBe('[a_final]');

    // Metadata
    expect(res.musicTrackMetadata).toBeDefined();
    expect(res.musicTrackMetadata?.volume).toBe(0.25);
    expect(res.musicTrackMetadata?.duckingEnabled).toBe(true);
    expect(res.musicTrackMetadata?.looped).toBe(true);
  });

  it('builds music mix without ducking when duckingEnabled is false', () => {
    const res = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 2,
      bgmPath: sampleAudioPath,
      finalDuration: 8.0,
      musicEnabled: true,
      musicVolume: 0.15,
      duckingEnabled: false,
      applyLoudnorm: true,
    });

    const joined = res.filterComplexParts.join(';');
    expect(joined).toContain('[2:a]volume=0.150,atrim=0:8.000,afade=t=out:st=6.500:d=1.500[bgm_trimmed]');
    expect(joined).not.toContain('sidechaincompress');
    expect(joined).toContain('[a_speech][bgm_trimmed]amix=inputs=2:duration=first:dropout_transition=2[a_mixed]');
    expect(joined).toContain('[a_mixed]loudnorm=I=-14:TP=-1.5:LRA=11[a_final]');
    expect(res.musicTrackMetadata?.duckingEnabled).toBe(false);
  });

  it('clamps music volume safely between 0.0 and 1.0', () => {
    const resOver = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 1,
      bgmPath: sampleAudioPath,
      finalDuration: 5.0,
      musicVolume: 2.5,
    });
    expect(resOver.filterComplexParts[0]).toContain('volume=1.000');

    const resUnder = FinalAudioMixer.buildAudioMixFilter({
      speechPad: '[a_speech]',
      bgmInputIndex: 1,
      bgmPath: sampleAudioPath,
      finalDuration: 5.0,
      musicVolume: -0.5,
    });
    expect(resUnder.filterComplexParts[0]).toContain('volume=0.000');
  });
});
