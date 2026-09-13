import { describe, it, expect } from 'vitest';
import {
  toEven,
  isEvenDimension,
  ensureEvenDimensions,
  getStandardDimensions,
} from '../main/render/RenderDimensions';

describe('RenderDimensions Unit & Invariant Tests', () => {
  describe('toEven', () => {
    it('1. Preserves already even positive integers', () => {
      expect(toEven(1080)).toBe(1080);
      expect(toEven(1920)).toBe(1920);
      expect(toEven(720)).toBe(720);
      expect(toEven(1280)).toBe(1280);
      expect(toEven(2)).toBe(2);
    });

    it('2. Rounds odd numbers up to nearest even integer', () => {
      expect(toEven(1079)).toBe(1080);
      expect(toEven(1921)).toBe(1922);
      expect(toEven(721)).toBe(722);
      expect(toEven(1)).toBe(2);
      expect(toEven(3)).toBe(4);
    });

    it('3. Handles floating point inputs by rounding to nearest even number', () => {
      expect(toEven(1079.8)).toBe(1080);
      expect(toEven(1079.2)).toBe(1080);
      expect(toEven(720.4)).toBe(720);
      expect(toEven(720.6)).toBe(722);
    });

    it('4. Rejects zero, negative, and invalid values by enforcing min threshold', () => {
      expect(toEven(0)).toBe(2);
      expect(toEven(-10)).toBe(2);
      expect(toEven(NaN)).toBe(2);
      expect(toEven(Infinity)).toBe(2);
      expect(toEven(null as any)).toBe(2);
      expect(toEven(undefined as any)).toBe(2);
    });

    it('5. Supports custom minimum even bounds', () => {
      expect(toEven(10, 16)).toBe(16);
      expect(toEven(15, 16)).toBe(16);
      expect(toEven(20, 16)).toBe(20);
      expect(toEven(21, 16)).toBe(22);
    });
  });

  describe('isEvenDimension', () => {
    it('returns true for positive even integers', () => {
      expect(isEvenDimension(2)).toBe(true);
      expect(isEvenDimension(1080)).toBe(true);
      expect(isEvenDimension(1920)).toBe(true);
    });

    it('returns false for odd, zero, negative, or non-integer values', () => {
      expect(isEvenDimension(1)).toBe(false);
      expect(isEvenDimension(1079)).toBe(false);
      expect(isEvenDimension(0)).toBe(false);
      expect(isEvenDimension(-2)).toBe(false);
      expect(isEvenDimension(1080.5)).toBe(false);
      expect(isEvenDimension(NaN)).toBe(false);
    });
  });

  describe('ensureEvenDimensions', () => {
    it('converts width and height pairs into guaranteed even integers', () => {
      const result = ensureEvenDimensions(1079, 1919);
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1920);
      expect(isEvenDimension(result.width)).toBe(true);
      expect(isEvenDimension(result.height)).toBe(true);
    });
  });

  describe('getStandardDimensions', () => {
    it('computes 4K dimensions correctly with even parity', () => {
      const landscape = getStandardDimensions('4k', '16:9');
      expect(landscape).toEqual({ width: 3840, height: 2160 });
      expect(isEvenDimension(landscape.width)).toBe(true);
      expect(isEvenDimension(landscape.height)).toBe(true);

      const portrait = getStandardDimensions('4k', '9:16');
      expect(portrait).toEqual({ width: 2160, height: 3840 });
      expect(isEvenDimension(portrait.width)).toBe(true);
      expect(isEvenDimension(portrait.height)).toBe(true);
    });

    it('computes 1440p / 2K dimensions correctly with even parity', () => {
      const landscape = getStandardDimensions('1440p', '16:9');
      expect(landscape).toEqual({ width: 2560, height: 1440 });

      const portrait = getStandardDimensions('2k', '9:16');
      expect(portrait).toEqual({ width: 1440, height: 2560 });
    });

    it('computes 1080p dimensions correctly with even parity', () => {
      const landscape = getStandardDimensions('1080p', '16:9');
      expect(landscape).toEqual({ width: 1920, height: 1080 });

      const portrait = getStandardDimensions('1080p', '9:16');
      expect(portrait).toEqual({ width: 1080, height: 1920 });
    });

    it('computes 720p dimensions correctly with even parity', () => {
      const landscape = getStandardDimensions('720p', '16:9');
      expect(landscape).toEqual({ width: 1280, height: 720 });

      const portrait = getStandardDimensions('720p', '9:16');
      expect(portrait).toEqual({ width: 720, height: 1280 });
    });

    it('computes 360p dimensions correctly with even parity', () => {
      const landscape = getStandardDimensions('360p', '16:9');
      expect(landscape).toEqual({ width: 640, height: 360 });

      const portrait = getStandardDimensions('360p', '9:16');
      expect(portrait).toEqual({ width: 360, height: 640 });
    });
  });
});
