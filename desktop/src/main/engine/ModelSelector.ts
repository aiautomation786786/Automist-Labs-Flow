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
   * Actively selects and verifies Nano Banana 2 in the Google Flow UI.
   *
   * Workflow:
   *  1. Inspects currently displayed model.
   *  2. If already Nano Banana 2 -> returns verified.
   *  3. Locates and clicks the model dropdown button.
   *  4. Locates the "Nano Banana 2" option in the opened dropdown.
   *  5. Clicks the option.
   *  6. Verifies that the model button now displays "Nano Banana 2".
   */
  static async ensureNanoBanana2(page: Page): Promise<ModelSelectionResult> {
    logger.info('model_selector', `Enforcing model: ${NANO_BANANA_2}`);

    const modelDetectedBefore = await this.detectCurrentModel(page);
    logger.debug('model_selector', 'Model before selection', { modelDetectedBefore });

    // Step 1: Check if already active
    if (modelDetectedBefore && modelDetectedBefore.includes('Nano Banana 2')) {
      logger.info('model_selector', 'Nano Banana 2 is already active');
      return {
        modelRequested: NANO_BANANA_2,
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
        modelRequested: NANO_BANANA_2,
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

    // Step 3: Find the Nano Banana 2 option
    const optionSelectors = [
      'button:has-text("Nano Banana 2")',
      '[role="option"]:has-text("Nano Banana 2")',
      '[role="menuitem"]:has-text("Nano Banana 2")',
      '.mat-mdc-menu-item:has-text("Nano Banana 2")',
      'li:has-text("Nano Banana 2")',
      'div:has-text("Nano Banana 2")',
      'span:has-text("Nano Banana 2")',
    ];

    const optionLocator = await FlowDriver.findFirstVisible(page, optionSelectors, 3000);

    if (!optionLocator) {
      // Close dropdown before returning error
      await page.keyboard.press('Escape');
      return {
        modelRequested: NANO_BANANA_2,
        modelDetectedBefore,
        selectionAttempted: true,
        modelDetectedAfter: modelDetectedBefore,
        verified: false,
        error: `Could not find "${NANO_BANANA_2}" option in the opened dropdown menu.`,
      };
    }

    // Step 4: Click the Nano Banana 2 option
    logger.info('model_selector', 'Clicking Nano Banana 2 option...');
    await optionLocator.click();
    await page.waitForTimeout(800);

    // Step 4b: Ensure quantity is x1 if quantity radios exist
    const x1Radio = page.locator('.cdk-overlay-pane button[role="radio"]:has-text("x1")').first();
    const x1Vis = await x1Radio.isVisible({ timeout: 1000 }).catch(() => false);
    if (x1Vis) {
      const isChecked = typeof x1Radio.getAttribute === 'function' ? await x1Radio.getAttribute('aria-checked').catch(() => null) : null;
      if (isChecked !== 'true') {
        logger.info('model_selector', 'Ensuring quantity x1...');
        await x1Radio.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    // Close popover with Escape if still open
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Step 5: Verify the newly selected model strictly contains "Nano Banana 2"
    const modelDetectedAfter = await this.detectCurrentModel(page);
    const verified = !!modelDetectedAfter && modelDetectedAfter.toLowerCase().includes('nano banana 2');

    logger.info('model_selector', 'Model selection complete', {
      modelDetectedBefore,
      modelDetectedAfter,
      verified,
    });

    return {
      modelRequested: NANO_BANANA_2,
      modelDetectedBefore,
      selectionAttempted: true,
      modelDetectedAfter,
      verified,
      ...(verified ? {} : { error: `Model verification failed. Expected "${NANO_BANANA_2}", found: "${modelDetectedAfter}"` }),
    };
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
  static async ensureVideoModel(
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

    // Step 4: Model Selection (Omni 1.1 Flash)
    const modelFamilyBtn = page.locator('.cdk-overlay-pane button[aria-label="Select model family"]').first();
    const isModelFamilyVis = await modelFamilyBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (isModelFamilyVis) {
      const currentModelText = (await modelFamilyBtn.textContent().catch(() => '')) || '';
      if (!currentModelText.includes('Omni')) {
        logger.info('model_selector', `Opening model family dropdown to select ${targetModel}...`);
        await modelFamilyBtn.click().catch(() => {});
        await page.waitForTimeout(600);

        const modelOption = page.locator(`.cdk-overlay-pane [role="menuitem"]:has-text("Omni 1.1 Flash"), .cdk-overlay-pane button:has-text("Omni 1.1 Flash")`).first();
        if (await modelOption.isVisible({ timeout: 1500 }).catch(() => false)) {
          await modelOption.click().catch(() => {});
          await page.waitForTimeout(600);
        } else {
          logger.warn('model_selector', `Could not find "${targetModel}" menu item in model dropdown`);
        }
      }
    }

    // Step 5: Resolution
    const resRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetRes}")`).first();
    if (await resRadio.isVisible({ timeout: 1000 }).catch(() => false)) {
      const isChecked = await resRadio.getAttribute('aria-checked').catch(() => null);
      if (isChecked !== 'true') {
        logger.info('model_selector', `Selecting resolution: ${targetRes}`);
        await resRadio.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    // Step 6: Duration
    const durRadio = page.locator(`.cdk-overlay-pane button[role="radio"]:has-text("${targetDur}")`).first();
    if (await durRadio.isVisible({ timeout: 1000 }).catch(() => false)) {
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

      const resText = getActiveRadioMatch(/(360p|720p|1080p)/);
      const durText = getActiveRadioMatch(/\b(\d+s)\b/);
      const ratioText = getActiveRadioMatch(/(16:9|9:16|4:3|3:4|1:1)/);
      const qtyText = getActiveRadioMatch(/\b(x\d+)\b/);

      return {
        isVideo: videoActive,
        modelText,
        resText,
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
    const modelVerified = (paneState?.modelText || '').toLowerCase().includes('omni');
    const resVerified = (paneState?.resText || '').includes(targetRes);
    const durVerified = (paneState?.durText || '').includes(targetDur);
    const ratioVerified = (paneState?.ratioText || '').includes(targetRatio);
    const qtyVerified = (paneState?.qtyText || '').includes(targetQty);

    const allVerified = modeVerified && modelVerified && resVerified && durVerified && ratioVerified && qtyVerified;

    logger.info('model_selector', 'Video settings verification complete', {
      allVerified,
      modeVerified,
      modelVerified,
      resVerified,
      durVerified,
      ratioVerified,
      qtyVerified,
      paneState,
    });

    return {
      verified: allVerified,
      mode: modeVerified ? 'Video' : 'Unknown',
      model: paneState?.modelText || 'Unknown',
      resolution: paneState?.resText || 'Unknown',
      duration: paneState?.durText || 'Unknown',
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

