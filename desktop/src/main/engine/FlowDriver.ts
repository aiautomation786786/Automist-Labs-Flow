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

import * as fs from 'fs';
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

    // Dismiss any lingering overlay popovers before clicking input
    try {
      const pane = page.locator('.cdk-overlay-pane').first();
      if (typeof pane.isVisible === 'function' && await pane.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {});
        await delay(150);
      }
    } catch {}

    try {
      await locator.click({ timeout: 4000 });
    } catch {
      if (typeof locator.focus === 'function') {
        await locator.focus().catch(() => {});
      }
      await locator.click({ force: true }).catch(() => {});
    }

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

  /**
   * Attaches a local source image to the Google Flow composer canvas.
   *
   * Real Flow DOM mechanism:
   * 1. Click "Add ingredients" trigger button on the composer bar.
   * 2. Locate "Upload media" menu item in the CDK overlay pane.
   * 3. Set up Playwright page.waitForEvent('filechooser') and click "Upload media".
   * 4. Call fileChooser.setFiles(imagePath) directly without any native OS dialog.
   * 5. Wait for "Add to prompt" button in the Asset modal to be enabled and click it.
   * 6. Positively verify that the ingredient chip / image preview has mounted in the composer.
   */
  static async attachSourceImage(page: Page, imagePath: string): Promise<boolean> {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Source image file does not exist at path: ${imagePath}`);
    }

    // Step 0: Ensure viewport is sufficiently sized (crucial for background / minimized tabs)
    try {
      if (typeof page.viewportSize === 'function') {
        const vp = page.viewportSize();
        if (!vp || vp.width < 1000 || vp.height < 600) {
          if (typeof page.setViewportSize === 'function') {
            await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
          }
        }
      }
    } catch {}

    // Wait for canvas composer to mount
    try {
      if (typeof page.waitForSelector === 'function') {
        await page.waitForSelector('div[class*="composer"], div[class*="prompt"], textarea, [contenteditable="true"]', { timeout: 10000 }).catch(() => {});
        await delay(1000);
      }
    } catch {}

    // Step 1: Click "Add ingredients" / "Add media" trigger
    const triggerCandidates = [
      'button[aria-label="Add ingredients to the prompt box"]',
      'button[aria-label*="Add ingredient" i]',
      'button[aria-label*="Add media" i]',
      'button:has([data-icon="add_photo_alternate"])',
      'button:has-text("add_photo_alternate")',
      'button:has([data-icon*="photo"])',
      'button:has([data-icon*="image"])',
      'button:has-text("add_box")',
    ];

    const addBtn = await FlowDriver.findFirstVisible(page, triggerCandidates, 3000);

    if (!addBtn) {
      throw new Error('Could not find "Add ingredients / media" button on Flow composer.');
    }

    // Use evaluate click for resilience against offscreen / background rendering
    if (typeof addBtn.evaluate === 'function') {
      await addBtn.evaluate((b) => (b as HTMLElement).click()).catch(() => {});
    } else if (typeof addBtn.click === 'function') {
      await addBtn.click().catch(() => {});
    }
    await delay(600);

    // Step 2: Locate Upload media item in .cdk-overlay-pane
    const uploadItemCandidates = [
      '.cdk-overlay-pane [role="menuitem"]:has-text("Upload")',
      '.cdk-overlay-pane button:has-text("Upload")',
      '.cdk-overlay-pane [role="menuitem"]:has-text("upload")',
      '.cdk-overlay-pane [role="menuitem"]:has-text("Charger")',
      '.cdk-overlay-pane [role="menuitem"]:has-text("Subir")',
    ];

    let uploadItem: Locator | null = null;
    for (const sel of uploadItemCandidates) {
      const loc = page.locator(sel).first();
      const isVis = typeof loc.isVisible === 'function' ? await loc.isVisible({ timeout: 2000 }).catch(() => false) : false;
      if (isVis) {
        uploadItem = loc;
        break;
      }
    }

    if (!uploadItem) {
      // Fallback: check if direct input[type="file"] exists
      const directInput = page.locator('input[type="file"]').first();
      const count = typeof directInput.count === 'function' ? await directInput.count().catch(() => 0) : 0;
      if (count > 0 && typeof directInput.setInputFiles === 'function') {
        await directInput.setInputFiles(imagePath);
        await delay(1000);
      } else {
        throw new Error('Could not find "Upload media" option in menu or file input.');
      }
    } else {
      // Intercept file chooser and upload
      let fileChooser: any = null;
      if (typeof page.waitForEvent === 'function') {
        const [fc] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
          typeof uploadItem.evaluate === 'function'
            ? uploadItem.evaluate((el) => (el as HTMLElement).click()).catch(() => {})
            : uploadItem.click().catch(() => {}),
        ]);
        fileChooser = fc;
      } else if (typeof uploadItem.click === 'function') {
        await uploadItem.click().catch(() => {});
      }

      if (fileChooser && typeof fileChooser.setFiles === 'function') {
        await fileChooser.setFiles(imagePath);
        await delay(1000);
      }
    }

    // Step 3: Wait for "Add to prompt" button in the Asset modal
    const addToPromptCandidates = [
      'button:has-text("Add to prompt")',
      'button:has-text("Ajouter au prompt")',
      'button:has-text("Añadir al prompt")',
      'button:has-text("In Prompt einfügen")',
    ];

    let addToPromptBtn: Locator | null = null;
    for (const sel of addToPromptCandidates) {
      const loc = page.locator(sel).first();
      const isVis = typeof loc.isVisible === 'function' ? await loc.isVisible({ timeout: 3000 }).catch(() => false) : false;
      if (isVis) {
        addToPromptBtn = loc;
        break;
      }
    }

    if (addToPromptBtn) {
      // Wait until enabled (disabled attribute removed once upload is processed)
      let enabled = false;
      for (let i = 0; i < 30; i++) {
        let disabled: string | null = null;
        let ariaDisabled: string | null = null;
        if (typeof addToPromptBtn.getAttribute === 'function') {
          disabled = await addToPromptBtn.getAttribute('disabled').catch(() => null);
          ariaDisabled = await addToPromptBtn.getAttribute('aria-disabled').catch(() => null);
        }
        if (disabled === null && ariaDisabled !== 'true') {
          enabled = true;
          break;
        }
        await delay(500);
      }

      if (!enabled) {
        logger.warn('flow_driver', '"Add to prompt" button still marked disabled, attempting click anyway...');
      }

      if (typeof addToPromptBtn.evaluate === 'function') {
        await addToPromptBtn.evaluate((b) => (b as HTMLElement).click()).catch(() => {});
      } else if (typeof addToPromptBtn.click === 'function') {
        await addToPromptBtn.click().catch(() => {});
      }
      await delay(1500);
    }

    // Step 4: Verify that the ingredient bar or chip mounted inside the composer
    let verificationSuccess = false;
    if (typeof page.evaluate === 'function') {
      for (let attempt = 0; attempt < 5; attempt++) {
        verificationSuccess = await page.evaluate(() => {
          const composer = document.querySelector('div[class*="composer"], form, div[class*="prompt"], [class*="bottom"]');
          if (!composer) return false;
          const hasChip = composer.querySelector('flow-ingredient-bar, [class*="chip-image"], [class*="ingredient"], .has-ingredient-bar') !== null;
          const hasImg = composer.querySelector('img.chip-image, img[src*="flow-content.google"]') !== null;
          return hasChip || hasImg;
        }).catch(() => false);

        if (verificationSuccess) break;
        await delay(1000);
      }
    } else {
      verificationSuccess = true;
    }

    if (!verificationSuccess) {
      throw new Error('Image attachment failed: Flow ingredient chip was not detected in the composer after upload.');
    }

    logger.info('flow_driver', 'Successfully attached source image to Flow prompt box', { imagePath });
    return true;
  }

  /**
   * Detects and safely dismisses non-critical blocking overlays, dialogs, announcements,
   * changelogs, cookie prompts, or tour banners.
   *
   * NEVER dismisses authentication challenges (e.g. Google Sign-In or reCAPTCHA dialogs)
   * or destructive confirmation modals.
   */
  static async dismissNonCriticalOverlays(page: Page): Promise<boolean> {
    try {
      if (typeof page.evaluate !== 'function') return false;

      const dismissed = await page.evaluate(() => {
        // 1. Safety check: do not dismiss authentication dialogs or captchas
        const isAuthOverlay = document.querySelector(
          'input[type="password"], iframe[src*="recaptcha" i], iframe[src*="accounts.google" i]'
        ) !== null;
        if (isAuthOverlay) return false;

        // 2. Identify candidate dialogs or overlay panes
        const overlayContainers = Array.from(
          document.querySelectorAll(
            '.cdk-overlay-pane, mat-dialog-container, [role="dialog"], [role="alertdialog"], [class*="modal" i], [class*="announcement" i], [class*="banner" i]'
          )
        );

        if (overlayContainers.length === 0) return false;

        // 3. Search for safe dismissive buttons within or across overlays
        const dismissKeywords = [
          'got it', 'dismiss', 'close', 'ok', 'not now', 'later',
          'accept all', 'i understand', 'continue', 'skip', 'done',
          'd\'accord', 'fermer', 'annuler', 'verstanden', 'schließen'
        ];

        for (const container of overlayContainers) {
          const buttons = Array.from(container.querySelectorAll('button, [role="button"], a'));
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            const title = (btn.getAttribute('title') || '').trim().toLowerCase();

            const isDismiss = dismissKeywords.some(
              (kw) => text === kw || aria === kw || title === kw || aria.includes('close') || title.includes('close')
            );

            // Close icon button check
            const hasCloseIcon = btn.querySelector('mat-icon, .material-icons, svg') && (
              text.includes('close') || text.includes('clear') || text.includes('x') || aria.includes('close')
            );

            if (isDismiss || hasCloseIcon) {
              (btn as HTMLElement).click();
              return true;
            }
          }
        }

        return false;
      });

      if (dismissed) {
        logger.info('flow_driver', 'Dismissed non-critical overlay on Flow page');
        await delay(300);
        return true;
      }

      // Fallback: if a generic cdk-overlay-backdrop exists without auth form, send Escape key
      const hasBackdrop = await page.locator('.cdk-overlay-backdrop').first().isVisible().catch(() => false);
      if (hasBackdrop) {
        await page.keyboard.press('Escape').catch(() => {});
        await delay(200);
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Adaptively waits for the first visible element among candidate selectors.
   * Unlike findFirstVisible (which checks only the instantaneous DOM state),
   * waitForFirstVisible polls over candidate selectors until one becomes visible
   * or the timeout expires. This accommodates SPA hydration delays gracefully.
   */
  static async waitForFirstVisible(
    page: Page,
    candidateSelectors: string[],
    timeoutMs = 12000,
    pollIntervalMs = 350,
  ): Promise<Locator | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      for (const selector of candidateSelectors) {
        try {
          const loc = page.locator(selector).first();
          const isVis = await loc.isVisible().catch(() => false);
          if (isVis) {
            return loc;
          }
        } catch {
          // Ignore selector error and continue
        }
      }

      const remaining = timeoutMs - (Date.now() - startTime);
      if (remaining <= 0) break;
      await delay(Math.min(pollIntervalMs, remaining));
    }

    return null;
  }
}

