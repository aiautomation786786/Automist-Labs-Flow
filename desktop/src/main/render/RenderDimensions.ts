/**
 * RenderDimensions – Invariant dimension validation and parity utilities for FFmpeg rendering.
 *
 * Requirements:
 *  1. Codecs like H.264 (libx264) with yuv420p chroma subsampling strictly require both width
 *     and height to be even integers (divisible by 2).
 *  2. Zero or negative dimensions are strictly rejected.
 *  3. Aspect ratios are preserved as closely as possible.
 */

/**
 * Clamps any numeric dimension to the nearest valid even integer greater than or equal to `min`.
 *
 * @param value The raw dimension value to convert to an even integer.
 * @param min Minimum allowable even value (default 2).
 * @returns An even integer >= min.
 */
export function toEven(value: number, min = 2): number {
  const safeMin = Math.max(2, min % 2 === 0 ? min : min + 1);
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return safeMin;
  }
  const rounded = Math.round(value);
  const positive = Math.max(safeMin, rounded);
  return positive % 2 === 0 ? positive : positive + 1;
}

/**
 * Returns true if a dimension is an integer > 0 and divisible by 2.
 */
export function isEvenDimension(val: number): boolean {
  return typeof val === 'number' && Number.isInteger(val) && val > 0 && val % 2 === 0;
}

/**
 * Validates and guarantees that both width and height are even integers >= min.
 */
export function ensureEvenDimensions(
  width: number,
  height: number,
  min = 2
): { width: number; height: number } {
  return {
    width: toEven(width, min),
    height: toEven(height, min),
  };
}

/**
 * Calculates standard target resolution dimensions with guaranteed even parity.
 *
 * Supported resolutions:
 *  - 4k: 3840x2160 (16:9) or 2160x3840 (9:16)
 *  - 1440p / 2k: 2560x1440 (16:9) or 1440x2560 (9:16)
 *  - 1080p: 1920x1080 (16:9) or 1080x1920 (9:16)
 *  - 720p: 1280x720 (16:9) or 720x1280 (9:16)
 *  - 360p: 640x360 (16:9) or 360x640 (9:16)
 */
export function getStandardDimensions(
  resolution: '4k' | '1440p' | '2k' | '1080p' | '720p' | '360p' | string,
  aspectRatio: '16:9' | '9:16' | string
): { width: number; height: number } {
  const isPortrait = aspectRatio === '9:16';
  let w = 1920;
  let h = 1080;

  switch (resolution) {
    case '4k':
      w = isPortrait ? 2160 : 3840;
      h = isPortrait ? 3840 : 2160;
      break;
    case '1440p':
    case '2k':
      w = isPortrait ? 1440 : 2560;
      h = isPortrait ? 2560 : 1440;
      break;
    case '1080p':
      w = isPortrait ? 1080 : 1920;
      h = isPortrait ? 1920 : 1080;
      break;
    case '720p':
      w = isPortrait ? 720 : 1280;
      h = isPortrait ? 1280 : 720;
      break;
    case '360p':
      w = isPortrait ? 360 : 640;
      h = isPortrait ? 640 : 360;
      break;
    default:
      w = isPortrait ? 1080 : 1920;
      h = isPortrait ? 1920 : 1080;
      break;
  }

  return ensureEvenDimensions(w, h);
}
