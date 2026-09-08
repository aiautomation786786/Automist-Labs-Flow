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
import { FlowDriver } from './FlowDriver';

const logger = new AppLogger({ mirrorToStderr: false });

export const NANO_BANANA_2 = 'Nano Banana 2';

/** Known video models that must NOT be selected during image workflows */
const KNOWN_VIDEO_MODELS = ['Omni Flash', 'Veo 3.1', 'Veo', 'Omni'];

export class ModelSelector {
  /**
   * Reads the currently selected model string from the Flow bottom toolbar.
   */
  static async detectCurrentModel(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        // Strategy 1: Find a button in the bottom generation bar containing model keywords or mode keywords
        const buttons = Array.from(document.querySelectorAll('button'));
        const modelBtn = buttons.find((b) => {
          const text = (b.textContent || '').trim();
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
          const text = (b.textContent || '').trim();
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
    options: { modelName?: string; ratio?: string; quantity?: string } = {}
  ): Promise<ModelSelectionResult> {
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

    const modelDetectedBefore = await this.detectCurrentModel(page);
    logger.debug('model_selector', 'Model before selection', { modelDetectedBefore });

    const targetLower = targetModel.toLowerCase();
    const beforeLower = (modelDetectedBefore || '').toLowerCase();
    const isAlreadyTarget =
      beforeLower.includes(targetLower) &&
      !beforeLower.includes('video') &&
      (!targetLower.includes('pro') ? !beforeLower.includes('pro') : true) &&
      (!targetLower.includes('lite') ? !beforeLower.includes('lite') : true);

    // Step 1: Check if already active and ratio is not explicitly requested
    if (isAlreadyTarget && !requestedRatio) {
      logger.info('model_selector', `${targetModel} is already active`);
      return {
        modelRequested: targetModel,
        modelDetectedBefore,
        selectionAttempted: false,
        modelDetectedAfter: modelDetectedBefore,
        verified: true,
      };
    }

    // Step 2: Open the model selector dropdown if popover is not already open
    let paneVisible = false;
    try {
      const paneLoc = page.locator('.cdk-overlay-pane');
      if (typeof paneLoc.first === 'function') {
        const firstEl = paneLoc.first();
        paneVisible = typeof firstEl.isVisible === 'function' ? await firstEl.isVisible().catch(() => false) : false;
      } else if (typeof (paneLoc as any).isVisible === 'function') {
        paneVisible = await (paneLoc as any).isVisible().catch(() => false);
      }
    } catch {}
    if (!paneVisible) {
      const dropdownButton = await this.findModelDropdownButton(page);
      if (!dropdownButton) {
        return {
          modelRequested: targetModel,
          modelDetectedBefore,
          selectionAttempted: false,
          modelDetectedAfter: modelDetectedBefore,
          verified: false,
          error: 'Could not locate the model selector dropdown button in the Flow toolbar.',
        };
      }

      logger.info('model_selector', 'Opening model selector dropdown...');
      await dropdownButton.click();
      await page.waitForTimeout(600);
    }

    // Step 3: Switch to Image mode tab/radio if not already active
    const imageModeTab = page.locator('.cdk-overlay-pane button[role="radio"]:has-text("Image"), .cdk-overlay-pane [role="radio"]:has-text("Image"), .cdk-overlay-pane button:has-text("Image")').first();
    const imageTabVisible = await imageModeTab.isVisible({ timeout: 1500 }).catch(() => false);
    if (imageTabVisible) {
      const isChecked = typeof imageModeTab.getAttribute === 'function' ? await imageModeTab.getAttribute('aria-checked').catch(() => null) : null;
      if (isChecked !== 'true') {
        logger.info('model_selector', 'Switching popover mode to Image...');
        await imageModeTab.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    }

    // Step 4: Aspect Ratio Selection (if specified)
    if (requestedRatio) {
      const ratioRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${requestedRatio}")`).first();
      const isRatioVis = await ratioRadio.isVisible({ timeout: 1000 }).catch(() => false);
      if (isRatioVis) {
        const isChecked = typeof ratioRadio.getAttribute === 'function' ? await ratioRadio.getAttribute('aria-checked').catch(() => null) : null;
        if (isChecked !== 'true') {
          logger.info('model_selector', `Selecting aspect ratio: ${requestedRatio}`);
          await ratioRadio.click().catch(() => {});
          await page.waitForTimeout(300);
        }
      }
    }

    // Step 5: Model Selection (Nano Banana Pro / Nano Banana 2 / Nano Banana 2 Lite)
    const modelFamilyBtn = page.locator('.cdk-overlay-pane button[aria-label="Select model family"], .cdk-overlay-pane button:has-text("Nano")').first();
    const modelFamilyVis = await modelFamilyBtn.isVisible({ timeout: 1500 }).catch(() => false);
    if (modelFamilyVis) {
      const currentModelText = (typeof modelFamilyBtn.textContent === 'function' ? ((await modelFamilyBtn.textContent().catch(() => '')) || '') : '').toLowerCase();
      const isModelMatch =
        (targetLower.includes('pro') && currentModelText.includes('pro')) ||
        (targetLower.includes('lite') && currentModelText.includes('lite')) ||
        (!targetLower.includes('pro') && !targetLower.includes('lite') && currentModelText.includes('banana 2') && !currentModelText.includes('pro') && !currentModelText.includes('lite'));

      if (!isModelMatch) {
        logger.info('model_selector', `Opening model family dropdown to select ${targetModel}...`);
        await modelFamilyBtn.click().catch(() => {});
        await page.waitForTimeout(600);

        const candidateSelectors = [
          `[role="menuitem"]:has-text("${targetModel}")`,
          `.cdk-overlay-pane [role="menuitem"]:has-text("${targetModel}")`,
          `button[role="menuitem"]:has-text("${targetModel}")`,
        ];

        if (targetLower.includes('pro')) {
          candidateSelectors.push('[role="menuitem"]:has-text("Pro")');
        } else if (targetLower.includes('lite')) {
          candidateSelectors.push('[role="menuitem"]:has-text("Lite")');
        } else {
          candidateSelectors.push('[role="menuitem"]:has-text("Banana 2")');
        }

        const optionLocator = await FlowDriver.findFirstVisible(page, candidateSelectors, 3000);
        if (optionLocator) {
          logger.info('model_selector', `Clicking ${targetModel} menu item...`);
          await optionLocator.click();
          await page.waitForTimeout(600);
        } else {
          logger.warn('model_selector', `Could not find menu item for ${targetModel}`);
        }
      }
    }

    // Step 6: Ensure quantity is x1
    const qtyRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${requestedQuantity}")`).first();
    const qtyVis = await qtyRadio.isVisible({ timeout: 1000 }).catch(() => false);
    if (qtyVis) {
      const isChecked = typeof qtyRadio.getAttribute === 'function' ? await qtyRadio.getAttribute('aria-checked').catch(() => null) : null;
      if (isChecked !== 'true') {
        logger.info('model_selector', `Ensuring quantity ${requestedQuantity}...`);
        await qtyRadio.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    // Step 7: Reliably close popover and overlays
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      let isStillOpen = false;
      try {
        const pane = page.locator('.cdk-overlay-pane').first();
        if (typeof pane.isVisible === 'function') {
          isStillOpen = await pane.isVisible().catch(() => false);
        }
      } catch {}
      if (!isStillOpen) break;

      // Click backdrop or click outside to dismiss
      try {
        const backdrop = page.locator('.cdk-overlay-backdrop').first();
        if (typeof backdrop.isVisible === 'function' && await backdrop.isVisible().catch(() => false)) {
          await backdrop.click({ force: true }).catch(() => {});
        } else if (typeof page.mouse?.click === 'function') {
          await page.mouse.click(50, 50).catch(() => {});
        }
      } catch {}
      await page.waitForTimeout(200);
    }

    // Step 8: Verify the newly selected model contains the target model name or is in Image mode
    const modelDetectedAfter = await this.detectCurrentModel(page);
    const afterLower = (modelDetectedAfter || '').toLowerCase();
    const verified = !!modelDetectedAfter && (
      afterLower.includes(targetLower) ||
      (afterLower.includes('image') && !afterLower.includes('video')) ||
      (afterLower.includes('banana') && !afterLower.includes('video'))
    );

    logger.info('model_selector', 'Model selection complete', {
      modelDetectedBefore,
      modelDetectedAfter,
      verified,
    });

    return {
      modelRequested: targetModel,
      modelDetectedBefore,
      selectionAttempted: true,
      modelDetectedAfter,
      verified,
      ...(verified ? {} : { error: `Model verification failed. Expected "${targetModel}", found: "${modelDetectedAfter}"` }),
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
    options: {
      modelName?: string;
      resolution?: string;
      duration?: string;
      ratio?: string;
      quantity?: string;
    } = {}
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
      await trigger.click();
      await page.waitForTimeout(600);
    }

    // Step 2: Switch to Video mode tab/radio
    const videoTab = page.locator('.cdk-overlay-pane button[role="radio"]:has-text("Video"), .cdk-overlay-pane [role="radio"]:has-text("videocam")').first();
    const isVideoTabVis = await videoTab.isVisible({ timeout: 1500 }).catch(() => false);
    if (isVideoTabVis) {
      const isChecked = await videoTab.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', 'Switching popover to Video mode...');
        await videoTab.click().catch(() => {});
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
        await ratioRadio.click().catch(() => {});
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
        await modelFamilyBtn.click().catch(() => {});
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
            await modelOption.click().catch(() => {});
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
        await resRadio.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    // Step 6: Duration (if visible in live UI)
    const durRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetDur}")`).first();
    if (await durRadio.isVisible({ timeout: 500 }).catch(() => false)) {
      const isChecked = await durRadio.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', `Selecting duration: ${targetDur}`);
        await durRadio.click().catch(() => {});
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
    const candidateSelectors = [
      // Button containing known model name or model icon in generation toolbar
      'button:has-text("Nano")',
      'button:has-text("Banana")',
      'button:has-text("Omni")',
      'button:has-text("Veo")',
      'button:has-text("Imagen")',
      'button:has-text("Video")',
      'button:has-text("Image")',
      'button:has-text("·")',
      'button:has-text("x1")',
      'button:has-text("720p")',
      'button:has-text("1080p")',
      'button:has-text("16:9")',
      'button:has-text("9:16")',
      'button:has-text("1:1")',
      'button:has-text("4:3")',
      'button:has-text("3:4")',
      'button[aria-label="Settings trigger"]',
      'button[aria-label*="settings" i]',
      'button[aria-label*="model" i]',
      '[data-testid="model-selector-button"]',
      '[aria-label*="model" i][role="button"]',
      '[aria-label*="model" i] button',
      '[aria-label*="model" i]',
    ];

    const found = await FlowDriver.findFirstVisible(page, candidateSelectors, 4000);
    if (found) return found;

    // Fallback: inspect buttons in the prompt composer toolbar
    try {
      const composerButtons = page.locator('div[class*="composer"], form, div[class*="prompt"]').locator('button');
      const count = await composerButtons.count();
      for (let i = count - 1; i >= 0; i--) {
        const btn = composerButtons.nth(i);
        const text = (await btn.textContent().catch(() => '')) || '';
        if (text.includes('·') || text.includes('x1') || text.includes('Video') || text.includes('Image') || text.includes('Banana')) {
          return btn;
        }
      }
    } catch {}

    return null;
  }
}

