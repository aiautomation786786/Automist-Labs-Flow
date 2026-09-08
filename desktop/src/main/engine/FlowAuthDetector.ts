/**
 * FlowAuthDetector – Detects Google Flow authentication state.
 *
 * Replaces and improves upon the fragile account-check.js in the existing MCP:
 *  - Language-agnostic: does not rely on French strings such as "Nouveau projet".
 *  - Uses URL patterns + DOM structural signals rather than translated button text.
 *  - Returns a typed FlowAuthCheckResult.
 *  - Safe to call repeatedly without side effects.
 */

import type { Page } from 'playwright';
import type { FlowAuthCheckResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: true });

// Google Flow base domain and project URL pattern
const FLOW_DOMAIN_PATTERN = /(?:labs\.google|flow\.google\.com)/;
const FLOW_PROJECT_URL_PATTERN = /(?:\/tools\/flow\/project\/|\/project\/)/;
const GOOGLE_ACCOUNTS_PATTERN = /accounts\.google\.com/;
const GOOGLE_SIGNIN_PATTERN = /google\.com\/signin/;

// Locale extraction from Flow URL: /fx/{locale}/tools/flow
const LOCALE_FROM_URL_PATTERN = /\/fx\/([a-z]{2})\/tools\/flow/;

// ---------------------------------------------------------------------------
// Email detection strategies
// ---------------------------------------------------------------------------

/**
 * Attempts to extract the signed-in Google account email from the page.
 * Returns null if not detectable (Google actively obfuscates this).
 *
 * Strategies tried in order:
 *  1. NextData JSON (Next.js pages expose user data in __NEXT_DATA__)
 *  2. DOM attribute selectors (data-email, data-account-email, aria-label)
 *  3. GAIA/GAPI globals
 *
 * This deliberately does NOT capture or store credentials — it reads the
 * displayed email only, which the user can already see in the browser UI.
 */
async function detectEmail(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      // Strategy 1: Next.js __NEXT_DATA__
      const nextData = document.getElementById('__NEXT_DATA__')?.textContent;
      if (nextData) {
        try {
          const parsed = JSON.parse(nextData) as { props?: { pageProps?: { user?: { email?: string } } } };
          const email = parsed?.props?.pageProps?.user?.email;
          if (email) return email;
        } catch { /* continue */ }
      }

      // Strategy 2: DOM attribute selectors
      const selectors = [
        '[aria-label*="Google Account"]',
        '[data-email]',
        '[data-account-email]',
        '[aria-label*="@"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const candidate =
            el.getAttribute('aria-label') ??
            el.getAttribute('data-email') ??
            el.getAttribute('data-account-email') ??
            el.textContent?.trim();
          if (candidate && candidate.includes('@')) {
            const match = candidate.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (match) return match[1];
          }
        }
      }

      // Strategy 3: GAIA globals (rarely accessible due to CSP)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const gaia = w.__GAIA__ ?? w.gapi?.auth?.getToken?.()?.id_token;
        if (typeof gaia === 'string' && gaia.includes('@')) return gaia;
      } catch { /* cross-origin blocked */ }

      return null;
    });
  } catch {
    return null;
  }
}

/**
 * Extracts the UI locale from the current Flow URL.
 * Example: "https://labs.google/fx/fr/tools/flow" → "fr"
 */
