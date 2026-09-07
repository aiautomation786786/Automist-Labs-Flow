/**
 * RatioSelector – Dedicated automation for Google Flow aspect ratio selection.
 *
 * Supported ratios for image generation in this application:
 *  - "16:9" (Landscape)
 *  - "9:16" (Portrait / Shorts / Reels)
 *
 * Provides active UI inspection, button/dropdown clicking, and verification.
 */

import type { Page, Locator } from 'playwright';
import type { RatioSelectionResult, SupportedAspectRatio } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { FlowDriver } from './FlowDriver';

const logger = new AppLogger({ mirrorToStderr: false });

export class RatioSelector {
  /**
   * Reads the current aspect ratio from the page if visible.
   */
  static async detectCurrentRatio(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        // Strategy 1: Active ratio button (has aria-selected="true" or active class)
        const activeButtons = Array.from(document.querySelectorAll('button, [role="tab"], [role="radio"]'));
        for (const btn of activeButtons) {
          const isSelected =
            btn.getAttribute('aria-selected') === 'true' ||
            btn.getAttribute('aria-checked') === 'true' ||
            btn.getAttribute('data-state') === 'active' ||
            btn.className.includes('active') ||
            btn.className.includes('selected');

          const text = (btn.textContent || '').trim();
          if (isSelected && (text.includes('16:9') || text.includes('9:16') || text.includes('1:1'))) {
            if (text.includes('16:9')) return '16:9';
            if (text.includes('9:16')) return '9:16';
            if (text.includes('1:1')) return '1:1';
          }
        }

        // Strategy 2: Ratio button in toolbar showing ratio text
        for (const btn of activeButtons) {
          const text = (btn.textContent || '').trim();
          if ((text === '16:9' || text === '9:16') && (btn as HTMLElement).offsetParent !== null) {
            return text;
          }
        }

        return null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Actively selects the requested ratio (16:9 or 9:16) and verifies the selection.
   */
  static async selectRatio(
    page: Page,
    targetRatio: SupportedAspectRatio,
  ): Promise<RatioSelectionResult> {
    logger.info('ratio_selector', `Selecting aspect ratio: ${targetRatio}`);

    const detectedBefore = await this.detectCurrentRatio(page);

    // If already active, return immediately
    if (detectedBefore === targetRatio) {
      logger.info('ratio_selector', `Ratio ${targetRatio} is already active`);
      return {
        requestedRatio: targetRatio,
        detectedBefore,
        selected: false,
        detectedAfter: detectedBefore,
        verified: true,
      };
    }

    // Attempt 1: Direct button on toolbar (segmented toggle: [16:9] [9:16])
    const directButtonSelectors = [
      `button:has-text("${targetRatio}")`,
      `[role="tab"]:has-text("${targetRatio}")`,
      `[role="radio"]:has-text("${targetRatio}")`,
      `[aria-label*="${targetRatio}"]`,
      `[data-testid*="${targetRatio}"]`,
    ];

    let ratioButton: Locator | null = await FlowDriver.findFirstVisible(page, directButtonSelectors, 1500);

    // Attempt 2: If direct button is not visible, ratio control might be behind a dropdown or menu
    if (!ratioButton) {
      const ratioDropdownTriggerSelectors = [
        'button[aria-label*="ratio" i]',
        'button[aria-label*="format" i]',
        'button:has-text("Ratio")',
        'button:has-text("Format")',
        '[data-testid*="ratio-trigger"]',
      ];

      const dropdownTrigger = await FlowDriver.findFirstVisible(page, ratioDropdownTriggerSelectors, 1500);

      if (dropdownTrigger) {
        logger.debug('ratio_selector', 'Opening ratio dropdown...');
        await dropdownTrigger.click();
        await page.waitForTimeout(400);

        // Now look for the target ratio option inside the opened menu
        ratioButton = await FlowDriver.findFirstVisible(page, directButtonSelectors, 2000);
      }
    }

    if (!ratioButton) {
      return {
        requestedRatio: targetRatio,
        detectedBefore,
        selected: false,
        detectedAfter: detectedBefore,
        verified: false,
        error: `Could not locate ratio button or option for "${targetRatio}" on the page.`,
      };
    }

    logger.info('ratio_selector', `Clicking ratio control for ${targetRatio}...`);
    await ratioButton.click();
    await page.waitForTimeout(500);

    const detectedAfter = await this.detectCurrentRatio(page);
    const verified = detectedAfter === targetRatio;

    logger.info('ratio_selector', 'Ratio selection complete', {
      detectedBefore,
      detectedAfter,
      verified,
    });

    return {
      requestedRatio: targetRatio,
      detectedBefore,
      selected: true,
      detectedAfter,
      verified,
      ...(verified ? {} : { error: `Ratio verification failed. Expected "${targetRatio}", found: "${detectedAfter}"` }),
    };
  }
}
