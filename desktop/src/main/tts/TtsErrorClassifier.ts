/**
 * TtsErrorClassifier – Centralized error categorization for Infinity Flow TTS engines.
 *
 * Distinguishes:
 *  - 'cancelled': explicit AbortSignal cancellation (never triggers fallback or retry)
 *  - 'missing_key': provider requires API key / region that is not configured
 *  - 'invalid_key': HTTP 401 / bad authentication
 *  - 'quota': HTTP 402/403 or quota exceeded
 *  - 'rate_limit': HTTP 429 rate limits
 *  - 'unavailable': offline engine lacks required local runtime or model weights
 *  - 'invalid_voice': selected voice ID not supported by provider
 *  - 'invalid_audio': output is empty (0 bytes) or corrupted
 *  - 'malformed_response': API responded with unexpected non-audio format
 *  - 'network': socket error, timeout, or DNS failure
 */

import type { TtsErrorClassification } from './TtsTypes';

export class TtsError extends Error {
  constructor(
    message: string,
    public readonly classification: TtsErrorClassification,
    public readonly providerId: string,
    public readonly originalError?: unknown,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

export function classifyTtsError(err: unknown, providerId = 'tts'): TtsError {
  if (err instanceof TtsError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err || 'Unknown error');
  const lower = message.toLowerCase();

  // 1. Cancellation check (strictly highest priority)
  if (
    (err instanceof Error && err.name === 'AbortError') ||
    lower.includes('abort') ||
    lower.includes('cancel')
  ) {
    return new TtsError(message, 'cancelled', providerId, err);
  }

  // 2. Missing credentials
  if (
    lower.includes('not configured') ||
    lower.includes('missing api key') ||
    lower.includes('missing key') ||
    lower.includes('no key') ||
    lower.includes('region required')
  ) {
    return new TtsError(message, 'missing_key', providerId, err);
  }

  // 3. Invalid credentials / 401
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid key') ||
    lower.includes('forbidden: invalid key') ||
    lower.includes('authentication failed')
  ) {
    return new TtsError(message, 'invalid_key', providerId, err, 401);
  }

  // 4. Quota / Credits / 402 / 403
  if (
    lower.includes('402') ||
    lower.includes('403') ||
    lower.includes('quota') ||
    lower.includes('credits') ||
    lower.includes('balance') ||
    lower.includes('insufficient') ||
    lower.includes('payment required')
  ) {
    return new TtsError(message, 'quota', providerId, err, 403);
  }

  // 5. Rate limit / 429
  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('throttled')
  ) {
    return new TtsError(message, 'rate_limit', providerId, err, 429);
  }

  // 6. Runtime / Model unavailable
  if (
    lower.includes('onnxruntime-node') ||
    lower.includes('not installed') ||
    lower.includes('runtime missing') ||
    lower.includes('weights not found') ||
    lower.includes('model not loaded') ||
    lower.includes('unavailable')
  ) {
    return new TtsError(message, 'unavailable', providerId, err);
  }

  // 7. Invalid voice
  if (
    lower.includes('voice not found') ||
    lower.includes('invalid voice') ||
    lower.includes('unsupported voice')
  ) {
    return new TtsError(message, 'invalid_voice', providerId, err);
  }

  // 8. Invalid or empty audio
  if (
    lower.includes('empty audio') ||
    lower.includes('0 bytes') ||
    lower.includes('corrupt audio') ||
    lower.includes('invalid audio')
  ) {
    return new TtsError(message, 'invalid_audio', providerId, err);
  }

  // 9. Malformed response
  if (
    lower.includes('json parse') ||
    lower.includes('unexpected token') ||
    lower.includes('malformed')
  ) {
    return new TtsError(message, 'malformed_response', providerId, err);
  }

  // 10. Network default
  return new TtsError(message, 'network', providerId, err);
}
