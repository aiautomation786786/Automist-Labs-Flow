/**
 * CreditFailureDetector – Evidence-based failure classifier for Google Flow.
 *
 * SAFETY INVARIANTS:
 *  1. Strictly evidence-based: HTTP status codes (402, 403, 429) or generic "error" strings
 *     alone are NEVER classified as credit_exhausted without explicit message evidence.
 *  2. Generic timeouts are NEVER classified as credit_exhausted.
 *  3. Lightweight inspection: uses targeted DOM selectors for toasts/alerts rather than
 *     expensive full-document serialization.
 */

import type { Page } from 'playwright';
import type { FailureClassification } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface CreditDetectionResult {
  classification: FailureClassification;
  evidence: string;
  source: 'dom_alert' | 'dom_toast' | 'dom_button' | 'network_payload' | 'error_string';
}

export class CreditFailureDetector {
  /**
   * High-confidence phrases indicating credit or quota exhaustion.
   */
  private static readonly CREDIT_EXHAUSTED_PATTERNS = [
    'out of credits',
    'insufficient credits',
    'no credits remaining',
    'credit balance',
    '0 credits',
    'recharge credits',
    'buy credits',
    'need more credits',
  ];

  private static readonly QUOTA_EXHAUSTED_PATTERNS = [
    'quota_exceeded',
    'quota exceeded',
    'daily generation limit',
    'daily limit reached',
    'rate limit exceeded',
    'too many requests. please try again later',
    'resource_exhausted',
  ];

  private static readonly AUTH_REQUIRED_PATTERNS = [
    'sign in with google',
    'session expired',
    'log in to continue',
    'authentication required',
    're-authenticate',
  ];

  private static readonly FLOW_GENERATION_ERROR_PATTERNS = [
    'violates our safety guidelines',
    'policy violation',
    'prompt could not be processed',
    'harmful content',
    'internal server error',
    'failed to generate video',
    'something went wrong on our end',
  ];

  /**
   * Inspects targeted UI elements on the live page (alerts, toasts, dialogs) for failure signals.
   * Runs in milliseconds using targeted DOM queries (no full page dumps).
   */
  static async detectFromPage(page: Page): Promise<CreditDetectionResult | null> {
    try {
      const detected = await page.evaluate((patterns) => {
        // Targeted selector for Google Flow / Material UI dialogs, overlays, and snackbars
        const alertElements = Array.from(
          document.querySelectorAll(
            '[role="alert"], [role="dialog"], mat-snack-bar-container, .cdk-overlay-pane, .error-banner, [data-testid="error-message"]'
          )
        );

        for (const el of alertElements) {
          const text = (el.textContent || '').trim().toLowerCase();
          if (!text) continue;

          for (const phrase of patterns.credit) {
            if (text.includes(phrase)) {
              return { classification: 'credit_exhausted', evidence: text.slice(0, 200), source: 'dom_alert' };
            }
          }
          for (const phrase of patterns.quota) {
            if (text.includes(phrase)) {
              return { classification: 'quota_exhausted', evidence: text.slice(0, 200), source: 'dom_alert' };
            }
          }
          for (const phrase of patterns.auth) {
            if (text.includes(phrase)) {
              return { classification: 'auth_required', evidence: text.slice(0, 200), source: 'dom_alert' };
            }
          }
          for (const phrase of patterns.safety) {
            if (text.includes(phrase)) {
              return { classification: 'flow_generation_error', evidence: text.slice(0, 200), source: 'dom_alert' };
            }
          }
        }

        // Targeted check: disabled Generate button tooltip or title
        const genBtn = document.querySelector('button[aria-label*="generate" i], button.generate-icon-button');
        if (genBtn) {
          const title = (genBtn.getAttribute('title') || genBtn.getAttribute('aria-label') || '').toLowerCase();
          for (const phrase of patterns.credit) {
            if (title.includes(phrase)) {
              return { classification: 'credit_exhausted', evidence: title, source: 'dom_button' };
            }
          }
          for (const phrase of patterns.quota) {
            if (title.includes(phrase)) {
              return { classification: 'quota_exhausted', evidence: title, source: 'dom_button' };
            }
          }
        }

        return null;
      }, {
        credit: this.CREDIT_EXHAUSTED_PATTERNS,
        quota: this.QUOTA_EXHAUSTED_PATTERNS,
        auth: this.AUTH_REQUIRED_PATTERNS,
        safety: this.FLOW_GENERATION_ERROR_PATTERNS,
      });

      if (detected) {
        logger.info('credit_detector', `Detected UI failure signal: [${detected.classification}] "${detected.evidence}"`);
        return detected as CreditDetectionResult;
      }
      return null;
    } catch {
      // Page might be closed or navigating; do not throw
      return null;
    }
  }

  /**
   * Evidence-based network response classifier.
   * Explicitly requires message payload matching, not status code alone.
   */
  static detectFromNetwork(status: number, responseBody: string): CreditDetectionResult | null {
    if (!responseBody || typeof responseBody !== 'string') return null;
    const lowerBody = responseBody.toLowerCase();

    for (const phrase of this.CREDIT_EXHAUSTED_PATTERNS) {
      if (lowerBody.includes(phrase)) {
        return {
          classification: 'credit_exhausted',
          evidence: `HTTP ${status}: ${responseBody.slice(0, 160)}`,
          source: 'network_payload',
        };
      }
    }

    for (const phrase of this.QUOTA_EXHAUSTED_PATTERNS) {
      if (lowerBody.includes(phrase)) {
        return {
          classification: 'quota_exhausted',
          evidence: `HTTP ${status}: ${responseBody.slice(0, 160)}`,
          source: 'network_payload',
        };
      }
    }

    for (const phrase of this.FLOW_GENERATION_ERROR_PATTERNS) {
      if (lowerBody.includes(phrase)) {
        return {
          classification: 'flow_generation_error',
          evidence: `HTTP ${status}: ${responseBody.slice(0, 160)}`,
          source: 'network_payload',
        };
      }
    }

    return null;
  }

  /**
   * Classifies an error message into a typed FailureClassification.
   */
  static classifyErrorMessage(errorMessage: string): FailureClassification {
    if (!errorMessage) return 'unknown';
    const lower = errorMessage.toLowerCase();

    // Check credit patterns
    for (const phrase of this.CREDIT_EXHAUSTED_PATTERNS) {
      if (lower.includes(phrase)) return 'credit_exhausted';
    }

    // Check quota patterns
    for (const phrase of this.QUOTA_EXHAUSTED_PATTERNS) {
      if (lower.includes(phrase)) return 'quota_exhausted';
    }

    // Check auth patterns
    for (const phrase of this.AUTH_REQUIRED_PATTERNS) {
      if (lower.includes(phrase)) return 'auth_required';
    }

    // Check generic timeout (NEVER classify as credit)
    if (lower.includes('timed out') || lower.includes('timeout')) {
      return 'timeout';
    }

    // Check browser disconnection / page crash
    if (
      lower.includes('target closed') ||
      lower.includes('page crashed') ||
      lower.includes('browser has been closed') ||
      lower.includes('session closed') ||
      lower.includes('connection refused')
    ) {
      return 'browser_error';
    }

    // Check flow generation error
    for (const phrase of this.FLOW_GENERATION_ERROR_PATTERNS) {
      if (lower.includes(phrase)) return 'flow_generation_error';
    }

    return 'unknown';
  }

  static classifyErrorText(errorMessage: string): FailureClassification {
    return this.classifyErrorMessage(errorMessage);
  }
}
