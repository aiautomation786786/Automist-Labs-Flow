/**
 * GeminiUIDiscovery – Semantic, resilient DOM discovery for Gemini Web Video Generation.
 *
 * Implements layered semantic discovery based on live reconnaissance (gemini_video_integration_analysis.md):
 *  - Modal dismissals ("Try it" onboarding, "Agree" image consent)
 *  - Video Mode verification (pill detection and tool activation)
 *  - Aspect Ratio queries and option selection (16:9 and 9:16 only)
 *  - Quill rich-text prompt editor discovery and verification
 *  - File upload and attachment preview tracking
 *  - Protected Send button state queries
 *  - Response video container & media element location
 *  - Text-based safety and quota error classification
 *
 * ZERO dependence on unstable Angular generated classes.
 */

import type { Page, Locator } from 'playwright';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export const GEMINI_VIDEOS_URL = 'https://gemini.google.com/videos';
export const GEMINI_APP_URL = 'https://gemini.google.com/app';

export class GeminiUIDiscovery {
  // ---------------------------------------------------------------------------
  // Modal & Overlay Dismissal
  // ---------------------------------------------------------------------------

  /**
   * Attempts to dismiss any blocking modal dialogs (onboarding or consent).
   * Safe to call repeatedly; returns true if an overlay was dismissed.
   */
  static async dismissKnownModals(page: Page): Promise<boolean> {
    let dismissed = false;

    // 1. Welcome / Onboarding dialog: "Create videos With Gemini Omni" -> "Try it"
    try {
      const tryItButton = page.locator('button:has-text("Try it"), .cdk-overlay-pane button:has-text("Try it")').first();
      if (await tryItButton.isVisible({ timeout: 400 }).catch(() => false)) {
        logger.info('gemini_discovery', 'Dismissing Gemini Omni welcome dialog via "Try it" button');
        await tryItButton.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
        dismissed = true;
      }
    } catch {
      // Ignored
    }

    // 2. Image / File consent modal: "Creating content from images and files" -> "Agree"
    try {
      const agreeButton = page.locator('.cdk-overlay-pane button:has-text("Agree"), button:has-text("Agree")').first();
      if (await agreeButton.isVisible({ timeout: 400 }).catch(() => false)) {
        logger.info('gemini_discovery', 'Accepting image policy consent modal via "Agree" button');
        await agreeButton.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
        dismissed = true;
      }
    } catch {
      // Ignored
    }

    // 3. Generic acknowledgement buttons (Got it, Dismiss, Close)
    try {
      const genericDismiss = page.locator('.cdk-overlay-pane button:has-text("Got it"), .cdk-overlay-pane button:has-text("Dismiss")').first();
      if (await genericDismiss.isVisible({ timeout: 300 }).catch(() => false)) {
        await genericDismiss.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(200);
        dismissed = true;
      }
    } catch {
      // Ignored
    }

    return dismissed;
  }

  // ---------------------------------------------------------------------------
  // Video Mode State
  // ---------------------------------------------------------------------------

  /**
   * Checks if Video Mode is currently active in the input toolbar.
   */
  static async isVideoModeActive(page: Page): Promise<boolean> {
    const candidates = [
      'button[aria-label="Deselect Videos"]',
      'button.mat-tonal-button:has-text("Videos")',
      'button:has-text("Videos")[aria-label*="Deselect" i]',
    ];

    for (const sel of candidates) {
      try {
        const locator = page.locator(sel).first();
        if (await locator.isVisible({ timeout: 300 }).catch(() => false)) {
          return true;
        }
      } catch {
        // Continue to next candidate
      }
    }

    // Also check placeholder text in prompt editor
    try {
      const editor = page.locator('div.ql-editor[data-placeholder*="video" i]').first();
      if (await editor.isVisible({ timeout: 300 }).catch(() => false)) {
        return true;
      }
    } catch {
      // Ignored
    }

    return false;
  }

  /**
   * Locates the prompt editor element.
   */
  static getPromptEditor(page: Page): Locator {
    const candidates = [
      'div.ql-editor[data-placeholder="Describe your video"]',
      'div.ql-editor[data-placeholder*="video" i]',
      'div.ql-editor[aria-label="Enter a prompt for Gemini"]',
      'div.ql-editor[role="textbox"]',
      'div[contenteditable="true"].ql-editor',
      'div[contenteditable="true"]',
    ];

    return page.locator(candidates.join(', ')).first();
  }

  // ---------------------------------------------------------------------------
  // Aspect Ratio Controls (16:9 and 9:16 ONLY - NO 4K)
  // ---------------------------------------------------------------------------

  /**
   * Locates the Aspect Ratio trigger button in the video toolbar.
   */
  static getAspectRatioTrigger(page: Page): Locator {
    const candidates = [
      'button[aria-label^="Aspect ratio"]',
      'button:has-text("Landscape (16:9)")',
      'button:has-text("Portrait (9:16)")',
      'button[aria-label*="Aspect ratio" i]',
    ];
    return page.locator(candidates.join(', ')).first();
  }

  /**
   * Reads current aspect ratio displayed on the button.
   */
  static async getCurrentAspectRatio(page: Page): Promise<'16:9' | '9:16' | null> {
    try {
      const trigger = this.getAspectRatioTrigger(page);
      if (!(await trigger.isVisible({ timeout: 1000 }).catch(() => false))) {
        return null;
      }

      const ariaLabel = (await trigger.getAttribute('aria-label').catch(() => '')) || '';
      const text = (await trigger.innerText().catch(() => '')) || '';
      const combined = `${ariaLabel} ${text}`;

      if (combined.includes('9:16') || combined.toLowerCase().includes('portrait')) {
        return '9:16';
      }
      if (combined.includes('16:9') || combined.toLowerCase().includes('landscape')) {
        return '16:9';
      }
    } catch {
      // Ignored
    }
    return null;
  }

