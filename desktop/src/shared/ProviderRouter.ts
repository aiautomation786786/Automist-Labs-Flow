/**
 * ProviderRouter – Intelligent, capacity-aware provider routing layer for Infinity Flow.
 *
 * GUARANTEES:
 * 1. Veo 3.1 Lite, Fast, Quality are strictly Flow-only. Never routed to Gemini.
 * 2. Durations other than 10s are strictly Flow-only.
 * 3. Omni 1.1 Flash 10s (T2V & I2V) evaluates both Flow and Gemini dynamically.
 * 4. In Auto mode, distribution balances across real-time available capacity without hardcoded splits.
 * 5. Bulk jobs are routed PER SLOT, not all-or-nothing.
 */

import { getEligibleProviders } from './ProviderCapabilityRegistry';
import type { GenerationProvider } from './types';

export interface RoutingRequest {
  requestedProvider?: GenerationProvider;
  model: string;
  duration?: string;
  ratio?: string;
  hasSourceImage?: boolean;
  flowSafeCapacity?: number;
  geminiSafeCapacity?: number;
  flowQuarantined?: boolean;
  geminiQuarantined?: boolean;
}

export interface RoutingDecision {
  resolvedProvider: 'flow' | 'gemini';
  resolvedModel: string;
  resolvedDuration: string;
  rationale: string;
}

export class ProviderRouter {
  /**
   * Evaluates a single generation request and returns the optimal provider and model.
   */
  static routeSingle(request: RoutingRequest): RoutingDecision {
    const model = request.model.trim();
    const duration = request.duration?.trim() || (model.includes('Quality') ? '8s' : '4s');
    const ratio = request.ratio?.trim() || '16:9';
    const isI2V = Boolean(request.hasSourceImage);
    const requestedProvider = request.requestedProvider || 'auto';

    // 1. Explicit Provider: Gemini
    if (requestedProvider === 'gemini') {
      if (model.toLowerCase().includes('veo')) {
        return {
          resolvedProvider: 'flow',
          resolvedModel: model,
          resolvedDuration: duration,
          rationale: 'Veo models are not supported by Gemini. Fallback to Google Flow.',
        };
      }
      return {
        resolvedProvider: 'gemini',
        resolvedModel: 'Gemini Omni',
        resolvedDuration: '10s',
        rationale: 'User explicitly requested Gemini provider.',
      };
    }

    // 2. Explicit Provider: Flow
    if (requestedProvider === 'flow') {
      return {
        resolvedProvider: 'flow',
        resolvedModel: model,
        resolvedDuration: duration,
        rationale: 'User explicitly requested Google Flow provider.',
      };
    }

    // 3. Auto Mode – Capability Resolution
    const eligible = getEligibleProviders({
      model,
      duration,
      ratio,
      hasSourceImage: isI2V,
    });

    if (eligible.length === 1 && eligible[0] === 'flow') {
      return {
        resolvedProvider: 'flow',
        resolvedModel: model,
        resolvedDuration: duration,
        rationale: `Request is exclusively eligible for Google Flow (model=${model}, duration=${duration}).`,
      };
    }

    // Both Flow and Gemini are eligible (e.g. Omni 10s T2V or I2V)
    const flowCap = request.flowQuarantined ? 0 : Math.max(0, request.flowSafeCapacity ?? 1);
    const geminiCap = request.geminiQuarantined ? 0 : Math.max(0, request.geminiSafeCapacity ?? 1);

    if (geminiCap > flowCap) {
      return {
        resolvedProvider: 'gemini',
        resolvedModel: 'Gemini Omni',
        resolvedDuration: '10s',
        rationale: `Dynamic load balance: Gemini has higher available capacity (${geminiCap} vs ${flowCap}).`,
      };
    }

    if (flowCap > geminiCap) {
      return {
        resolvedProvider: 'flow',
        resolvedModel: model,
        resolvedDuration: duration,
        rationale: `Dynamic load balance: Flow has higher available capacity (${flowCap} vs ${geminiCap}).`,
      };
    }

    // Capacity is equal and > 0 -> prefer Flow for lower external dependency, or Gemini if Flow is busy
    return {
      resolvedProvider: 'flow',
      resolvedModel: model,
      resolvedDuration: duration,
      rationale: 'Dynamic load balance: Capacity equal, routing to Flow.',
    };
  }

  /**
   * Distributes a batch of prompt slots across eligible providers slot-by-slot based on live capacity.
   */
  static routeBulkSlots<T extends { sourceImagePath?: string; text: string }>(
    slots: T[],
    baseRequest: Omit<RoutingRequest, 'hasSourceImage'>
  ): Array<T & { provider: 'flow' | 'gemini'; resolvedModel: string; resolvedDuration: string }> {
    let currentFlowCap = baseRequest.flowQuarantined ? 0 : Math.max(0, baseRequest.flowSafeCapacity ?? 5);
    let currentGeminiCap = baseRequest.geminiQuarantined ? 0 : Math.max(0, baseRequest.geminiSafeCapacity ?? 5);

    return slots.map((slot) => {
      const decision = this.routeSingle({
        ...baseRequest,
        hasSourceImage: Boolean(slot.sourceImagePath),
        flowSafeCapacity: currentFlowCap,
        geminiSafeCapacity: currentGeminiCap,
      });

      // Decrement remaining virtual capacity for this batch distribution
      if (decision.resolvedProvider === 'gemini') {
        currentGeminiCap = Math.max(0, currentGeminiCap - 1);
      } else {
        currentFlowCap = Math.max(0, currentFlowCap - 1);
      }

      return {
        ...slot,
        provider: decision.resolvedProvider,
        resolvedModel: decision.resolvedModel,
        resolvedDuration: decision.resolvedDuration,
      };
    });
  }
}
