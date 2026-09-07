/**
 * FlowDriver – Isolated DOM interaction helper for Google Flow.
 *
 * Responsibilities:
 *  - Interacting with Flow's specific UI widgets (contenteditable divs, custom dropdowns, buttons)
 *  - Safe clicking with pre/post delay to handle React/Next.js re-renders
 *  - Safe typing into both <textarea> and [contenteditable="true"] fields
 *  - Robust multi-candidate selector resolution (language-resilient)
 *  - Structured interactive element discovery
 *
 * ISOLATION GUARANTEE:
 *  Every method requires an explicit Page reference. No module-level page state.
 */

import type { Page, Locator } from 'playwright';
import type { InteractiveElementInfo } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface SafeActionOptions {
  timeout?: number;
  preDelay?: number;
  postDelay?: number;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_PRE_DELAY = 150;
const DEFAULT_POST_DELAY = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FlowDriver {
  /**
   * Safely clicks an element identified by selector or locator.
   */
  static async safeClick(
    page: Page,
    selectorOrLocator: string | Locator,
    options: SafeActionOptions = {},
  ): Promise<boolean> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const preDelay = options.preDelay ?? DEFAULT_PRE_DELAY;
    const postDelay = options.postDelay ?? DEFAULT_POST_DELAY;

    if (preDelay > 0) await delay(preDelay);

    const locator = typeof selectorOrLocator === 'string'
      ? page.locator(selectorOrLocator).first()
      : selectorOrLocator;

    await locator.waitFor({ state: 'visible', timeout });
    await locator.click({ timeout });

    if (postDelay > 0) await delay(postDelay);
    return true;
  }

  /**
   * Safely fills text into an input field or a contenteditable div (common in Flow).
   */
  static async safeFill(
    page: Page,
    selectorOrLocator: string | Locator,
    text: string,
    options: SafeActionOptions & { delayBetweenChars?: number } = {},
  ): Promise<boolean> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const preDelay = options.preDelay ?? DEFAULT_PRE_DELAY;
    const postDelay = options.postDelay ?? DEFAULT_POST_DELAY;
    const charDelay = options.delayBetweenChars ?? 15;

    if (preDelay > 0) await delay(preDelay);

    const locator = typeof selectorOrLocator === 'string'
      ? page.locator(selectorOrLocator).first()
      : selectorOrLocator;

    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();

    // Check if the element is contenteditable
    const isContentEditable = await locator.evaluate(
      (el) => el.getAttribute('contenteditable') === 'true' || (el as HTMLElement).isContentEditable
    ).catch(() => false);

    if (isContentEditable) {
      // Clear contenteditable contents safely
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await delay(100);
      if (text.length > 0) {
        await page.keyboard.type(text, { delay: charDelay });
      }
    } else {
      // Standard input or textarea
      await locator.fill('');
      if (text.length > 0) {
        await locator.type(text, { delay: charDelay });
      }
    }

    if (postDelay > 0) await delay(postDelay);
    return true;
  }

  /**
   * Tries multiple candidate selectors in order, returning the first visible locator.
   */
  static async findFirstVisible(
    page: Page,
    candidateSelectors: string[],
    timeoutPerSelector = 1500,
  ): Promise<Locator | null> {
    for (const selector of candidateSelectors) {
      try {
        const loc = page.locator(selector).first();
        const visible = await loc.isVisible({ timeout: timeoutPerSelector }).catch(() => false);
        if (visible) {
          return loc;
        }
      } catch {
        // Selector not matched or syntax error — continue
      }
    }
    return null;
  }

  /**
   * Extracts visible texts of all elements matching a selector.
   */
  static async getVisibleTexts(page: Page, selector: string): Promise<string[]> {
    try {
      return await page.evaluate((sel) => {
        const elements = Array.from(document.querySelectorAll(sel));
        const texts: string[] = [];
        for (const el of elements) {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
          if (text && (el as HTMLElement).offsetParent !== null) {
            texts.push(text);
          }
        }
        return texts;
      }, selector);
    } catch {
      return [];
    }
  }

  /**
   * Scans interactive elements (buttons, inputs, links, dropdowns) on the current page
   * without relying on specific localization strings.
   */
  static async detectInteractiveElements(page: Page): Promise<{
    buttons: InteractiveElementInfo[];
    inputs: InteractiveElementInfo[];
    links: InteractiveElementInfo[];
  }> {
    try {
      return await page.evaluate(() => {
        const buttons: {
          tag: string;
          text: string;
          visible: boolean;
          role?: string | null;
          ariaLabel?: string | null;
          dataTestId?: string | null;
        }[] = [];

        const inputs: {
          tag: string;
          text: string;
          visible: boolean;
          role?: string | null;
          ariaLabel?: string | null;
          dataTestId?: string | null;
        }[] = [];

        const links: {
          tag: string;
          text: string;
          visible: boolean;
          role?: string | null;
          ariaLabel?: string | null;
          href?: string | null;
        }[] = [];

        // 1. Buttons and button-like controls
        const btnCandidates = document.querySelectorAll(
          'button, [role="button"], [type="button"], [type="submit"]'
        );
        btnCandidates.forEach((el) => {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
          const visible = (el as HTMLElement).offsetParent !== null;
          buttons.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            visible,
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test-id'),
          });
        });

        // 2. Input fields & contenteditable
        const inputCandidates = document.querySelectorAll(
          'input:not([type="hidden"]), textarea, [contenteditable="true"]'
        );
        inputCandidates.forEach((el) => {
          const placeholder = el.getAttribute('placeholder') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const text = (placeholder || ariaLabel || el.textContent || '').trim().replace(/\s+/g, ' ');
          const visible = (el as HTMLElement).offsetParent !== null;
          inputs.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            visible,
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test-id'),
          });
        });

        // 3. Links
        const linkCandidates = document.querySelectorAll('a[href]');
        linkCandidates.forEach((el) => {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
          const visible = (el as HTMLElement).offsetParent !== null;
          links.push({
            tag: el.tagName,
            text: text.substring(0, 80),
            visible,
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            href: (el.getAttribute('href') || '').substring(0, 150),
          });
        });

        return { buttons, inputs, links };
      });
    } catch (err) {
      logger.warn('flow_driver', 'Error detecting interactive elements', {
        error: (err as Error).message,
      });
      return { buttons: [], inputs: [], links: [] };
    }
  }
}
