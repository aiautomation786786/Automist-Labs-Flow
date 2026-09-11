import { describe, it, expect } from 'vitest';
import { MotionFilterBuilder } from '../main/render/MotionFilterBuilder';
import type { MotionStyle, SupportedAspectRatio } from '../shared/types';

describe('MotionFilterBuilder', () => {
  const styles: MotionStyle[] = [
    'breathe',
    'zoom_in',
    'zoom_out',
    'pan_left',
    'pan_right',
    'cinematic_dolly',
    'none',
  ];

  it('1. Generates valid filter expressions for all 6 motion styles plus none', () => {
    for (const style of styles) {
      const result = MotionFilterBuilder.build({
        motionStyle: style,
        durationSeconds: 3.5,
        fps: 30,
        aspectRatio: '16:9',
      });

      expect(result.totalFrames).toBe(105);
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.filterComplex).toBeTruthy();

      if (style !== 'none') {
        expect(result.filterComplex).toContain('zoompan=');
        expect(result.filterComplex).toContain('d=105');
        expect(result.filterComplex).toContain('s=1280x720');
        // Ensure variable 'd' is not used in math expression (FFmpeg eval bug)
        expect(result.filterComplex).not.toMatch(/\/d[\),]/);
      } else {
        expect(result.filterComplex).toContain('scale=1280:720');
      }
    }
  });

  it('2. Correctly sets output dimensions based on aspect ratio', () => {
    const res169 = MotionFilterBuilder.build({
      motionStyle: 'breathe',
      durationSeconds: 2.0,
      aspectRatio: '16:9',
    });
    expect(res169.width).toBe(1280);
    expect(res169.height).toBe(720);
    expect(res169.filterComplex).toContain('s=1280x720');

    const res916 = MotionFilterBuilder.build({
      motionStyle: 'breathe',
      durationSeconds: 2.0,
      aspectRatio: '9:16',
    });
    expect(res916.width).toBe(720);
    expect(res916.height).toBe(1280);
    expect(res916.filterComplex).toContain('s=720x1280');
  });

  it('3. Calculates total frames accurately across various durations and fps', () => {
    const res1 = MotionFilterBuilder.build({
      motionStyle: 'zoom_in',
      durationSeconds: 4.25,
      fps: 30,
    });
    // 4.25 * 30 = 127.5 -> Math.ceil = 128
    expect(res1.totalFrames).toBe(128);

    const res2 = MotionFilterBuilder.build({
      motionStyle: 'zoom_out',
      durationSeconds: 1.0,
      fps: 24,
    });
    expect(res2.totalFrames).toBe(24);
  });

  it('4. Handles "none" motion with static pad/scale filter without zoompan', () => {
    const res = MotionFilterBuilder.build({
      motionStyle: 'none',
      durationSeconds: 5.0,
      aspectRatio: '16:9',
    });

    expect(res.filterComplex).not.toContain('zoompan=');
    expect(res.filterComplex).toContain('scale=1280:720');
  });

  it('5. Fallbacks gracefully on unknown motion style to breathe', () => {
    const res = MotionFilterBuilder.build({
      motionStyle: 'unknown_warp' as any,
      durationSeconds: 3.0,
      fps: 30,
      aspectRatio: '16:9',
    });

    expect(res.filterComplex).toContain('zoompan=');
    expect(res.totalFrames).toBe(90);
  });

  it('6. getDimensions returns proper width and height', () => {
    expect(MotionFilterBuilder.getDimensions('16:9')).toEqual({ width: 1280, height: 720 });
    expect(MotionFilterBuilder.getDimensions('9:16')).toEqual({ width: 720, height: 1280 });
  });
});
