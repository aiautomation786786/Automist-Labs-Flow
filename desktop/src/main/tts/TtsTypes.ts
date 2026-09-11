/**
 * TtsTypes – Types and interfaces for Infinity Flow Text-to-Speech engines.
 */

import type {
  TtsProviderId,
  TtsEngineBadge,
  TtsEngineMetadata,
  VoiceInfo,
  TtsSceneAudioResult,
  TtsAudioManifest,
} from '../../shared/types';

export {
  TtsProviderId,
  TtsEngineBadge,
  TtsEngineMetadata,
  VoiceInfo,
  TtsSceneAudioResult,
  TtsAudioManifest,
};

export type TtsErrorClassification =
  | 'invalid_key'
  | 'missing_key'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'invalid_voice'
  | 'unavailable'
  | 'cancelled'
  | 'malformed_response'
  | 'invalid_audio';

export interface WordTiming {
  word: string;
  startMs: number;
  durationMs: number;
}

export interface TtsSynthesizeOptions {
  text: string;
  voiceId?: string;
  pitch?: string; // e.g. "+0Hz"
  rate?: string;  // e.g. "+0%"
  volume?: string;// e.g. "+0%"
  speed?: number; // Speed multiplier (e.g. 0.5 to 1.5 for ai33)
  outputPath?: string; // If specified, writes directly to this path
  signal?: AbortSignal;
}

export interface TtsSynthesizeResult {
  audioBuffer: Buffer;
  outputPath?: string;
  sizeBytes: number;
  durationSeconds: number;
  format: 'mp3' | 'wav';
  wordTimings?: WordTiming[];
  providerUsed?: TtsProviderId;
}

export interface ITtsProvider {
  readonly id: TtsProviderId;
  readonly name: string;
  readonly badge: TtsEngineBadge;
  readonly audioExtension: 'mp3' | 'wav';
  readonly defaultVoiceId: string;
  readonly supportsWordTimings: boolean;
  isAvailable(): Promise<boolean>;
  getUnavailableReason(): string | null;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult>;
  testConnection?(): Promise<{ success: boolean; message: string }>;
}

