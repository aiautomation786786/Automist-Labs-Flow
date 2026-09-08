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

    // Step 3: Find the Nano Banana 2 option
    const optionSelectors = [
      'button:has-text("Nano Banana 2")',
      '[role="option"]:has-text("Nano Banana 2")',
      '[role="menuitem"]:has-text("Nano Banana 2")',
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

  // ---- Private helpers -----------------------------------------------------

  private static async findModelDropdownButton(page: Page): Promise<Locator | null> {
    const candidateSelectors = [
      // Button containing known model name or model icon in generation toolbar
      'button:has-text("Nano")',
      'button:has-text("Banana")',
      'button:has-text("Omni")',
      'button:has-text("Veo")',
      'button:has-text("Imagen")',
      '[data-testid="model-selector-button"]',
      '[aria-label*="model" i][role="button"]',
      '[aria-label*="model" i] button',
    ];

    return await FlowDriver.findFirstVisible(page, candidateSelectors, 2000);
  }
}
