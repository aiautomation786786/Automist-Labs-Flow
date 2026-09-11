import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AudioDurationMeasurer } from '../main/tts/AudioDurationMeasurer';
import type { WordTiming } from '../main/tts/TtsTypes';

describe('AudioDurationMeasurer 3-Tier Duration Measurement', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'measurer-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Discovers ffprobe binary path', () => {
    const bin = AudioDurationMeasurer.getFfprobePath();
    expect(bin).toBeDefined();
    expect(typeof bin).toBe('string');
  });

  it('2. Throws when target audio file does not exist', async () => {
    const missing = path.join(tempDir, 'nonexistent.mp3');
    await expect(
      AudioDurationMeasurer.measureDurationSeconds(missing)
    ).rejects.toThrow(/audio file not found/i);
  });

  it('3. Fallback to word timings when provided and primary ffprobe not applicable', async () => {
    const dummyFile = path.join(tempDir, 'dummy.mp3');
    // Write 100 bytes of dummy data
    fs.writeFileSync(dummyFile, Buffer.alloc(100));

    const wordTimings: WordTiming[] = [
      { text: 'First', startMs: 0, durationMs: 450 },
      { text: 'Second', startMs: 500, durationMs: 620 },
      { text: 'Final', startMs: 1200, durationMs: 830 },
    ];

    // Total end time = 1200 + 830 = 2030ms = 2.03s
    const dur = await AudioDurationMeasurer.measureDurationSeconds(dummyFile, { wordTimings });
    // ffprobe might fail on dummy 100 zero bytes, so it falls back to word timings (2.03s)
    expect(dur).toBe(2.03);
  });

  it('4. Fallback to bitrate estimation when no word timings provided', async () => {
    const dummyFile = path.join(tempDir, 'dummy_bitrate.mp3');
    // 48 kbps = 6,000 bytes per second. Write 18,000 bytes => approx 3.00 seconds
    fs.writeFileSync(dummyFile, Buffer.alloc(18000));

    const dur = await AudioDurationMeasurer.measureDurationSeconds(dummyFile, {
      fallbackBitrateKbps: 48,
    });
    expect(dur).toBeCloseTo(3.0, 1);
  });
});
