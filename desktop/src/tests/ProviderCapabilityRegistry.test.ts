import { describe, it, expect } from 'vitest';
import {
  PROVIDER_CAPABILITY_REGISTRY,
  getModelsForProvider,
  getCapability,
  getEligibleProviders,
  isGeminiDurationEligible,
  getGeminiModelCapability,
} from '../shared/ProviderCapabilityRegistry';

describe('ProviderCapabilityRegistry', () => {
  it('registers all core models with strict capability invariants', () => {
    expect(PROVIDER_CAPABILITY_REGISTRY.length).toBe(5);

    const veoQuality = getCapability('Veo 3.1 - Quality');
    expect(veoQuality).toBeDefined();
    expect(veoQuality?.provider).toBe('flow');
    expect(veoQuality?.durations).toEqual(['8s']);
    expect(veoQuality?.supportsImageToVideo).toBe(false);

    const veoFast = getCapability('Veo 3.1 - Fast');
    expect(veoFast?.provider).toBe('flow');
    expect(veoFast?.durations).toEqual(['4s', '6s', '8s']);
    expect(veoFast?.supportsImageToVideo).toBe(false);

    const veoLite = getCapability('Veo 3.1 - Lite');
    expect(veoLite?.provider).toBe('flow');
    expect(veoLite?.durations).toEqual(['4s', '6s', '8s']);
    expect(veoLite?.supportsImageToVideo).toBe(false);

    const omni = getCapability('Omni 1.1 Flash');
    expect(omni?.provider).toBe('flow');
    expect(omni?.durations).toEqual(['4s', '6s', '8s', '10s']);
    expect(omni?.supportsImageToVideo).toBe(true);

    const geminiOmni = getCapability('Gemini Omni');
    expect(geminiOmni?.provider).toBe('gemini');
    expect(geminiOmni?.durations).toEqual(['10s']);
    expect(geminiOmni?.supportsImageToVideo).toBe(true);
  });

  it('filters models correctly by provider', () => {
    const flowModels = getModelsForProvider('flow');
    expect(flowModels.length).toBe(4);
    expect(flowModels.map((m) => m.modelId)).toContain('Veo 3.1 - Quality');
    expect(flowModels.map((m) => m.modelId)).toContain('Omni 1.1 Flash');

    const geminiModels = getModelsForProvider('gemini');
    expect(geminiModels.length).toBe(1);
    expect(geminiModels[0].modelId).toBe('Gemini Omni');
  });

  it('strictly limits Gemini eligibility to 10s Omni requests', () => {
    // Veo is NEVER eligible for Gemini
    expect(getEligibleProviders({ model: 'Veo 3.1 - Quality', duration: '8s' })).toEqual(['flow']);
    expect(getEligibleProviders({ model: 'Veo 3.1 - Fast', duration: '4s' })).toEqual(['flow']);
    expect(getEligibleProviders({ model: 'Veo 3.1 - Lite', duration: '6s' })).toEqual(['flow']);

    // Omni with 4s, 6s, 8s is strictly Flow
    expect(getEligibleProviders({ model: 'Omni 1.1 Flash', duration: '4s' })).toEqual(['flow']);
    expect(getEligibleProviders({ model: 'Omni 1.1 Flash', duration: '6s' })).toEqual(['flow']);
    expect(getEligibleProviders({ model: 'Omni 1.1 Flash', duration: '8s' })).toEqual(['flow']);

    // Omni with 10s is eligible for BOTH Flow and Gemini
    expect(getEligibleProviders({ model: 'Omni 1.1 Flash', duration: '10s', ratio: '16:9' })).toEqual([
      'flow',
      'gemini',
    ]);
    expect(
      getEligibleProviders({
        model: 'Omni 1.1 Flash',
        duration: '10s',
        ratio: '9:16',
        hasSourceImage: true,
      })
    ).toEqual(['flow', 'gemini']);
  });

  it('correctly verifies duration eligibility and retrieves Gemini model capability', () => {
    expect(isGeminiDurationEligible('10s')).toBe(true);
    expect(isGeminiDurationEligible('4s')).toBe(false);
    expect(isGeminiDurationEligible('6s')).toBe(false);
    expect(isGeminiDurationEligible('8s')).toBe(false);

    const cap = getGeminiModelCapability();
    expect(cap.modelId).toBe('Gemini Omni');
    expect(cap.durations).toEqual(['10s']);
  });
});
