/**
 * SafeDownloader – Non-navigating media downloader using Playwright's APIRequestContext.
 *
 * CRITICAL ARCHITECTURAL SAFETY RULE:
 *  The previous MCP implementation called `page.goto(trpcUrl)` which navigated the
 *  active browser tab away from the Google Flow project, destroying user context.
 *
 *  SafeDownloader executes downloads via `page.request.get(url)` (Playwright's
 *  in-context HTTP client). This shares the active profile's authenticated cookies
 *  and credentials, but does NOT touch or alter the page's DOM or URL navigation.
 *  The main Flow tab remains permanently on the project canvas.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import type { MediaDownloadResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { MediaDetector } from './MediaDetector';

const logger = new AppLogger({ mirrorToStderr: false });

export class SafeDownloader {
  /**
   * Downloads media using the authenticated browser session's HTTP client without
   * navigating the main page away from the project canvas.
   *
   * @param page             The active Playwright Page (provides request context)
   * @param mediaUrlOrUuid   Full TRPC URL or a UUID string
   * @param destinationPath  Absolute path to save the downloaded file
   * @param options          Timeout and header configuration
   */
  static async download(
    page: Page,
    mediaUrlOrUuid: string,
    destinationPath: string,
    options: { timeoutMs?: number } = {},
  ): Promise<MediaDownloadResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 30000;

    // Verify page state before download: record current URL
    const originalUrl = page.url();

    // Determine the full download URL
    const url = mediaUrlOrUuid.startsWith('http://') || mediaUrlOrUuid.startsWith('https://')
      ? mediaUrlOrUuid
      : MediaDetector.buildTrpcUrl(mediaUrlOrUuid);

    logger.info('safe_downloader', 'Starting background download', {
      url: url.substring(0, 100),
      destinationPath,
    });

    // Ensure target directory exists
    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    try {
      // Execute the request via the page's APIRequestContext (shares cookies, doesn't navigate)
      const response = await page.request.get(url, {
        timeout: timeoutMs,
        headers: {
          // Accept typical media types
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });

      if (!response.ok()) {
        throw new Error(
          `Download failed with HTTP ${response.status()}: ${response.statusText()} for URL: ${url}`
        );
      }

      const buffer = await response.body();

      if (buffer.length === 0) {
        throw new Error(`Download received empty (0 bytes) response body for URL: ${url}`);
      }

      // Write directly to disk
      fs.writeFileSync(destinationPath, buffer);

      const durationMs = Date.now() - startTime;

      // CRITICAL VERIFICATION: Confirm that the page URL was NOT modified by this download
      const postDownloadUrl = page.url();
      if (postDownloadUrl !== originalUrl) {
        logger.error('safe_downloader', 'CRITICAL VIOLATION: Page navigated during background download!', {
          originalUrl,
          postDownloadUrl,
        });
      }

      logger.info('safe_downloader', 'Background download succeeded', {
        destinationPath,
        bytes: buffer.length,
        durationMs,
      });

      return {
        downloadedFiles: [destinationPath],
        bytesDownloaded: buffer.length,
        destinationPath,
        durationMs,
      };
    } catch (err) {
      logger.error('safe_downloader', 'Background download error', err as Error);
      throw err;
    }
  }

  /**
   * Downloads multiple media assets into an output directory without navigating the page.
   */
  static async downloadBatch(
    page: Page,
    mediaUuids: string[],
    outputDir: string,
    filePrefix = 'flow_',
  ): Promise<MediaDownloadResult> {
    const startTime = Date.now();
    const downloadedFiles: string[] = [];
    let totalBytes = 0;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (let i = 0; i < mediaUuids.length; i++) {
      const uuid = mediaUuids[i]!;
      const filename = `${filePrefix}${uuid.substring(0, 8)}_${Date.now()}_${i + 1}.png`;
      const destPath = path.join(outputDir, filename);

      try {
        const result = await this.download(page, uuid, destPath);
        downloadedFiles.push(destPath);
        totalBytes += result.bytesDownloaded;
      } catch (err) {
        logger.warn('safe_downloader', `Failed to download UUID ${uuid}: ${(err as Error).message}`);
      }
    }

    return {
      downloadedFiles,
      bytesDownloaded: totalBytes,
      destinationPath: outputDir,
      durationMs: Date.now() - startTime,
    };
  }
}
