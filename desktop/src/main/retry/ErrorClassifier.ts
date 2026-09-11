/**
 * ErrorClassifier – Deterministic error signature generation and classification
 * for Phase 3 ZBot Auto-Retry Safety.
 *
 * Guarantees:
 *  1. Normalizes volatile fields (timestamps, file paths, UUIDs, memory addresses, hashes).
 *  2. Distinguishes deterministic non-retryable errors from transient retryable failures.
 *  3. Explicitly detects user cancellation and marks it strictly non-retryable.
 */

import * as crypto from 'crypto';
import type { RetryReason } from '../../shared/types';

export interface ErrorSignatureParams {
  provider?: string;
  stage?: string;
  errorCode?: string;
  statusCode?: number;
  message: string;
}

export class ErrorClassifier {
  /**
   * Keywords indicating non-retryable errors that require manual user action.
   */
  private static NON_RETRYABLE_KEYWORDS = [
    'invalid api key',
    'invalid_key',
    'unauthorized',
    'forbidden',
    '401',
    '403',
    'quota_exhausted',
    'credit_exhausted',
    'quota',
    'exhausted',
    'resource has been exhausted',
    'account suspended',
    'safety block',
    'safety_block',
    'policy violation',
    'submission_unknown',
    'manual_action_required',
    'empty prompt',
    'unsupported aspect ratio',
    'unsupported model',
    'story not found',
    'does not exist',
    'not found',
    'validation failed',
    'cancelled by user',
    'aborted',
    'abort',
  ];

  /**
   * Keywords indicating transient, retryable errors.
   */
  private static TRANSIENT_KEYWORDS = [
    'timeout',
    'timed out',
    'etimedout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'fetch failed',
    'network error',
    'rate limit',
    '429',
    'too many requests',
    'service unavailable',
    '502',
    '503',
    '504',
    'bad gateway',
    'gateway timeout',
    'temporarily unavailable',
    'internal server error',
  ];

  /**
   * Normalizes a message string by stripping volatile dynamic values.
   */
  static normalizeMessage(msg: string): string {
    if (!msg) return '';

    return msg
      .toLowerCase()
      // Normalize UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      // Normalize hex memory addresses or hashes
      .replace(/0x[0-9a-f]+/gi, '<HEX>')
      .replace(/\b[0-9a-f]{16,64}\b/gi, '<HASH>')
      // Normalize ISO 8601 timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/gi, '<TIMESTAMP>')
      // Normalize Windows & POSIX file paths
      .replace(/(?:[a-z]:\\[^\s:;,]+|\/[^\s:;,]+)/gi, '<PATH>')
      // Normalize standalone numbers (durations, ports, counters)
      .replace(/\b\d+\b/g, '<NUM>')
      // Strip excess whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generates a stable, deterministic error signature.
   */
  static computeSignature(params: ErrorSignatureParams): string {
    const normalized = this.normalizeMessage(params.message);
    const provider = (params.provider || '').toLowerCase().trim();
    const stage = (params.stage || '').toLowerCase().trim();
    const code = (params.errorCode || '').toLowerCase().trim();
    const status = params.statusCode ? String(params.statusCode) : '';

    const payload = `${provider}|${stage}|${code}|${status}|${normalized}`;
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
  }

  /**
   * Checks whether an error is caused by user cancellation.
   */
  static isCancellation(err: any): boolean {
    if (!err) return false;
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.code === 'ERR_ABORTED') return true;
    if (typeof err.classification === 'string' && err.classification === 'cancelled') return true;
    const msg = String(err.message || err).toLowerCase();
    return (
      msg.includes('abort') ||
      msg.includes('cancelled') ||
      msg.includes('canceled') ||
      msg.includes('user requested cancellation')
    );
  }

  /**
   * Determines if an error can be automatically retried.
   */
  static isRetryable(err: any): boolean {
    if (!err) return false;

    // RULE 1: Cancellation is NEVER retryable
    if (this.isCancellation(err)) {
      return false;
    }

    const msg = String(err.message || err).toLowerCase();

    // RULE 2: Explicit non-retryable keywords
    for (const kw of this.NON_RETRYABLE_KEYWORDS) {
      if (msg.includes(kw)) {
        return false;
      }
    }

    // RULE 3: Transient error keywords
    for (const kw of this.TRANSIENT_KEYWORDS) {
      if (msg.includes(kw)) {
        return true;
      }
    }

    // Default to true for standard exceptions unless explicitly marked non-retryable
    return true;
  }

  /**
   * Classifies an error into a structured RetryReason.
   */
  static classifyReason(err: any): RetryReason {
    if (this.isCancellation(err)) {
      return 'CANCELLED_BY_USER';
    }

    const msg = String(err.message || err).toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) {
      return 'RATE_LIMITED';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'TIMEOUT';
    }
    if (
      msg.includes('network') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('socket hang up') ||
      msg.includes('fetch failed')
    ) {
      return 'TRANSIENT_NETWORK';
    }

    if (!this.isRetryable(err)) {
      return 'NON_RETRYABLE_ERROR';
    }

    return 'AUTO_RETRY';
  }
}