  /**
   * Locates the dropdown menu item for the requested ratio.
   */
  static getAspectRatioMenuItem(page: Page, ratio: '16:9' | '9:16'): Locator {
    if (ratio === '9:16') {
      return page.locator(
        'input-companion-item:has-text("Portrait (9:16)"), [role="menuitem"]:has-text("Portrait (9:16)"), button:has-text("Portrait (9:16)")'
      ).first();
    }
    return page.locator(
      'input-companion-item:has-text("Landscape (16:9)"), [role="menuitem"]:has-text("Landscape (16:9)"), button:has-text("Landscape (16:9)")'
    ).first();
  }

  // ---------------------------------------------------------------------------
  // File Upload & Attachment Controls
  // ---------------------------------------------------------------------------

  /**
   * Locates the file upload button in the video toolbar.
   */
  static getFileUploadButton(page: Page): Locator {
    const candidates = [
      'button[aria-label="File upload"]',
      '[xapfileselectortrigger] button',
      'button[xapfileselectortrigger]',
      'button:has(mat-icon[data-mat-icon-name="upload_file"])',
      'button[aria-label*="File upload" i]',
    ];
    return page.locator(candidates.join(', ')).first();
  }

  /**
   * Checks if an image attachment preview is currently visible in the input area.
   */
  static async hasAttachmentPreview(page: Page): Promise<boolean> {
    const candidates = [
      '.attachment-preview-wrapper',
      'uploader-file-preview',
      'gem-style-attachment',
      'mat-basic-chip:has(img)',
    ];

    for (const sel of candidates) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
          return true;
        }
      } catch {
        // Ignored
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Submission Controls
  // ---------------------------------------------------------------------------

  /**
   * Locates the Send / Generate message button.
   */
  static getSendButton(page: Page): Locator {
    const candidates = [
      'button[aria-label="Send message"]',
      'button.send-button',
      'button:has(mat-icon[data-mat-icon-name="send"])',
    ];
    return page.locator(candidates.join(', ')).first();
  }

  /**
   * Checks if the Send button is present and not disabled.
   */
  static async isSendButtonReady(page: Page): Promise<boolean> {
    try {
      const sendBtn = this.getSendButton(page);
      if (!(await sendBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
        return false;
      }
      const isDisabled = await sendBtn.getAttribute('disabled').catch(() => null);
      const ariaDisabled = await sendBtn.getAttribute('aria-disabled').catch(() => null);
      return isDisabled === null && ariaDisabled !== 'true';
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Generation Progress & Media Output
  // ---------------------------------------------------------------------------

  /**
   * Checks if generation is currently actively in progress (spinner or Stop button).
   */
  static async isGenerating(page: Page): Promise<boolean> {
    try {
      const stopBtn = page.locator('button[aria-label="Stop generation"]').first();
      if (await stopBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        return true;
      }
      const spinner = page.locator('mat-progress-spinner, .generating-state, .pending-response').first();
      if (await spinner.isVisible({ timeout: 300 }).catch(() => false)) {
        return true;
      }
    } catch {
      // Ignored
    }
    return false;
  }

  /**
   * Scans for generated video elements inside the chat stream.
   * Returns the newest video element handle if found.
   */
  static async findLatestVideoElement(page: Page): Promise<import('playwright').ElementHandle | null> {
    return await page.evaluateHandle(() => {
      const videos = Array.from(document.querySelectorAll('message-content video, model-response video, generated-video-container video, video'));
      if (videos.length === 0) return null;
      // Return the last video element rendered in the document
      return videos[videos.length - 1];
    }).then((handle) => handle.asElement());
  }

  /**
   * Scans response turns for safety violation refusal text.
   */
  static async detectSafetyRefusal(page: Page): Promise<string | null> {
    try {
      const text = await page.evaluate(() => {
        const responses = Array.from(document.querySelectorAll('message-content, model-response'));
        if (responses.length === 0) return '';
        const lastResponse = responses[responses.length - 1];
        return lastResponse?.textContent || '';
      });

      if (!text) return null;

      const safetyPatterns = [
        /violates? (our|the) safety (guidelines|policies)/i,
        /can't (create|generate) that video/i,
        /unable to generate (a|this) video/i,
        /against our content policy/i,
        /explicit content/i,
      ];

      for (const pattern of safetyPatterns) {
        if (pattern.test(text)) {
          return text.trim();
        }
      }
    } catch {
      // Ignored
    }
    return null;
  }

  /**
   * Scans response turns for quota exhaustion messages.
   */
  static async detectQuotaExhaustion(page: Page): Promise<string | null> {
    try {
      const text = await page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        return bodyText;
      });

      if (!text) return null;

      const quotaPatterns = [
        /reached your (daily )?video generation limit/i,
        /reached your limit/i,
        /try again tomorrow/i,
        /generation limit reached/i,
        /too many requests/i,
      ];

      for (const pattern of quotaPatterns) {
        if (pattern.test(text)) {
          return 'Daily video generation limit reached on Gemini.';
        }
      }
    } catch {
      // Ignored
    }
    return null;
  }
}
