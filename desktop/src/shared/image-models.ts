/**
 * Extensible Image Generation Model Definitions for Google Flow Desktop.
 *
 * Separates internal model configuration from UI representation.
 * Allows easy future additions of image models without breaking changes.
 */

export interface ImageModelDefinition {
  /** Canonical ID used in configuration and project entities */
  id: string;
  /** UI display name */
  displayName: string;
  /** Exact or matching name string shown inside Google Flow model selector */
  flowModelName: string;
  /** Short summary of engine characteristics */
  description: string;
  /** Speed / quality tier badge */
  badge: string;
  /** Whether 2K upscale export is supported */
  supports2k: boolean;
  /** Configurable baseline expected generation duration in seconds */
  baselineDurationSeconds: number;
}

export const SUPPORTED_IMAGE_MODELS: readonly ImageModelDefinition[] = [
  {
    id: 'nano-banana-pro',
    displayName: 'Nano Banana Pro',
    flowModelName: 'Nano Banana Pro',
    description: 'High-fidelity cinema-grade imagery with rich detail and 2K upscale export',
    badge: 'Cinema Quality',
    supports2k: true,
    baselineDurationSeconds: 18,
  },
  {
    id: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    flowModelName: 'Nano Banana 2',
    description: 'Standard production engine with balanced speed and high visual quality',
    badge: 'Verified Default',
    supports2k: true,
    baselineDurationSeconds: 14,
  },
  {
    id: 'nano-banana-2-lite',
    displayName: 'Nano Banana 2 Lite',
    flowModelName: 'Nano Banana 2 Lite',
    description: 'Ultra-fast lightweight generation optimized for rapid prototyping',
    badge: 'Fast & Light',
    supports2k: false,
    baselineDurationSeconds: 10,
  },
] as const;

export const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';
export const DEFAULT_IMAGE_MODEL_NAME = 'Nano Banana 2';

/**
 * Resolves an ImageModelDefinition from an ID or model name string.
 * Gracefully falls back to Nano Banana 2 if not recognized.
 */
export function getImageModelConfig(idOrName?: string | null): ImageModelDefinition {
  if (!idOrName) {
    return SUPPORTED_IMAGE_MODELS[1]!; // Nano Banana 2
  }

  const normalized = idOrName.trim().toLowerCase();
  const match = SUPPORTED_IMAGE_MODELS.find(
    (m) =>
      m.id.toLowerCase() === normalized ||
      m.displayName.toLowerCase() === normalized ||
      m.flowModelName.toLowerCase() === normalized
  );

  return match ?? SUPPORTED_IMAGE_MODELS[1]!;
}

/**
 * Validates if a model name or ID is among the supported image models.
 */
export function isSupportedImageModel(idOrName?: string | null): boolean {
  if (!idOrName) return false;
  const normalized = idOrName.trim().toLowerCase();
  return SUPPORTED_IMAGE_MODELS.some(
    (m) =>
      m.id.toLowerCase() === normalized ||
      m.displayName.toLowerCase() === normalized ||
      m.flowModelName.toLowerCase() === normalized
  );
}
