/**
 * ModelSelector – Dedicated automation for Google Flow image and video model selection.
 *
 * MANDATORY REQUIREMENT:
 *  Actively verifies and switches the Google Flow model dropdown to "Nano Banana 2"
 *  in the UI, rather than merely validating the requested string in configuration.
 *
 * Returns structured ModelSelectionResult with before/after state and verified status.
 */

import type { Page, Locator } from 'playwright';
import type { ModelSelectionResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export const NANO_BANANA_2 = 'Nano Banana 2';

/** Known video models that must NOT be selected during image workflows */
const KNOWN_VIDEO_MODELS = ['Omni Flash', 'Veo 3.1', 'Veo', 'Omni'];

/**
 * Normalizes a model name for exact comparison:
 *  - Trim whitespace
 *  - Lowercase
 *  - Collapse runs of whitespace to single space
 *  - Strip emoji / icon characters (e.g. 🍌)
 *  - Strip trailing "arrow_drop_down" (appears in button text content)
 */
function normalizeModel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Remove emoji / non-ASCII symbols
    .replace(/[^\u0000-\u007F]/g, '')
    // Remove Angular Material icon ligature text (e.g. arrow_drop_down)
    .replace(/\barrow_drop_down\b/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts normalized model family identifier from text:
 *  - "Nano Banana Pro"
 *  - "Nano Banana 2 Lite"
 *  - "Nano Banana 2"
 *  or null if unrecognized.
 */
export function extractModelFamily(text: string | null): string | null {
  if (!text) return null;
  const norm = normalizeModel(text);
  if (norm.includes('pro')) return 'Nano Banana Pro';
  if (norm.includes('lite')) return 'Nano Banana 2 Lite';
  if (norm.includes('banana') || norm.includes('nano')) return 'Nano Banana 2';
  return null;
}

/**
 * Returns true iff the detected model is an exact match for the target model.
 * "Nano Banana 2" must NEVER match "Nano Banana 2 Lite" or "Nano Banana Pro".
 */
export function isExactModelMatch(detected: string, target: string): boolean {
  if (!detected || !target) return false;
  const detectedFamily = extractModelFamily(detected);
  const targetFamily = extractModelFamily(target);
  if (detectedFamily && targetFamily) {
    return detectedFamily === targetFamily;
  }
  return normalizeModel(detected) === normalizeModel(target);
}

/**
 * Reliably clicks an interactive element even if Chrome is minimized, off-screen,
 * or hit-testing is delayed, with automatic fallback for synthetic test mocks.
 */
export async function clickElement(loc: Locator, timeoutMs = 1500): Promise<void> {
  try {
    if (typeof loc.evaluate === 'function') {
      await loc.evaluate((b) => (b as HTMLElement).click());
      return;
    }
  } catch {}
  try {
    if (typeof loc.click === 'function') {
      await loc.click({ force: true, timeout: timeoutMs });
    }
  } catch {}
}

/**
 * Safely checks whether a locator points to an element in the DOM or visible,
 * compatible with Playwright Locators and test mock objects.
 */
export async function isElementPresent(loc: any): Promise<boolean> {
  if (!loc) return false;
  try {
    if (typeof loc.count === 'function') {
      const count = await loc.count().catch(() => 0);
      if (count > 0) return true;
    }
    if (typeof loc.isVisible === 'function') {
      return await loc.isVisible().catch(() => false);
    }
  } catch {}
  return false;
}

export class ModelSelector {
  /**
   * Reads the currently selected model string from the Flow bottom toolbar.
   */
  static async detectCurrentModel(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        // Strategy 0: Direct check on the bottom toolbar settings trigger button
        const settingsTrigger = document.querySelector(
          'button.settings-trigger-button, button[aria-label="Settings trigger"], button:has([settingstriggercontent]), button:has(.settings-summary)'
        ) as HTMLElement;
        if (settingsTrigger && settingsTrigger.offsetParent !== null) {
          const text = (settingsTrigger.textContent || '').trim().replace(/\s+/g, ' ');
          if (text) return text.substring(0, 80);
        }

        // Strategy 1: Find a button in the bottom generation bar containing model keywords or mode keywords
        const buttons = Array.from(document.querySelectorAll('button'));
        const modelBtn = buttons.find((b) => {
          const aria = b.getAttribute('aria-label') || '';
          const text = (b.textContent || '').trim();
          if (aria.includes('Tile grid') || text.includes('settings_2')) return false;
          const hasKeyword =
            text.includes('Nano') ||
            text.includes('Banana') ||
            text.includes('Omni') ||
            text.includes('Veo') ||
            text.includes('Imagen');
          return hasKeyword && (b as HTMLElement).offsetParent !== null;
        });

        if (modelBtn) {
          return (modelBtn.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
        }

        // Strategy 2: Look for composite pill button containing '·' or 'x1' or 'Video' or 'Image'
        const pillBtn = buttons.find((b) => {
          const aria = b.getAttribute('aria-label') || '';
          const text = (b.textContent || '').trim();
          if (aria.includes('Tile grid') || text.includes('settings_2')) return false;
          const isPill =
            (text.includes('·') || text.includes('x1')) &&
            (text.includes('Video') || text.includes('Image') || text.includes('720p') || text.includes('16:9'));
          return isPill && (b as HTMLElement).offsetParent !== null;
        });

        if (pillBtn) {
          return (pillBtn.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
        }

        // Strategy 3: Look for an element with aria-label or data-testid related to model
        const modelSelectorEl = document.querySelector(
          '[data-testid*="model"], [aria-label*="model" i], [class*="model-selector"]'
        );
        if (modelSelectorEl) {
          return (modelSelectorEl.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
        }

        return null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Returns true if the detected model string indicates a video model or Video mode.
   */
  static isVideoModel(modelName: string | null): boolean {
    if (!modelName) return false;
    const lower = modelName.toLowerCase();
    if (lower.includes('video')) return true;
    return KNOWN_VIDEO_MODELS.some((v) => lower.includes(v.toLowerCase()));
  }

  /**
   * Actively selects and verifies an image generation model in Google Flow.
   * Supports: "Nano Banana Pro", "Nano Banana 2", "Nano Banana 2 Lite".
   *
   * Workflow:
   *  1. Inspects currently displayed model / mode.
   *  2. If already target image model and not in Video mode -> returns verified.
   *  3. Locates and clicks the settings dropdown button in toolbar.
   *  4. Ensures "Image" tab / radio is active.
   *  5. Selects aspect ratio if specified.
   *  6. Inspects active image model family; opens dropdown and clicks target if needed.
   *  7. Ensures quantity is x1.
   *  8. Closes popover and verifies active model/mode.
   */
  static async ensureImageModel(
    page: Page,
    optionsOrModelName: { modelName?: string; ratio?: string; quantity?: string } | string = {},
    ratioArg?: string,
    quantityArg?: string
  ): Promise<ModelSelectionResult> {
    const options = typeof optionsOrModelName === 'string'
      ? { modelName: optionsOrModelName, ratio: ratioArg, quantity: quantityArg }
      : (optionsOrModelName || {});
    const targetModel = options.modelName || NANO_BANANA_2;
    const requestedQuantity = options.quantity || 'x1';
    const requestedRatio = options.ratio;
    logger.info('model_selector', `Enforcing image model: ${targetModel} (ratio: ${requestedRatio ?? 'default'}, quantity: ${requestedQuantity})`);

    if (this.isVideoModel(targetModel) && !targetModel.toLowerCase().includes('banana') && !targetModel.toLowerCase().includes('nano')) {
      return {
        modelRequested: targetModel,
        modelDetectedBefore: null,
        selectionAttempted: false,
        modelDetectedAfter: null,
        verified: false,
        error: `"${targetModel}" is not a supported image model (it is a video model). Use ensureVideoModel instead.`,
      };
    }

    // Step 0: Ensure Flow client-side SPA has hydrated and interactive buttons are present
    try {
      if (typeof page.waitForSelector === 'function') {
        await page.waitForSelector('button', { state: 'visible', timeout: 15000 }).catch(() => {});
      }
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(1000);
      }
    } catch {
      logger.warn('model_selector', 'Timed out waiting for initial buttons on Flow page');
    }

    const modelDetectedBefore = await this.detectCurrentModel(page);
    logger.debug('model_selector', 'Model before selection', { modelDetectedBefore });

    // STRICT exact-match: "Nano Banana 2" must NOT match "Nano Banana 2 Lite"
    const isAlreadyTarget =
      !!modelDetectedBefore &&
      !this.isVideoModel(modelDetectedBefore) &&
      isExactModelMatch(modelDetectedBefore, targetModel);

    // Step 1: Check if already active and ratio is not explicitly requested
    if (isAlreadyTarget && !requestedRatio) {
      logger.info('model_selector', `${targetModel} is already active (exact match confirmed)`);
      return {
        modelRequested: targetModel,
        modelDetectedBefore,
        selectionAttempted: false,
        modelDetectedAfter: modelDetectedBefore,
        verified: true,
      };
    }

    // Step 2: Open the model selector dropdown if popover is not already open
    const settingsPane = page.locator('.cdk-overlay-pane:has(flow-prompt-box-settings), flow-prompt-box-settings, .settings-content-overlay').first();
    let paneVisible = false;
    try {
      const evalCheck = await page.evaluate(() => {
        return document.querySelector('flow-prompt-box-settings, .settings-content-overlay') !== null;
      }).catch(() => false);
      if (evalCheck === true) {
        paneVisible = true;
      } else if (typeof settingsPane.isVisible === 'function') {
        paneVisible = await settingsPane.isVisible().catch(() => false);
      }
    } catch {}
    if (!paneVisible) {
      const dropdownButton = await this.findModelDropdownButton(page);
      if (!dropdownButton) {
        // Rich diagnostics on dropdown-not-found
        let diagUrl = '';
        let diagTitle = '';
        let diagButtons: string[] = [];
        try { diagUrl = page.url(); } catch {}
        try { diagTitle = await page.title().catch(() => ''); } catch {}
        try {
          diagButtons = await page.evaluate(() =>
            Array.from(document.querySelectorAll('button'))
              .filter((b) => (b as HTMLElement).offsetParent !== null)
              .map((b) => `[${b.getAttribute('aria-label') || ''}] ${(b.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 50)}`)
              .slice(0, 25)
          ).catch(() => []);
        } catch {}
        logger.error('model_selector', '❌ Could not locate model selector dropdown button', {
          targetModel,
          modelDetectedBefore,
          diagUrl,
          diagTitle,
          diagButtons,
        });
        return {
          modelRequested: targetModel,
          modelDetectedBefore,
          selectionAttempted: false,
          modelDetectedAfter: modelDetectedBefore,
          verified: false,
          error: `Could not locate the model selector dropdown button in the Flow toolbar. URL: ${diagUrl}, Title: ${diagTitle}`,
        };
      }

      logger.info('model_selector', 'Opening model selector dropdown...');
      await clickElement(dropdownButton);
      await page.waitForTimeout(600);
    }

    // Step 3: Switch to Image mode tab/radio if not already active
    const imageModeTab = page.locator('.cdk-overlay-pane button[role="radio"]:has-text("Image"), .cdk-overlay-pane [role="radio"]:has-text("Image"), .cdk-overlay-pane button:has-text("Image")').first();
    const imageTabPresent = await isElementPresent(imageModeTab);
    if (imageTabPresent) {
      const isChecked = typeof imageModeTab.getAttribute === 'function' ? await imageModeTab.getAttribute('aria-checked').catch(() => null) : null;
      if (isChecked !== 'true') {
        logger.info('model_selector', 'Switching popover mode to Image...');
        await clickElement(imageModeTab);
        await page.waitForTimeout(600);
      }
    }

    // Step 4: Aspect Ratio Selection (if specified)
    if (requestedRatio) {
      const ratioRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${requestedRatio}")`).first();
      const isRatioPresent = await isElementPresent(ratioRadio);
      if (isRatioPresent) {
        const isChecked = typeof ratioRadio.getAttribute === 'function' ? await ratioRadio.getAttribute('aria-checked').catch(() => null) : null;
        if (isChecked !== 'true') {
          logger.info('model_selector', `Selecting aspect ratio: ${requestedRatio}`);
          await clickElement(ratioRadio);
          await page.waitForTimeout(300);
        }
      }
    }

    // Step 5: Model Selection (Nano Banana Pro / Nano Banana 2 / Nano Banana 2 Lite)
    const targetLower = normalizeModel(targetModel);
    const modelFamilyBtn = page.locator('flow-prompt-box-settings button[aria-label="Select model family"], .settings-content-overlay button[aria-label="Select model family"], button[aria-label="Select model family"]').first();
    const hasModelFamilyBtn = await isElementPresent(modelFamilyBtn);
    if (hasModelFamilyBtn) {
      const currentModelText = (typeof modelFamilyBtn.textContent === 'function' ? ((await modelFamilyBtn.textContent().catch(() => '')) || '') : '');
      const isModelMatch = isExactModelMatch(currentModelText, targetModel);

      if (!isModelMatch) {
        logger.info('model_selector', `Opening model family dropdown to select ${targetModel}...`);
        await clickElement(modelFamilyBtn);
        await page.waitForTimeout(600);

        const candidateSelectors = [
          `button[role="menuitem"]:has-text("${targetModel}")`,
          `[role="menuitem"]:has-text("${targetModel}")`,
          `.cdk-overlay-pane [role="menuitem"]:has-text("${targetModel}")`,
          `button:has-text("${targetModel}")`,
        ];

        if (targetLower.includes('pro')) {
          candidateSelectors.push('button[role="menuitem"]:has-text("Pro")', '[role="menuitem"]:has-text("Pro")');
        } else if (targetLower.includes('lite')) {
          candidateSelectors.push('button[role="menuitem"]:has-text("Lite")', '[role="menuitem"]:has-text("Lite")');
        } else {
          candidateSelectors.push('button[role="menuitem"]:has-text("Banana 2")', '[role="menuitem"]:has-text("Banana 2")');
        }

        for (const sel of candidateSelectors) {
          const opt = page.locator(sel).first();
          if (await isElementPresent(opt)) {
            logger.info('model_selector', `Selected model option via: ${sel}`);
            await clickElement(opt);
            await page.waitForTimeout(600);
            break;
          }
        }
      }
    }

    // Step 6: Ensure quantity is x1
    const qtyRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${requestedQuantity}")`).first();
    const qtyPresent = await isElementPresent(qtyRadio);
    if (qtyPresent) {
      const isChecked = typeof qtyRadio.getAttribute === 'function' ? await qtyRadio.getAttribute('aria-checked').catch(() => null) : null;
      if (isChecked !== 'true') {
        logger.info('model_selector', `Ensuring quantity ${requestedQuantity}...`);
        await clickElement(qtyRadio);
        await page.waitForTimeout(300);
      }
    }

    // Step 7: Reliably close popover and overlays (NEVER click top-left (50,50) which navigates Home!)
    for (let attempt = 0; attempt < 4; attempt++) {
      let isStillOpen = false;
      try {
        const evalCheck = await page.evaluate(() => {
          return document.querySelector('flow-prompt-box-settings, .settings-content-overlay') !== null;
        }).catch(() => false);
        if (evalCheck === true) {
          isStillOpen = true;
        } else if (typeof settingsPane.isVisible === 'function') {
          isStillOpen = await settingsPane.isVisible().catch(() => false);
        }
      } catch {}
      if (!isStillOpen) break;

      if (typeof page.keyboard?.press === 'function') {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }

      // If still open, try backdrop click
      try {
        const backdrop = page.locator('.cdk-overlay-backdrop').first();
        if (await isElementPresent(backdrop)) {
          await clickElement(backdrop);
        }
      } catch {}
      await page.waitForTimeout(200);
    }

    // Step 8: Verify the newly selected model — STRICT exact match required with resilient polling
    let modelDetectedAfter: string | null = null;
    let verified = false;
    const verifyDeadline = Date.now() + 4000;
    while (Date.now() < verifyDeadline) {
      modelDetectedAfter = await this.detectCurrentModel(page);
      if (modelDetectedAfter && isExactModelMatch(modelDetectedAfter, targetModel)) {
        verified = true;
        break;
      }
      await page.waitForTimeout(300);
    }

    if (verified) {
      logger.info('model_selector', 'Model selection verified ✓', {
        targetModel,
        modelDetectedBefore,
        modelDetectedAfter,
      });
    } else {
      // Rich diagnostic log on failure
      let pageUrl = '';
      let pageTitle = '';
      let visibleButtons: string[] = [];
      try { pageUrl = page.url(); } catch {}
      try { pageTitle = await page.title().catch(() => ''); } catch {}
      try {
        visibleButtons = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button'))
            .filter((b) => (b as HTMLElement).offsetParent !== null)
            .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60))
            .filter(Boolean)
            .slice(0, 20);
        }).catch(() => []);
      } catch {}
      logger.error('model_selector', '❌ Model verification FAILED — diagnostic dump', {
        targetModel,
        modelDetectedBefore,
        modelDetectedAfter,
        normalizedDetected: modelDetectedAfter ? normalizeModel(modelDetectedAfter) : null,
        normalizedTarget: normalizeModel(targetModel),
        pageUrl,
        pageTitle,
        visibleButtons,
      });
    }

    return {
      modelRequested: targetModel,
      modelDetectedBefore,
      selectionAttempted: true,
      modelDetectedAfter,
      verified,
      ...(verified ? {} : { error: `Model verification failed. Expected \"${targetModel}\" (normalized: \"${normalizeModel(targetModel)}\"), detected: \"${modelDetectedAfter}\" (normalized: \"${modelDetectedAfter ? normalizeModel(modelDetectedAfter) : 'null'}\")` }),
    };
  }

  /**
   * Backward-compatible helper that actively enforces Nano Banana 2.
   */
  static async ensureNanoBanana2(page: Page): Promise<ModelSelectionResult> {
    return this.ensureImageModel(page, { modelName: NANO_BANANA_2, quantity: 'x1' });
  }

  /**
   * Actively configures and verifies Google Flow Video mode and parameters:
   *  - Switches mode to Video
   *  - Selects model (e.g. "Omni 1.1 Flash")
   *  - Selects resolution (e.g. "720p")
   *  - Selects duration (e.g. "4s")
   *  - Selects aspect ratio (e.g. "16:9")
   *  - Enforces quantity (e.g. "x1")
   */
   public static async ensureVideoModel(
    page: Page,
    optionsOrModelName: {
      modelName?: string;
      resolution?: string;
      duration?: string;
      ratio?: string;
      quantity?: string;
    } | string = {},
    resArg?: string,
    durArg?: string,
    ratioArg?: string,
    quantityArg?: string
  ): Promise<{
    verified: boolean;
    mode: string;
    model: string;
    resolution: string;
    duration: string;
    durationControl: 'available' | 'unavailable';
    ratio: string;
    quantity: string;
    error?: string;
  }> {
    const options = typeof optionsOrModelName === 'string'
      ? { modelName: optionsOrModelName, resolution: resArg, duration: durArg, ratio: ratioArg, quantity: quantityArg }
      : (optionsOrModelName || {});
    const targetModel = options.modelName || 'Omni 1.1 Flash';
    const targetRes = options.resolution || '720p';
    const targetDur = options.duration || '4s';
    const targetRatio = options.ratio || '16:9';
    const targetQty = options.quantity || 'x1';

    logger.info('model_selector', 'Configuring Video mode and model settings', {
      targetModel,
      targetRes,
      targetDur,
      targetRatio,
      targetQty,
    });

    // Step 0: Ensure Flow client-side SPA has hydrated and interactive buttons are present
    try {
      if (typeof page.waitForSelector === 'function') {
        await page.waitForSelector('button', { state: 'visible', timeout: 15000 }).catch(() => {});
      }
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(1000);
      }
    } catch {
      logger.warn('model_selector', 'Timed out waiting for initial buttons on Flow page');
    }

    // Step 1: Open Settings popover if not already open
    let paneVisible = await page.locator('.cdk-overlay-pane').isVisible().catch(() => false);
    if (!paneVisible) {
      const trigger = await this.findModelDropdownButton(page);
      if (!trigger) {
        return {
          verified: false,
          mode: 'unknown',
          model: 'unknown',
          resolution: 'unknown',
          duration: 'unknown',
          durationControl: 'unavailable',
          ratio: 'unknown',
          quantity: 'unknown',
          error: 'Could not locate settings trigger button on Flow toolbar.',
        };
      }
      await clickElement(trigger);
      await page.waitForTimeout(600);
    }

    // Step 2: Switch to Video mode tab/radio
    const videoTab = page.locator('.cdk-overlay-pane button[role="radio"]:has-text("Video"), .cdk-overlay-pane [role="radio"]:has-text("videocam")').first();
    const isVideoTabVis = await videoTab.isVisible({ timeout: 1500 }).catch(() => false);
    if (isVideoTabVis) {
      const isChecked = await videoTab.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', 'Switching popover to Video mode...');
        await clickElement(videoTab);
        await page.waitForTimeout(600);
      }
    }

    // Step 3: Aspect Ratio
    const ratioRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetRatio}")`).first();
    const isRatioVis = await ratioRadio.isVisible({ timeout: 1000 }).catch(() => false);
    if (isRatioVis) {
      const isChecked = await ratioRadio.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', `Selecting aspect ratio: ${targetRatio}`);
        await clickElement(ratioRadio);
        await page.waitForTimeout(300);
      }
    }

    // Step 4: Model Selection (Omni 1.1 Flash / Veo 3.1 - Lite / Veo 3.1 - Fast)
    const modelFamilyBtn = page.locator('.cdk-overlay-pane button[aria-label="Select model family"]').first();
    const isModelFamilyVis = await modelFamilyBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (isModelFamilyVis) {
      const currentModelText = ((await modelFamilyBtn.textContent().catch(() => '')) || '').toLowerCase();
      const targetLower = targetModel.toLowerCase();
      const isAlreadySelected =
        (targetLower.includes('lite') && currentModelText.includes('lite')) ||
        (targetLower.includes('fast') && currentModelText.includes('fast')) ||
        (targetLower.includes('quality') && currentModelText.includes('quality')) ||
        (targetLower.includes('omni') && currentModelText.includes('omni'));

      if (!isAlreadySelected) {
        logger.info('model_selector', `Opening model family dropdown to select ${targetModel}...`);
        await clickElement(modelFamilyBtn);
        await page.waitForTimeout(600);

        const normalizedTarget = targetModel.replace(/\s*-\s*/g, ' ');
        const candidateSelectors = [
          `.cdk-overlay-pane [role="menuitem"]:has-text("${targetModel}")`,
          `.cdk-overlay-pane button:has-text("${targetModel}")`,
          `.cdk-overlay-pane [role="menuitem"]:has-text("${normalizedTarget}")`,
          `.cdk-overlay-pane button:has-text("${normalizedTarget}")`,
        ];

        if (targetLower.includes('quality')) {
          candidateSelectors.push(
            `.cdk-overlay-pane [role="menuitem"]:has-text("Quality")`,
            `.cdk-overlay-pane button:has-text("Quality")`
          );
        } else if (targetLower.includes('fast')) {
          candidateSelectors.push(
            `.cdk-overlay-pane [role="menuitem"]:has-text("Fast")`,
            `.cdk-overlay-pane button:has-text("Fast")`
          );
        } else if (targetLower.includes('lite')) {
          candidateSelectors.push(
            `.cdk-overlay-pane [role="menuitem"]:has-text("Lite")`,
            `.cdk-overlay-pane button:has-text("Lite")`
          );
        } else if (targetLower.includes('omni')) {
          candidateSelectors.push(
            `.cdk-overlay-pane [role="menuitem"]:has-text("Omni")`,
            `.cdk-overlay-pane button:has-text("Omni")`
          );
        }

        let clicked = false;
        for (const sel of candidateSelectors) {
          const modelOption = page.locator(sel).first();
          if (await modelOption.isVisible({ timeout: 400 }).catch(() => false)) {
            logger.info('model_selector', `Clicking model option selector: ${sel}`);
            await clickElement(modelOption);
            await page.waitForTimeout(600);
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          logger.warn('model_selector', `Could not find candidate menu items for "${targetModel}" in model dropdown`);
        }
      }
    }

    // Step 5: Resolution (if visible in live UI)
    const resRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetRes}")`).first();
    if (await resRadio.isVisible({ timeout: 500 }).catch(() => false)) {
      const isChecked = await resRadio.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', `Selecting resolution: ${targetRes}`);
        await clickElement(resRadio);
        await page.waitForTimeout(300);
      }
    }

    // Step 6: Duration (if visible in live UI)
    const durRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetDur}")`).first();
    if (await durRadio.isVisible({ timeout: 500 }).catch(() => false)) {
      const isChecked = await durRadio.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', `Selecting duration: ${targetDur}`);
        await clickElement(durRadio);
        await page.waitForTimeout(300);
      }
    }

    // Step 7: Quantity (x1)
    const qtyRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetQty}")`).first();
    if (await qtyRadio.isVisible({ timeout: 1000 }).catch(() => false)) {
      const isChecked = await qtyRadio.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', `Selecting quantity: ${targetQty}`);
        await qtyRadio.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    // Step 8: Inspect active settings inside the pane before closing
    const paneState = await page.evaluate(() => {
      const pane = document.querySelector('.cdk-overlay-pane');
      if (!pane) return null;

      const radios = Array.from(pane.querySelectorAll('button[role="radio"], [role="radio"]'));
      const getActiveRadioMatch = (regex: RegExp) => {
        const active = radios.find(r => r.getAttribute('aria-checked') === 'true' && regex.test(r.textContent || ''));
        if (!active) return '';
        const match = (active.textContent || '').match(regex);
        return match ? match[1] : (active.textContent || '').trim();
      };

      const videoActive = radios.some(b => (b.textContent || '').includes('Video') && b.getAttribute('aria-checked') === 'true');

      const modelBtn = pane.querySelector('button[aria-label="Select model family"]');
      const modelText = modelBtn ? (modelBtn.textContent || '').trim() : '';

      const hasResRadios = radios.some(r => /(360p|720p|1080p)/.test(r.textContent || ''));
      const resText = hasResRadios ? getActiveRadioMatch(/(360p|720p|1080p)/) : 'Default';

      const hasDurRadios = radios.some(r => /\b(\d+s)\b/.test(r.textContent || ''));
      const durText = hasDurRadios ? getActiveRadioMatch(/\b(\d+s)\b/) : 'Default';

      const ratioText = getActiveRadioMatch(/(16:9|9:16|4:3|3:4|1:1)/);
      const qtyText = getActiveRadioMatch(/\b(x\d+)\b/);

      return {
        isVideo: videoActive,
        modelText,
        hasResRadios,
        resText,
        hasDurRadios,
        durText,
        ratioText,
        qtyText,
      };
    });

    // Close popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Step 9: Positively verify each setting
    const modeVerified = paneState?.isVideo ?? false;
    const targetLower = targetModel.toLowerCase();
    const modelTextLower = (paneState?.modelText || '').toLowerCase();
    const modelVerified =
      (targetLower.includes('lite') && modelTextLower.includes('lite') && !modelTextLower.includes('omni')) ||
      (targetLower.includes('fast') && modelTextLower.includes('fast') && !modelTextLower.includes('omni')) ||
      (targetLower.includes('quality') && modelTextLower.includes('quality') && !modelTextLower.includes('omni')) ||
      (targetLower.includes('omni') && modelTextLower.includes('omni'));

    const resVerified = paneState?.hasResRadios ? (paneState?.resText || '').includes(targetRes) : true;
    const durVerified = paneState?.hasDurRadios ? (paneState?.durText || '').includes(targetDur) : true;
    const ratioVerified = (paneState?.ratioText || '').includes(targetRatio);
    const qtyVerified = (paneState?.qtyText || '').includes(targetQty);

    const allVerified = modeVerified && modelVerified && resVerified && durVerified && ratioVerified && qtyVerified;
    const durationControl: 'available' | 'unavailable' = paneState?.hasDurRadios ? 'available' : 'unavailable';

    logger.info('model_selector', 'Video settings verification complete', {
      allVerified,
      modeVerified,
      modelVerified,
      resVerified,
      durVerified,
      ratioVerified,
      qtyVerified,
      durationControl,
      paneState,
    });

    return {
      verified: allVerified,
      mode: modeVerified ? 'Video' : 'Unknown',
      model: paneState?.modelText || 'Unknown',
      resolution: paneState?.resText || 'Default',
      duration: paneState?.durText || 'Default',
      durationControl,
      ratio: paneState?.ratioText || 'Unknown',
      quantity: paneState?.qtyText || 'Unknown',
      ...(allVerified ? {} : {
        error: `Video configuration verification failed. State: ${JSON.stringify(paneState)}`,
      }),
    };
  }

  // ---- Private helpers -----------------------------------------------------

  private static async findModelDropdownButton(page: Page): Promise<Locator | null> {
    // Priority 1: Direct targeted selectors for the Flow bottom composer settings trigger button
    const targetedSelectors = [
      'button.settings-trigger-button',
      'button[aria-label="Settings trigger"]',
      'button:has([settingstriggercontent])',
      'button:has(.settings-summary)',
      'div[class*="composer"] button:has-text("Nano")',
      'div[class*="composer"] button:has-text("Banana")',
      'div[class*="composer"] button:has-text("Omni")',
      'div[class*="composer"] button:has-text("Veo")',
      'form button:has-text("Nano")',
      'form button:has-text("Banana")',
      'form button:has-text("Omni")',
      'form button:has-text("Veo")',
      'div[class*="composer"] button:has-text("·")',
      'form button:has-text("·")',
    ];

    for (const sel of targetedSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (typeof loc.isVisible === 'function' && await loc.isVisible().catch(() => false)) {
          return loc;
        }
      } catch {}
    }

    // Priority 2: Actively wait for composer buttons with model or parameter keywords
    const candidateSelectors = [
      'button.settings-trigger-button',
      'button[aria-label="Settings trigger"]',
      'button:has-text("Nano")',
      'button:has-text("Banana")',
      'button:has-text("Omni")',
      'button:has-text("Veo")',
      'button:has-text("Imagen")',
      '[data-testid="model-selector-button"]',
    ];

    const combinedSelector = candidateSelectors.join(', ');
    try {
      const candidateLoc = page.locator(combinedSelector).first();
      if (typeof candidateLoc.waitFor === 'function') {
        await candidateLoc.waitFor({ state: 'visible', timeout: 6000 });
        const text = (await candidateLoc.textContent().catch(() => '')) || '';
        const aria = (await candidateLoc.getAttribute('aria-label').catch(() => '')) || '';
        // Guard against header tile grid settings
        if (!aria.includes('Tile grid') && !text.includes('settings_2')) {
          return candidateLoc;
        }
      } else if (typeof candidateLoc.isVisible === 'function' && await candidateLoc.isVisible().catch(() => false)) {
        return candidateLoc;
      }
    } catch {}

    // Priority 3: Scan composer container for buttons (div.composer, form, div.prompt)
    const startTime = Date.now();
    const canWait = typeof page.waitForTimeout === 'function';
    while (Date.now() - startTime < 6000) {
      try {
        const composerButtons = page.locator('div[class*="composer"], form, div[class*="prompt"], [class*="bottom"]').locator('button');
        const count = typeof composerButtons.count === 'function' ? await composerButtons.count() : 0;
        for (let i = count - 1; i >= 0; i--) {
          const btn = composerButtons.nth(i);
          const isVis = typeof btn.isVisible === 'function' ? await btn.isVisible().catch(() => false) : false;
          if (!isVis) continue;
          const text = (await btn.textContent().catch(() => '')) || '';
          const aria = (await btn.getAttribute('aria-label').catch(() => '')) || '';
          if (aria.includes('Tile grid') || text.includes('settings_2')) continue;
          const combined = `${text} ${aria}`;
          if (
            combined.includes('·') ||
            combined.includes('x1') ||
            combined.includes('Video') ||
            combined.includes('Image') ||
            combined.includes('Banana') ||
            combined.includes('Nano') ||
            combined.includes('Omni') ||
            combined.includes('Veo')
          ) {
            return btn;
          }
        }
      } catch {}
      if (canWait) {
        await page.waitForTimeout(400);
      } else {
        break;
      }
    }

    // Priority 4: Scan all buttons, skipping any tile grid or sidebar settings
    try {
      const buttonLoc = page.locator('button');
      if (typeof buttonLoc.all === 'function') {
        const allButtons = await buttonLoc.all();
        for (const btn of allButtons) {
          const isVis = typeof btn.isVisible === 'function' ? await btn.isVisible().catch(() => false) : false;
          if (!isVis) continue;
          const text = (await btn.textContent().catch(() => '')) || '';
          const aria = (await btn.getAttribute('aria-label').catch(() => '')) || '';
          if (aria.includes('Tile grid') || text.includes('settings_2')) continue;
          const combined = `${text} ${aria}`;
          if (
            combined.includes('Banana') ||
            combined.includes('Nano') ||
            combined.includes('Omni') ||
            combined.includes('Veo') ||
            aria === 'Settings trigger'
          ) {
            return btn;
          }
        }
      }
    } catch {}

    return null;
  }
}

