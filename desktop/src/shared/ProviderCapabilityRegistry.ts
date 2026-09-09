/**
 * ProviderCapabilityRegistry – Authoritative static capability matrix for video generation models.
 *
 * GUARANTEES:
 * 1. Veo 3.1 Lite, Fast, Quality are STRICTLY Google Flow only. Never routed to Gemini.
 * 2. Gemini Web Video capability is STRICTLY 10s, 16:9 and 9:16, supporting both T2V and I2V.
 *    No fake 4s/6s/8s Gemini options exist.
 * 3. Omni 1.1 Flash at 10s is eligible for BOTH Google Flow and Gemini.
 * 4. Image-to-Video is supported by Omni 1.1 Flash and Gemini Omni, but NOT Veo 3.1 models.
 */

export interface ModelCapability {
  modelId: string;
  displayLabel: string;
  provider: 'flow' | 'gemini';
  durations: string[];
  ratios: string[];
  resolutions: string[];
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsSourceImage: boolean;
}

export const PROVIDER_CAPABILITY_REGISTRY: ModelCapability[] = [
  {
    modelId: 'Veo 3.1 - Quality',
    displayLabel: 'Veo 3.1 Quality',
    provider: 'flow',
    durations: ['8s'],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p'],
    supportsTextToVideo: true,
    supportsImageToVideo: false,
    supportsSourceImage: false,
  },
  {
    modelId: 'Veo 3.1 - Fast',
    displayLabel: 'Veo 3.1 Fast',
    provider: 'flow',
    durations: ['4s', '6s', '8s'],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p'],
    supportsTextToVideo: true,
    supportsImageToVideo: false,
    supportsSourceImage: false,
  },
  {
    modelId: 'Veo 3.1 - Lite',
    displayLabel: 'Veo 3.1 Lite',
    provider: 'flow',
    durations: ['4s', '6s', '8s'],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p'],
    supportsTextToVideo: true,
    supportsImageToVideo: false,
    supportsSourceImage: false,
  },
  {
    modelId: 'Omni 1.1 Flash',
    displayLabel: 'Omni 1.1 Flash',
    provider: 'flow',
    durations: ['4s', '6s', '8s', '10s'],
    ratios: ['16:9', '9:16'],
    resolutions: ['360p', '720p'],
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsSourceImage: true,
  },
  {
    modelId: 'Gemini Omni',
    displayLabel: 'Gemini Omni',
    provider: 'gemini',
    durations: ['10s'],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p'],
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsSourceImage: true,
  },
];

/**
 * Returns all registered model capabilities for a specific provider.
 */
export function getModelsForProvider(provider: 'flow' | 'gemini'): ModelCapability[] {
  return PROVIDER_CAPABILITY_REGISTRY.filter((m) => m.provider === provider);
}

/**
 * Looks up capability by model ID.
 */
export function getCapability(modelId: string): ModelCapability | undefined {
  return PROVIDER_CAPABILITY_REGISTRY.find(
    (m) => m.modelId.toLowerCase() === modelId.toLowerCase()
  );
}

/**
 * Returns the list of providers physically capable of fulfilling the exact video request.
 *
 * Evaluation rules:
 * - Veo models -> strictly ['flow']
 * - Durations other than '10s' -> strictly ['flow']
 * - Omni + 10s (T2V or I2V, 16:9 or 9:16) -> ['flow', 'gemini']
 */
export function getEligibleProviders(params: {
  model: string;
  duration?: string;
  ratio?: string;
  hasSourceImage?: boolean;
}): Array<'flow' | 'gemini'> {
  const model = params.model.trim();
  const duration = params.duration?.trim() || '8s';
  const ratio = params.ratio?.trim() || '16:9';

  // 1. Veo models are strictly Flow-only
  if (model.toLowerCase().includes('veo')) {
    return ['flow'];
  }

  // 2. If duration is not 10s, Gemini is NOT eligible
  if (duration !== '10s') {
    return ['flow'];
  }

  // 3. If aspect ratio is not 16:9 or 9:16, Gemini is NOT eligible
  if (ratio !== '16:9' && ratio !== '9:16') {
    return ['flow'];
  }

  // 4. For Omni 10s (both T2V and I2V), both Flow and Gemini are eligible
  if (model.toLowerCase().includes('omni')) {
    return ['flow', 'gemini'];
  }

  // Default fallback to Flow
  return ['flow'];
}

/**
 * Checks if a specific duration is eligible for Gemini generation.
 * Gemini strictly supports 10s only.
 */
export function isGeminiDurationEligible(duration: string): boolean {
  return duration === '10s';
}

/**
 * Returns the singleton Gemini Omni capability definition.
 */
export function getGeminiModelCapability(): ModelCapability {
  const cap = getCapability('Gemini Omni');
  if (!cap) {
    throw new Error('Gemini Omni capability definition not found in registry');
  }
  return cap;
}
