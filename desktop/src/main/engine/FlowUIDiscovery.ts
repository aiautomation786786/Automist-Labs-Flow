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
import type { FlowUIDiscoveryResult, ProjectCreationDiscoveryResult } from '../../shared/types';
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

  /**
   * Discovers the project creation control on the Google Flow page using layered,
   * resilient fallback strategies without relying on a single brittle selector.
   */
  static async discoverProjectCreationControl(
    page: Page,
  ): Promise<ProjectCreationDiscoveryResult> {
    // Strategy 1: Known Flow Component Classes & Test IDs
    const knownClassSelectors = [
      'button.new-project-button',
      '[data-testid="new-project-button"]',
      'button.mat-mdc-extended-fab:has-text("New project")',
      'button.mat-mdc-fab:has-text("New project")',
      'flow-projects-page button.mdc-fab',
      'flow-projects-page button.new-project-button',
    ];

    for (const sel of knownClassSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          const text = (await loc.textContent().catch(() => '')) || '';
          const aria = (await loc.getAttribute('aria-label').catch(() => '')) || '';
          return {
            found: true,
            locator: loc,
            selectorStrategy: 'known_classes',
            elementDescription: `Selector: ${sel}`,
            accessibleName: aria,
            text: text.trim().replace(/\s+/g, ' '),
            tagName: 'button',
          };
        }
      } catch {}
    }

    // Strategy 2: Text Matching & Multilingual Equivalents
    const textMatchingSelectors = [
      'button:has-text("New project")',
      'button:has-text("Nouveau projet")',
      'button:has-text("Neues Projekt")',
      'button:has-text("Nuevo proyecto")',
      'button:has-text("Nuovo progetto")',
      'button:has-text("Novo projeto")',
      '[role="button"]:has-text("New project")',
      '[role="button"]:has-text("Nouveau projet")',
      'a:has-text("New project")',
      'a:has-text("Nouveau projet")',
      'button:has-text("Create with Google Flow")',
      'a:has-text("Create with Google Flow")',
      '[role="button"]:has-text("Create with Google Flow")',
      'button:has-text("Start creating")',
      'a:has-text("Start creating")',
    ];

    for (const sel of textMatchingSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          const text = (await loc.textContent().catch(() => '')) || '';
          const aria = (await loc.getAttribute('aria-label').catch(() => '')) || '';
          return {
            found: true,
            locator: loc,
            selectorStrategy: 'text_matching',
            elementDescription: `Selector: ${sel}`,
            accessibleName: aria,
            text: text.trim().replace(/\s+/g, ' '),
            tagName: 'button',
          };
        }
      } catch {}
    }

    // Strategy 3: ARIA Attributes & Accessible Names
    const ariaSelectors = [
      '[aria-label*="New project" i]',
      '[aria-label*="Nouveau projet" i]',
      '[aria-label*="Create project" i]',
      '[aria-label*="Create with Google Flow" i]',
      '[title*="New project" i]',
      '[title*="Create project" i]',
    ];

    for (const sel of ariaSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          const text = (await loc.textContent().catch(() => '')) || '';
          const aria = (await loc.getAttribute('aria-label').catch(() => '')) || '';
          return {
            found: true,
            locator: loc,
            selectorStrategy: 'aria_matching',
            elementDescription: `Selector: ${sel}`,
            accessibleName: aria,
            text: text.trim().replace(/\s+/g, ' '),
            tagName: 'button',
          };
        }
      } catch {}
    }

    // Strategy 4: Icon-based Project Creation on Dashboard
    const iconSelectors = [
      'button:has(mat-icon:has-text("add")):has-text("New project")',
      'button:has(.material-icons:has-text("add")):has-text("New project")',
      'button:has(svg):has-text("New project")',
      'flow-projects-page button:has(mat-icon:has-text("add"))',
      'flow-projects-page button:has(.material-icons:has-text("add"))',
    ];

    for (const sel of iconSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          const text = (await loc.textContent().catch(() => '')) || '';
          const aria = (await loc.getAttribute('aria-label').catch(() => '')) || '';
          return {
            found: true,
            locator: loc,
            selectorStrategy: 'icon_button',
            elementDescription: `Selector: ${sel}`,
            accessibleName: aria,
            text: text.trim().replace(/\s+/g, ' '),
            tagName: 'button',
          };
        }
      } catch {}
    }

    // Strategy 5: Deep DOM evaluation with negative filtering
    if (typeof page.evaluate === 'function') {
      const domResult = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
        const positiveKeywords = [
          'new project', 'nouveau projet', 'neues projekt', 'nuevo proyecto',
          'create with google flow', 'créer avec google flow', 'start creating'
        ];
        const negativeKeywords = [
          'create image', 'create video', 'create account', 'create template',
          'create custom tool', 'generate', 'export', 'download', 'upload',
          'select model', 'aspect ratio'
        ];

        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && (el as HTMLElement).offsetParent !== null;
          if (!visible) continue;

          const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
          if (disabled) continue;

          const text = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const title = (el.getAttribute('title') || '').trim().toLowerCase();

          // Reject negative matches
          const isNegative = negativeKeywords.some((nk) => text.includes(nk) || aria.includes(nk));
          if (isNegative) continue;

          // Check positive matches
          const matchesPositive = positiveKeywords.some((pk) => text.includes(pk) || aria.includes(pk) || title.includes(pk));
          if (matchesPositive) {
            return {
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().replace(/\s+/g, ' '),
              ariaLabel: el.getAttribute('aria-label') || '',
              className: el.className,
              id: el.id,
            };
          }
        }
        return null;
      }).catch(() => null);

      if (domResult) {
        const fallbackLocator = page.locator(`${domResult.tag}:has-text("${domResult.text}")`).first();
        return {
          found: true,
          locator: fallbackLocator,
          selectorStrategy: 'dom_deep_scan',
          elementDescription: `Element: <${domResult.tag} class="${domResult.className}">`,
          accessibleName: domResult.ariaLabel,
          text: domResult.text,
          tagName: domResult.tag,
        };
      }
    }

    return {
      found: false,
      reason: 'No project creation control detected across all 5 discovery tiers',
    };
  }
}
