/**
 * FlowUIDiscovery – Flow-specific UI discovery and introspection layer.
 *
 * Inspects the live Flow page and identifies useful controls without depending
 * entirely on text labels. Returns a structured FlowUIDiscoveryResult.
 *
 * Discovered controls include:
 *  - promptInput: contenteditable div or textarea
 *  - modelSelector: model button and current model text
 *  - ratioSelector: ratio buttons and current ratio
 *  - generateButton: generate button presence, text, and disabled state
 *  - project context: project URL and project ID
 */

import type { Page } from 'playwright';
import type { FlowUIDiscoveryResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { ProjectContext } from './ProjectContext';
import { ModelSelector } from './ModelSelector';
import { RatioSelector } from './RatioSelector';
import { FlowDriver } from './FlowDriver';

const logger = new AppLogger({ mirrorToStderr: false });

export class FlowUIDiscovery {
  /**
   * Performs complete introspection of the currently loaded Flow page.
   */
  static async discover(page: Page): Promise<FlowUIDiscoveryResult> {
    const url = page.url();
    const projectId = ProjectContext.extractProjectId(url);
    const isProjectPage = projectId !== null;

    logger.debug('ui_discovery', 'Starting UI discovery', { url, isProjectPage });

    // 1. Detect Prompt Input
    const promptInfo = await page.evaluate(() => {
      const contentEditable = document.querySelector('[contenteditable="true"]');
      if (contentEditable && (contentEditable as HTMLElement).offsetParent !== null) {
        return { found: true, type: 'contenteditable' as const };
      }

      const textarea = document.querySelector('textarea');
      if (textarea && (textarea as HTMLElement).offsetParent !== null) {
        return { found: true, type: 'textarea' as const };
      }

      return { found: false, type: 'none' as const };
    }).catch(() => ({ found: false, type: 'none' as const }));

    // 2. Detect Model Selector
    const currentModelText = await ModelSelector.detectCurrentModel(page);
    const modelSelectorFound = currentModelText !== null;

    // 3. Detect Ratio Selector
    const currentRatioText = await RatioSelector.detectCurrentRatio(page);
    const ratioSelectorFound = currentRatioText !== null;

    // 4. Detect Generate Button
    const generateBtnInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const generateBtn = buttons.find((b) => {
        const text = b.textContent || '';
        const ariaLabel = b.getAttribute('aria-label') || '';
        const isMatch =
          text.includes('arrow_forward') ||
          text.includes('Generate') ||
          text.includes('Créer') ||
          ariaLabel.toLowerCase().includes('generate') ||
          ariaLabel.toLowerCase().includes('créer');
        return isMatch && (b as HTMLElement).offsetParent !== null;
      });

      if (generateBtn) {
        const disabled =
          (generateBtn as HTMLButtonElement).disabled === true ||
          generateBtn.getAttribute('aria-disabled') === 'true' ||
          generateBtn.classList.contains('disabled');
        return {
          found: true,
          disabled,
          text: (generateBtn.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 40),
        };
      }

      return { found: false, disabled: true, text: null };
    }).catch(() => ({ found: false, disabled: true, text: null }));

    // 5. Detect interactive elements list
    const interactive = await FlowDriver.detectInteractiveElements(page);

    const result: FlowUIDiscoveryResult = {
      url,
      isProjectPage,
      projectId,
      promptInputFound: promptInfo.found,
      promptInputType: promptInfo.type,
      modelSelectorFound,
      currentModelText,
      ratioSelectorFound,
      currentRatioText,
      generateButtonFound: generateBtnInfo.found,
      generateButtonDisabled: generateBtnInfo.disabled,
      generateButtonText: generateBtnInfo.text,
      buttonCount: interactive.buttons.length,
      inputCount: interactive.inputs.length,
      interactiveButtons: interactive.buttons.slice(0, 50),
    };

    logger.info('ui_discovery', 'UI discovery completed', {
      isProjectPage,
      projectId,
      promptInput: result.promptInputType,
      model: result.currentModelText,
      ratio: result.currentRatioText,
      generateBtn: result.generateButtonFound,
    });

    return result;
  }
}
