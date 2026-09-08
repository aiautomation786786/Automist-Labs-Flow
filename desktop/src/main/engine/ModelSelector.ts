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
        // Strategy 1: Find a button in the bottom generation bar containing model keywords
        const buttons = Array.from(document.querySelectorAll('button'));
        const modelBtn = buttons.find((b) => {
          const text = b.textContent || '';
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

        // Strategy 2: Look for an element with aria-label or data-testid related to model
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
   * Returns true if the detected model string indicates a video model.
   */
  static isVideoModel(modelName: string | null): boolean {
    if (!modelName) return false;
    return KNOWN_VIDEO_MODELS.some((v) => modelName.toLowerCase().includes(v.toLowerCase()));
  }

  /**
   * Actively selects and verifies an image generation model in Google Flow.
   * Supports: "Nano Banana Pro", "Nano Banana 2", "Nano Banana 2 Lite".
   *
   * Workflow:
   *  1. Inspects currently displayed model.
   *  2. If already target model -> returns verified.
   *  3. Locates and clicks the model dropdown button.
   *  4. Ensures "Image" tab is active.
   *  5. Locates the requested model option in the opened dropdown.
   *  6. Clicks the option.
   *  7. Ensures quantity is x1.
   *  8. Verifies that the model button now displays the target model.
   */
  static async ensureImageModel(
    page: Page,
    options: { modelName?: string; quantity?: string } = {}
  ): Promise<ModelSelectionResult> {
    const targetModel = options.modelName || NANO_BANANA_2;
    const requestedQuantity = options.quantity || 'x1';
    logger.info('model_selector', `Enforcing image model: ${targetModel} (quantity: ${requestedQuantity})`);

    if (this.isVideoModel(targetModel)) {
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

    // Step 1: Check if already active
    if (modelDetectedBefore && modelDetectedBefore.toLowerCase().includes(targetModel.toLowerCase())) {
      logger.info('model_selector', `${targetModel} is already active`);
      return {
        modelRequested: targetModel,
        modelDetectedBefore,
        selectionAttempted: false,
        modelDetectedAfter: modelDetectedBefore,
        verified: true,
      };
    }

    // Step 2: Open the model selector dropdown
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
    await page.waitForTimeout(500);

    // Step 2b: If in Video mode inside the popover, switch to Image mode
    const imageModeTab = page.locator('.cdk-overlay-pane button:has-text("Image"), .cdk-overlay-pane [role="radio"]:has-text("Image")').first();
    const imageTabVisible = await imageModeTab.isVisible({ timeout: 1000 }).catch(() => false);
    if (imageTabVisible) {
      const isChecked = typeof imageModeTab.getAttribute === 'function' ? await imageModeTab.getAttribute('aria-checked').catch(() => null) : null;
      if (isChecked !== 'true') {
        logger.info('model_selector', 'Switching popover mode to Image...');
        await imageModeTab.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // Step 2c: If a "Select model family" trigger is present inside the popover, open it
    const modelFamilyBtn = page.locator('button[aria-label="Select model family"]').first();
    const modelFamilyVis = await modelFamilyBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (modelFamilyVis) {
      logger.info('model_selector', 'Opening "Select model family" dropdown...');
      await modelFamilyBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Step 3: Find the target model option
    const optionSelectors = [
      `button:has-text("${targetModel}")`,
      `[role="option"]:has-text("${targetModel}")`,
      `[role="menuitem"]:has-text("${targetModel}")`,
      `.mat-mdc-menu-item:has-text("${targetModel}")`,
      `li:has-text("${targetModel}")`,
      `div:has-text("${targetModel}")`,
      `span:has-text("${targetModel}")`,
    ];

    const optionLocator = await FlowDriver.findFirstVisible(page, optionSelectors, 3000);

    if (!optionLocator) {
      // Close dropdown before returning error
      await page.keyboard.press('Escape');
      return {
        modelRequested: targetModel,
        modelDetectedBefore,
        selectionAttempted: true,
        modelDetectedAfter: modelDetectedBefore,
        verified: false,
        error: `Could not find "${targetModel}" option in the opened dropdown menu.`,
      };
    }

    // Step 4: Click the model option
    logger.info('model_selector', `Clicking ${targetModel} option...`);
    await optionLocator.click();
    await page.waitForTimeout(800);

    // Step 4b: Ensure quantity is x1 if quantity radios exist
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

    // Close popover with Escape if still open
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Step 5: Verify the newly selected model contains the target model name
    const modelDetectedAfter = await this.detectCurrentModel(page);
    const verified = !!modelDetectedAfter && modelDetectedAfter.toLowerCase().includes(targetModel.toLowerCase());

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

        const modelOption = page.locator(`.cdk-overlay-pane [role="menuitem"]:has-text("${targetModel}"), .cdk-overlay-pane button:has-text("${targetModel}")`).first();
        if (await modelOption.isVisible({ timeout: 1500 }).catch(() => false)) {
          await modelOption.click().catch(() => {});
          await page.waitForTimeout(600);
        } else {
          logger.warn('model_selector', `Could not find "${targetModel}" menu item in model dropdown`);
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
      (targetLower.includes('lite') && modelTextLower.includes('lite')) ||
      (targetLower.includes('fast') && modelTextLower.includes('fast')) ||
      (targetLower.includes('quality') && modelTextLower.includes('quality')) ||
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
      'button[aria-label="Settings trigger"]',
      '[data-testid="model-selector-button"]',
      '[aria-label*="model" i][role="button"]',
      '[aria-label*="model" i] button',
      '[aria-label*="model" i]',
    ];

    return await FlowDriver.findFirstVisible(page, candidateSelectors, 15000);
  }
}

