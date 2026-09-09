/**
 * GeminiDriver – High-level Playwright driver for Google Gemini Web Video Generation.
 *
 * Implements:
 *  - Direct navigation to https://gemini.google.com/videos
 *  - Modal handling ("Try it" onboarding, "Agree" consent)
 *  - Video Mode activation and verification
 *  - Aspect ratio selection (Landscape 16:9 and Portrait 9:16 ONLY - NO 4K)
 *  - Single & bulk image attachments via Playwright filechooser interception
 *  - Quill rich-text prompt injection and read-back verification
 *  - Protected single-click submission
 *  - Multi-strategy media detection (in-stream video element, Google CDN URL)
 *  - Non-navigating SafeDownloader fetch with in-UI download fallback
 *  - Strict slot and page isolation: each job gets its own dedicated Page
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import { GeminiUIDiscovery, GEMINI_VIDEOS_URL } from './GeminiUIDiscovery';
import { SafeDownloader } from './SafeDownloader';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface VideoCompletionResult {
  videoUrl: string;
  durationSeconds?: number;
}

export class GeminiDriver {
  /**
   * Ensures the page is in the active Gemini Video Studio mode.
   */
  static async ensureVideoMode(page: Page, timeoutMs = 30000): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    const currentUrl = page.url();

    // 1. Navigate directly to /videos if not already on it
    if (!currentUrl.includes('/videos')) {
      logger.info('gemini_driver', `Navigating to Gemini Videos route: ${GEMINI_VIDEOS_URL}`);
      await page.goto(GEMINI_VIDEOS_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForTimeout(1000);
    }

    // 2. Dismiss onboarding modals if present
    await GeminiUIDiscovery.dismissKnownModals(page);

    // 3. Confirm Video Mode is active
    let isVideoActive = await GeminiUIDiscovery.isVideoModeActive(page);
    if (!isVideoActive) {
      logger.info('gemini_driver', 'Video pill not found; opening tools menu to activate Video mode');
      const toolButton = page.locator('button[aria-label="Upload and tools"]').first();
      if (await toolButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await toolButton.click().catch(() => {});
        await page.waitForTimeout(400);

        const createVideoItem = page.locator('input-companion-item:has-text("Create video"), button:has-text("Create video")').first();
        if (await createVideoItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await createVideoItem.click().catch(() => {});
          await page.waitForTimeout(800);
        }
      }

      await GeminiUIDiscovery.dismissKnownModals(page);
      isVideoActive = await GeminiUIDiscovery.isVideoModeActive(page);
    }

    if (!isVideoActive) {
      logger.warn('gemini_driver', 'Warning: Video mode indicator not explicitly confirmed; proceeding with caution');
    }
  }

  /**
   * Configures the requested aspect ratio (16:9 or 9:16).
   */
  static async ensureAspectRatio(page: Page, targetRatio: '16:9' | '9:16'): Promise<void> {
    await page.bringToFront?.().catch(() => {});
    // 1. Detect current ratio
    const currentRatio = await GeminiUIDiscovery.getCurrentAspectRatio(page);
    if (currentRatio === targetRatio) {
      logger.info('gemini_driver', `Aspect ratio is already ${targetRatio}; no change needed`);
      return;
    }

    logger.info('gemini_driver', `Switching aspect ratio from ${currentRatio || 'unknown'} to ${targetRatio}`);

    // 2. Click trigger button to open menu
    const trigger = GeminiUIDiscovery.getAspectRatioTrigger(page);
    if (!(await trigger.isVisible({ timeout: 3000 }).catch(() => false))) {
      throw new Error('Aspect ratio button not found on Gemini video interface.');
    }

    await trigger.click();
    await page.waitForTimeout(400);

    // 3. Click menu item for target ratio
    const menuItem = GeminiUIDiscovery.getAspectRatioMenuItem(page, targetRatio);
    if (!(await menuItem.isVisible({ timeout: 3000 }).catch(() => false))) {
      throw new Error(`Aspect ratio option "${targetRatio}" not found in dropdown.`);
    }

    await menuItem.click();
    await page.waitForTimeout(400);

    // 4. Verify post-selection state
    const verifiedRatio = await GeminiUIDiscovery.getCurrentAspectRatio(page);
    if (verifiedRatio && verifiedRatio !== targetRatio) {
      throw new Error(`Failed to verify aspect ratio: expected ${targetRatio}, got ${verifiedRatio}`);
    }
  }

  /**
   * Attaches a reference image for Image-to-Video generation using filechooser interception.
   */
  static async attachSourceImage(page: Page, sourceImagePath: string): Promise<void> {
    await page.bringToFront?.().catch(() => {});
    if (!fs.existsSync(sourceImagePath)) {
      throw new Error(`Source image file does not exist on disk: ${sourceImagePath}`);
    }

    const uploadBtn = GeminiUIDiscovery.getFileUploadButton(page);
    if (!(await uploadBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      throw new Error('File upload button not found in Gemini Video input area.');
    }

    logger.info('gemini_driver', `Interception filechooser to attach: ${sourceImagePath}`);

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      uploadBtn.click(),
    ]);

    await fileChooser.setFiles(sourceImagePath);
    await page.waitForTimeout(1000);

    // Dismiss consent modal if displayed
    await GeminiUIDiscovery.dismissKnownModals(page);

    // Wait for attachment preview thumbnail to confirm image is staged
    const hasPreview = await page.waitForFunction(() => {
      const el = document.querySelector('.attachment-preview-wrapper, uploader-file-preview, gem-style-attachment');
      return !!el && !el.querySelector('mat-progress-spinner');
    }, { timeout: 15000 }).then(() => true).catch(() => false);

    if (!hasPreview) {
      const fallbackCheck = await GeminiUIDiscovery.hasAttachmentPreview(page);
      if (!fallbackCheck) {
        throw new Error('Source image attachment failed: preview thumbnail was not rendered.');
      }
    }

    logger.info('gemini_driver', 'Source image attachment verified successfully');
  }

  /**
   * Injects prompt text into the Quill editor and verifies it via read-back.
   */
  static async injectPrompt(page: Page, promptText: string): Promise<void> {
    await page.bringToFront?.().catch(() => {});
    const editor = GeminiUIDiscovery.getPromptEditor(page);
    if (!(await editor.isVisible({ timeout: 5000 }).catch(() => false))) {
      throw new Error('Gemini prompt input editor not found.');
    }

    await editor.focus();
    await page.waitForTimeout(200);

    // Inject text into Quill editor and dispatch events
    await page.evaluate((text) => {
      const el = document.querySelector('div.ql-editor[data-placeholder*="video" i], div.ql-editor') as HTMLElement;
      if (el) {
        el.focus();
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, promptText);

    // Press a safe key (Space + Backspace) to ensure Quill internal model registers changes
    await page.keyboard.press('Space');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);

    // Read back content to verify
    const currentText = await editor.innerText().catch(() => '');
    if (!currentText.trim() && promptText.trim()) {
      // Fallback: use Playwright type
      await editor.fill(promptText);
      await page.waitForTimeout(300);
    }

    // Wait for Send button to become enabled
    const ready = await page.waitForFunction(() => {
      const btn = document.querySelector('button[aria-label="Send message"], button.send-button') as HTMLButtonElement;
      return !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
    }, { timeout: 8000 }).then(() => true).catch(() => false);

    if (!ready) {
      const isReadyNow = await GeminiUIDiscovery.isSendButtonReady(page);
      if (!isReadyNow) {
        throw new Error('Prompt injected but Send button remains disabled or not ready.');
      }
    }

    logger.info('gemini_driver', `Prompt injected and Send button verified ready for submission`);
  }

  /**
   * Submits generation with single-click safety protection.
   */
  static async submitGeneration(page: Page): Promise<void> {
    await page.bringToFront?.().catch(() => {});
    const sendBtn = GeminiUIDiscovery.getSendButton(page);

    if (!(await sendBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      throw new Error('Send button not visible for submission.');
    }

    logger.info('gemini_driver', 'Triggering single protected click on Send button...');
    await sendBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Verify submission started
    const started = await page.waitForFunction(() => {
      const hasStop = !!document.querySelector('button[aria-label="Stop generation"]');
      const hasUserQuery = !!document.querySelector('user-query, .user-query-container');
      const editor = document.querySelector('div.ql-editor') as HTMLElement;
      const editorCleared = editor ? !editor.innerText.trim() : false;
      return hasStop || hasUserQuery || editorCleared;
    }, { timeout: 10000 }).then(() => true).catch(() => false);

    if (!started) {
      throw new Error('Failed to confirm generation submission on Gemini: input editor was not cleared and no response container appeared.');
    }

    logger.info('gemini_driver', 'Generation submission confirmed active on Gemini backend');

    // Dismiss any post-submission consent prompt
    await GeminiUIDiscovery.dismissKnownModals(page);
  }

  /**
   * Polls for completion of the generated video.
   */
  static async waitForVideoCompletion(
    page: Page,
    options: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      onProgress?: (message: string, percent: number) => void;
    } = {},
  ): Promise<VideoCompletionResult> {
    const timeoutMs = options.timeoutMs ?? 360000; // 6 minutes
    const pollInterval = options.pollIntervalMs ?? 1000;
    const startTime = Date.now();

    logger.info('gemini_driver', `Waiting for video generation completion (timeout: ${timeoutMs / 1000}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      // 1. Check for safety violation refusal
      const safetyError = await GeminiUIDiscovery.detectSafetyRefusal(page);
      if (safetyError) {
        throw new Error(`SAFETY_BLOCK: ${safetyError}`);
      }

      // 2. Check for quota limits
      const quotaError = await GeminiUIDiscovery.detectQuotaExhaustion(page);
      if (quotaError) {
        throw new Error(`QUOTA_EXHAUSTED: ${quotaError}`);
      }

      // 3. Check for user-stopped or generation-failed messages
      const failureText = await GeminiUIDiscovery.detectGenerationFailure(page);
      if (failureText) {
        throw new Error(`GENERATION_FAILED: ${failureText}`);
      }

      // 3. Check for generated video element
      const videoHandle = await GeminiUIDiscovery.findLatestVideoElement(page);
      if (videoHandle) {
        const videoData = await videoHandle.evaluate((vid: HTMLVideoElement) => {
          const src = vid.currentSrc || vid.src || vid.getAttribute('src') || '';
          const duration = vid.duration || 0;
          const ready = vid.readyState;
          return { src, duration, ready };
        });

        if (videoData.src && (videoData.src.startsWith('http') || videoData.src.startsWith('blob:'))) {
          logger.info('gemini_driver', `Detected generated video with valid source URL`, {
            src: videoData.src.substring(0, 100),
            duration: videoData.duration,
          });
          return {
            videoUrl: videoData.src,
            durationSeconds: videoData.duration > 0 ? videoData.duration : undefined,
          };
        }
      }

      // Progress reporting
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      const estimatedPercent = Math.min(95, Math.floor(15 + (elapsedSec / 120) * 80));
      if (options.onProgress) {
        options.onProgress(`Gemini Omni generating video... (${elapsedSec}s elapsed)`, estimatedPercent);
      }

      // Keep background tab alive by triggering DOM query
      await page.evaluate(() => document.title).catch(() => {});
      await page.waitForTimeout(pollInterval);
    }

    throw new Error(`Video generation timed out after ${timeoutMs / 1000} seconds without producing an output.`);
  }

  /**
   * Downloads the completed video file safely without page navigation.
   */
  static async downloadVideo(
    page: Page,
    videoUrl: string,
    destinationPath: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{ sizeBytes: number; isValid: boolean }> {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    // Method 0: In-browser blob fetch if URL is a blob: URL
    if (videoUrl.startsWith('blob:')) {
      try {
        logger.info('gemini_driver', `Fetching blob video via in-browser fetch: ${videoUrl}`);
        const base64Data = await page.evaluate(async (url) => {
          const resp = await fetch(url);
          const blob = await resp.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = reader.result as string;
              const commaIdx = res.indexOf(',');
              resolve(commaIdx >= 0 ? res.substring(commaIdx + 1) : res);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }, videoUrl);

        if (base64Data && base64Data.length > 50000) {
          fs.writeFileSync(destinationPath, Buffer.from(base64Data, 'base64'));
          const stats = fs.statSync(destinationPath);
          if (stats.size > 50000) {
            logger.info('gemini_driver', `Saved blob video (${stats.size} bytes) to: ${destinationPath}`);
            return { sizeBytes: stats.size, isValid: true };
          }
        }
      } catch (blobErr) {
        logger.warn('gemini_driver', `Blob fetch failed: ${(blobErr as Error).message}; trying fallbacks`);
      }
    }

    // Method 1: In-context fetch via SafeDownloader (for http/https)
    if (videoUrl.startsWith('http')) {
      try {
        logger.info('gemini_driver', `Downloading video directly via SafeDownloader: ${destinationPath}`);
        const downloadResult = await SafeDownloader.download(page, videoUrl, destinationPath, options);
        if (downloadResult.bytesDownloaded > 50000) {
          return { sizeBytes: downloadResult.bytesDownloaded, isValid: true };
        }
      } catch (directErr) {
        logger.warn('gemini_driver', `Direct download failed: ${(directErr as Error).message}; trying UI download button fallback`);
      }
    }

    // Method 2: Click in-UI download button as fallback
    try {
      const downloadBtn = page.locator('button[aria-label*="Download" i], a[aria-label*="Download" i]').last();
      if (await downloadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15000 }),
          downloadBtn.click(),
        ]);
        await download.saveAs(destinationPath);
        const stats = fs.statSync(destinationPath);
        if (stats.size > 50000) {
          logger.info('gemini_driver', `Downloaded video via UI download button (${stats.size} bytes)`);
          return { sizeBytes: stats.size, isValid: true };
        }
      }
    } catch (uiErr) {
      logger.warn('gemini_driver', `UI button download fallback failed: ${(uiErr as Error).message}`);
    }

    // Check if file exists and has valid size
    if (fs.existsSync(destinationPath)) {
      const stats = fs.statSync(destinationPath);
      if (stats.size > 50000) {
        return { sizeBytes: stats.size, isValid: true };
      }
    }

    throw new Error(`Failed to download valid video file to: ${destinationPath}`);
  }
}
