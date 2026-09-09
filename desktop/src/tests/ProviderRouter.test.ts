import { describe, it, expect } from 'vitest';
import { ProviderRouter } from '../shared/ProviderRouter';

describe('ProviderRouter', () => {
  it('respects explicit provider overrides', () => {
    // Explicit Flow override
    const flowDecision = ProviderRouter.routeSingle({
      requestedProvider: 'flow',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      ratio: '16:9',
    });
    expect(flowDecision.resolvedProvider).toBe('flow');
    expect(flowDecision.resolvedModel).toBe('Omni 1.1 Flash');

    // Explicit Gemini override on Omni
    const geminiDecision = ProviderRouter.routeSingle({
      requestedProvider: 'gemini',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      ratio: '16:9',
    });
    expect(geminiDecision.resolvedProvider).toBe('gemini');
    expect(geminiDecision.resolvedModel).toBe('Gemini Omni');
    expect(geminiDecision.resolvedDuration).toBe('10s');

    // Explicit Gemini on Veo fallback safely to Flow
    const veoOverride = ProviderRouter.routeSingle({
      requestedProvider: 'gemini',
      model: 'Veo 3.1 - Quality',
      duration: '8s',
      ratio: '16:9',
    });
    expect(veoOverride.resolvedProvider).toBe('flow');
    expect(veoOverride.resolvedModel).toBe('Veo 3.1 - Quality');
  });

  it('routes strictly to Flow when model or duration is Flow-only in Auto mode', () => {
    // Veo is strictly Flow-only
    const veoQuality = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Veo 3.1 - Quality',
      duration: '8s',
    });
    expect(veoQuality.resolvedProvider).toBe('flow');

    // Omni 4s, 6s, 8s are strictly Flow-only
    const omni4s = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '4s',
    });
    expect(omni4s.resolvedProvider).toBe('flow');

    const omni8s = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '8s',
    });
    expect(omni8s.resolvedProvider).toBe('flow');
  });

  it('dynamically balances Omni 10s jobs based on safe available capacity in Auto mode', () => {
    // Gemini has higher capacity -> routes to Gemini
    const geminiPreferred = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      flowSafeCapacity: 2,
      geminiSafeCapacity: 6,
    });
    expect(geminiPreferred.resolvedProvider).toBe('gemini');
    expect(geminiPreferred.resolvedModel).toBe('Gemini Omni');

    // Flow has higher capacity -> routes to Flow
    const flowPreferred = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      flowSafeCapacity: 8,
      geminiSafeCapacity: 2,
    });
    expect(flowPreferred.resolvedProvider).toBe('flow');
    expect(flowPreferred.resolvedModel).toBe('Omni 1.1 Flash');

    // Flow is quarantined -> routes to Gemini
    const flowQuarantined = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      flowQuarantined: true,
      flowSafeCapacity: 10,
      geminiSafeCapacity: 2,
    });
    expect(flowQuarantined.resolvedProvider).toBe('gemini');

    // Gemini is quarantined -> routes to Flow
    const geminiQuarantined = ProviderRouter.routeSingle({
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      geminiQuarantined: true,
      flowSafeCapacity: 2,
      geminiSafeCapacity: 10,
    });
    expect(geminiQuarantined.resolvedProvider).toBe('flow');
  });

  it('distributes bulk slots dynamically per slot based on real-time capacity', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({
      text: `Prompt slot ${i + 1}`,
      slotIndex: i,
    }));

    // Safe capacities: Flow = 4, Gemini = 6
    const distributed = ProviderRouter.routeBulkSlots(slots, {
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      flowSafeCapacity: 4,
      geminiSafeCapacity: 6,
    });

    const flowAssigned = distributed.filter((s) => s.provider === 'flow');
    const geminiAssigned = distributed.filter((s) => s.provider === 'gemini');

    // Exactly 4 Flow and 6 Gemini, matching real available capacity
    expect(flowAssigned.length).toBe(4);
    expect(geminiAssigned.length).toBe(6);

    // Verify all Gemini slots have resolvedModel = Gemini Omni and duration = 10s
    for (const g of geminiAssigned) {
      expect(g.resolvedModel).toBe('Gemini Omni');
      expect(g.resolvedDuration).toBe('10s');
    }

    // Verify all Flow slots have resolvedModel = Omni 1.1 Flash
    for (const f of flowAssigned) {
      expect(f.resolvedModel).toBe('Omni 1.1 Flash');
    }
  });

  it('correctly handles Image-to-Video in bulk slot routing', () => {
    const slots = [
      { text: 'Motion prompt 1', sourceImagePath: 'C:/img1.jpg' },
      { text: 'Motion prompt 2', sourceImagePath: 'C:/img2.jpg' },
      { text: 'Motion prompt 3', sourceImagePath: 'C:/img3.jpg' },
      { text: 'Motion prompt 4', sourceImagePath: 'C:/img4.jpg' },
    ];

    const routed = ProviderRouter.routeBulkSlots(slots, {
      requestedProvider: 'auto',
      model: 'Omni 1.1 Flash',
      duration: '10s',
      flowSafeCapacity: 2,
      geminiSafeCapacity: 2,
    });

    expect(routed.length).toBe(4);
    const geminiCount = routed.filter((r) => r.provider === 'gemini').length;
    const flowCount = routed.filter((r) => r.provider === 'flow').length;
    expect(geminiCount).toBe(2);
    expect(flowCount).toBe(2);
  });
});
