/**
 * ScriptAiTypes – Interfaces and contracts for Script AI generation,
 * providers, and scene refinement.
 */

import type { ScriptAiProgressEvent } from '../../shared/types';

export interface ProviderCompletionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (event: ScriptAiProgressEvent) => void;
}

export interface ProviderCompletionResult {
  text: string;
  model: string;
  rounds: number;
  charsReceived: number;
  keyRotations: number;
  durationMs: number;
  isMock?: boolean;
}

export interface IScriptAiProvider {
  readonly id: string;
  readonly name: string;

  /**
   * Generates completion text given system instructions and user message.
   */
  generateChatCompletion(
    systemPrompt: string,
    userPrompt: string,
    options?: ProviderCompletionOptions
  ): Promise<ProviderCompletionResult>;

  /**
   * Verifies connectivity or API key validity.
   */
  testConnection(): Promise<{ success: boolean; error?: string; model?: string; isMock?: boolean }>;
}
