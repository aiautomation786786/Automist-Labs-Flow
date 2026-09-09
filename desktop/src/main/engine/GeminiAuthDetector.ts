/**
 * GeminiAuthDetector – Detects Google Gemini Web authentication state.
 *
 * Checks if the browser page has an active Google authentication session on gemini.google.com:
 *  - URL-based detection (redirects to accounts.google.com)
 *  - CAPTCHA / bot challenge detection
 *  - DOM element detection (Quill editor, user profile button, Sign in button)
 *  - Account email discovery (via Google Account button aria-label)
 */

import type { Page } from 'playwright';
import type { FlowAuthCheckResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

const GOOGLE_ACCOUNTS_PATTERN = /accounts\.google\.com/;
const GOOGLE_SIGNIN_PATTERN = /(?:google\.com\/signin|accounts\.google\.com\/v3\/signin)/;
const CAPTCHA_PATTERN = /(?:recaptcha|botguard|challenge)/i;

export class GeminiAuthDetector {
  /**
   * Checks the authentication state of a Page on gemini.google.com.
   */
  static async checkAuthentication(page: Page): Promise<FlowAuthCheckResult> {
    const url = page.url();

    // 1. Check for challenge / CAPTCHA first
    if (CAPTCHA_PATTERN.test(url)) {
      logger.warn('gemini_auth', 'Security challenge or CAPTCHA detected in URL', { url });
      return {
        state: 'captcha',
        url,
        detectedEmail: null,
        locale: null,
      };
    }

    // 2. Check if redirected to Google Accounts login page
    if (GOOGLE_SIGNIN_PATTERN.test(url) || GOOGLE_ACCOUNTS_PATTERN.test(url)) {
      logger.info('gemini_auth', 'Redirected to Google Accounts sign-in page', { url });
      return {
        state: 'login_required',
        url,
        detectedEmail: null,
        locale: null,
      };
    }

    // 3. Inspect DOM elements on gemini.google.com
    try {
      // Check for explicit "Sign in" button
      const signInButton = page.locator('button:has-text("Sign in"), a:has-text("Sign in"), [aria-label="Sign in"]').first();
      if (await signInButton.isVisible({ timeout: 500 }).catch(() => false)) {
        logger.info('gemini_auth', 'Explicit Sign in button detected on page', { url });
        return {
          state: 'login_required',
          url,
          detectedEmail: null,
          locale: null,
        };
      }

      // Check for authenticated signals
      const authenticatedCandidates = [
        'div.ql-editor',
        'button[aria-label="Upload and tools"]',
        'button[aria-label="Deselect Videos"]',
        'button[aria-label*="Google Account" i]',
        'a[aria-label="Videos"]',
        'a[href="/videos"]',
      ];

      for (const sel of authenticatedCandidates) {
        if (await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
          const detectedEmail = await this.extractAccountEmail(page);
          logger.info('gemini_auth', 'Confirmed authenticated Gemini session', { url, detectedEmail });
          return {
            state: 'authenticated',
            url,
            detectedEmail,
            locale: 'en',
          };
        }
      }

      // If page is still loading or blank
      const readyState = await page.evaluate(() => document.readyState).catch(() => 'unknown');
      if (readyState === 'loading') {
        return {
          state: 'loading',
          url,
          detectedEmail: null,
          locale: null,
        };
      }
    } catch (err) {
      logger.debug('gemini_auth', `Error during DOM auth inspection: ${(err as Error).message}`);
    }

    return {
      state: 'unknown',
      url,
      detectedEmail: null,
      locale: null,
    };
  }

  /**
   * Attempts to extract the signed-in user's email from the Google Account button.
   */
  static async extractAccountEmail(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        const selectors = [
          'button[aria-label*="Google Account" i]',
          'a[aria-label*="Google Account" i]',
          '[aria-label*="@"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const aria = el.getAttribute('aria-label') || '';
            const match = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (match) return match[1];
          }
        }
        return null;
      });
    } catch {
      return null;
    }
  }
}
