import { describe, it, expect, vi } from 'vitest';
import {
  FfmpegProgressParser,
  mapFfmpegErrorMessage,
  type FfmpegProgressData,
} from '../main/render/FfmpegProgressParser';

describe('FfmpegProgressParser & Error Mapping Tests', () => {
  it('1. Parses standard FFmpeg stdout key=value progress sequence', () => {
    const updates: FfmpegProgressData[] = [];
    const parser = new FfmpegProgressParser((data) => {
      updates.push({ ...data });
    });

    const mockOutput = [
      'frame=30\n',
      'fps=29.97\n',
      'stream_0_0_q=28.0\n',
      'bitrate= 1800.0kbits/s\n',
      'total_size=1048576\n',
      'out_time_us=1000000\n',
      'progress=continue\n',
      'frame=60\n',
      'out_time_us=2000000\n',
      'progress=continue\n',
      'progress=end\n',
    ].join('');

    parser.feed(mockOutput);

    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates[0].outTimeSec).toBe(1.0);
    expect(updates[0].outTimeUs).toBe(1000000);
    expect(updates[1].outTimeSec).toBe(2.0);
    expect(updates[2].progress).toBe('end');
  });

  it('2. Handles arbitrary chunk splits across line and key boundaries', () => {
    const updates: FfmpegProgressData[] = [];
    const parser = new FfmpegProgressParser((data) => {
      updates.push({ ...data });
    });

    parser.feed('out_ti');
    parser.feed('me_us=3500');
    parser.feed('000\nprog');
    parser.feed('ress=continue\n');

    expect(updates.length).toBe(1);
    expect(updates[0].outTimeSec).toBe(3.5);
  });

  it('3. Ignores malformed, empty, or non-key-value lines safely', () => {
    const updates: FfmpegProgressData[] = [];
    const parser = new FfmpegProgressParser((data) => {
      updates.push({ ...data });
    });

    parser.feed('   \n\n');
    parser.feed('some random warning text without equals sign\n');
    parser.feed('===invalid line===\n');
    parser.feed('out_time_us=4000000\nprogress=continue\n');

    expect(updates.length).toBe(1);
    expect(updates[0].outTimeSec).toBe(4.0);
  });

  it('4. Flushes remaining buffer when flush is called', () => {
    const updates: FfmpegProgressData[] = [];
    const parser = new FfmpegProgressParser((data) => {
      updates.push({ ...data });
    });

    parser.feed('out_time_us=5000000\nprogress=end');
    // progress=end is in the trailing buffer without newline, so not emitted yet
    expect(updates.length).toBe(0);
    parser.flush();
    expect(updates.length).toBe(1);
    expect(updates[0].outTimeSec).toBe(5.0);
    expect(updates[0].progress).toBe('end');
  });

  describe('mapFfmpegErrorMessage', () => {
    it('maps disk full error to actionable message', () => {
      const msg = mapFfmpegErrorMessage(1, 'Error writing output: No space left on device', 'Final assembly');
      expect(msg).toContain('Insufficient disk space');
    });

    it('maps locked file error to actionable message', () => {
      const msg = mapFfmpegErrorMessage(1, 'EBUSY: resource busy or locked / Permission denied', 'Final assembly');
      expect(msg).toContain('locked by another process');
    });

    it('maps corrupt moov atom to actionable message', () => {
      const msg = mapFfmpegErrorMessage(1, '[mov,mp4 @ 0x123] moov atom not found', 'Final assembly');
      expect(msg).toContain('corrupted, truncated, or incompatible');
    });

    it('maps odd dimension error to actionable message', () => {
      const msg = mapFfmpegErrorMessage(1, 'height not divisible by 2 (1080x1919)', 'Final assembly');
      expect(msg).toContain('must both be even numbers');
    });

    it('maps filtergraph error to actionable message', () => {
      const msg = mapFfmpegErrorMessage(1, 'Error reinitializing filters! Failed to inject frame into filter network', 'Final assembly');
      expect(msg).toContain('filter composition error');
    });

    it('maps subtitle font error to actionable message', () => {
      const msg = mapFfmpegErrorMessage(1, '[subtitles @ 0x123] fontconfig error: unable to load font', 'Scene render');
      expect(msg).toContain('Subtitle rendering encountered a font loading');
    });

    it('falls back gracefully to generic actionable message for unknown errors', () => {
      const msg = mapFfmpegErrorMessage(137, 'Fatal signal received', 'Final assembly');
      expect(msg).toContain('FFmpeg process failed with exit code 137');
    });
  });
});