function extractLocale(url: string): string | null {
  const match = url.match(LOCALE_FROM_URL_PATTERN);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

export class FlowAuthDetector {
  /**
   * Checks the current page state and returns a FlowAuthCheckResult.
   *
   * Must only be called after the page has navigated to or beyond the Flow URL.
   * Does not navigate the page itself.
   */
  static async check(page: Page, profileId?: string): Promise<FlowAuthCheckResult> {
    const log = profileId ? logger.forProfile(profileId) : logger;

    let url = 'unknown';
    try {
      url = page.url();
    } catch {
      log.warn('auth_detector', 'Could not read page URL');
      return { state: 'unknown', url: 'unknown', detectedEmail: null, locale: null };
    }

    log.debug('auth_detector', 'Checking auth state', { url: url.substring(0, 100) });

    // 1. Redirected to Google accounts — must sign in
    if (GOOGLE_ACCOUNTS_PATTERN.test(url) || GOOGLE_SIGNIN_PATTERN.test(url)) {
      log.info('auth_detector', 'Google login wall detected', { url: url.substring(0, 100) });
      return { state: 'login_required', url, detectedEmail: null, locale: null };
    }

    // 2. URL is still on the Flow domain — check page content
    if (FLOW_DOMAIN_PATTERN.test(url)) {
      // Check for CAPTCHA / bot challenge indicators
      const hasCaptcha = await page.evaluate(() => {
        const bodyText = document.body?.innerText ?? '';
        // "This site is protected by reCAPTCHA" in Google's legal footer is NOT a bot challenge
        const textWithoutFooter = bodyText.replace(/This site is protected by reCAPTCHA[^\n]*/gi, '');
        return (
          textWithoutFooter.includes('reCAPTCHA') ||
          textWithoutFooter.includes('verify you are human') ||
          textWithoutFooter.includes('unusual traffic from your computer network') ||
          !!document.querySelector('iframe[src*="recaptcha/api2/bframe"]') ||
          !!document.querySelector('iframe[src*="recaptcha/enterprise/bframe"]')
        );
      }).catch(() => false);

      if (hasCaptcha) {
        log.warn('auth_detector', 'CAPTCHA or bot challenge detected');
        return { state: 'captcha', url, detectedEmail: null, locale: null };
      }

      // Check if we're in a project or the Flow studio — both mean authenticated
      const isFlowAuthenticated = await page.evaluate(() => {
        // Presence of any Flow-specific structural elements:
        // 1. A project-nav sidebar
        // 2. A prompt textarea / contenteditable (generation UI)
        // 3. A "New project" button
        // 4. A project URL path segment
        const sidebar = document.querySelector('[class*="sidebar"], [class*="nav-rail"]');
        const promptInput = document.querySelector(
          '[contenteditable="true"], textarea[placeholder], textarea'
        );
        const projectLink = document.querySelector('a[href*="/project/"]');
        const isOnProjectPage = window.location.pathname.includes('/project/');
        const hasAccountButton = !!document.querySelector('[aria-label*="Google Account"], [aria-label*="@"]');

        return !!(sidebar || promptInput || projectLink || isOnProjectPage || hasAccountButton);
      }).catch(() => false);

      if (isFlowAuthenticated) {
        const detectedEmail = await detectEmail(page);
        const locale = extractLocale(url);
        log.info('auth_detector', 'Flow authenticated', {
          locale,
          hasEmail: !!detectedEmail,
        });
        return { state: 'authenticated', url, detectedEmail, locale };
      }

      // Landing page with "Create with Google Flow" / Sign in button
      const isLandingPage = await page.evaluate(() => {
        const text = document.body?.innerText ?? '';
        return (
          text.includes('Create with Google Flow') ||
          text.includes('Your AI creative studio') ||
          !!document.querySelector('a[href*="signin"], button[aria-label*="Sign in"]')
        );
      }).catch(() => false);

      if (isLandingPage) {
        log.info('auth_detector', 'Flow landing page detected; login or project entry required');
        return { state: 'login_required', url, detectedEmail: null, locale: extractLocale(url) };
      }

      // Still on Flow domain but not recognizably authenticated — may be loading
      const isLoading = await page.evaluate(() => {
        return document.readyState !== 'complete';
      }).catch(() => true);

      if (isLoading) {
        log.debug('auth_detector', 'Page still loading');
        return { state: 'loading', url, detectedEmail: null, locale: null };
      }

      // Loaded but unknown layout — could be a new Flow UI change
      log.warn('auth_detector', 'Unknown auth state on Flow domain', {
        url: url.substring(0, 100),
      });
      return { state: 'unknown', url, detectedEmail: null, locale: extractLocale(url) };
    }

    // 3. Neither Flow domain nor Google accounts — unexpected location
    log.warn('auth_detector', 'Unexpected page URL during auth check', {
      url: url.substring(0, 100),
    });
    return { state: 'unknown', url, detectedEmail: null, locale: null };
  }

  /**
   * Navigates to Google Flow and checks authentication.
   * This is the correct method to call when starting a new session.
   *
   * @param flowUrl  The Google Flow URL to navigate to. Defaults to English base.
   */
  static async navigateAndCheck(
    page: Page,
    flowUrl = 'https://labs.google/fx/en/tools/flow',
    profileId?: string,
  ): Promise<FlowAuthCheckResult> {
    const log = profileId ? logger.forProfile(profileId) : logger;
    log.info('auth_detector', `Navigating to Flow`, { flowUrl });

    try {
      await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Give the page a moment to redirect if auth is needed
      await page.waitForTimeout(2000);
    } catch (err) {
      log.error('auth_detector', 'Navigation to Flow failed', err as Error);
      return { state: 'unknown', url: flowUrl, detectedEmail: null, locale: null };
    }

    return this.check(page, profileId);
  }
}

// Export constant for use in tests
export { FLOW_PROJECT_URL_PATTERN };
