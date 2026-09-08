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

      const rawHeaders = typeof response.headers === 'function' ? response.headers() : ((response as any).headers || {});
      const headerContentType = (rawHeaders as Record<string, string>)['content-type'] || '';
      const detection = SafeDownloader.detectImageMime(buffer, headerContentType);

      let finalPath = destinationPath;
      const currentExt = path.extname(destinationPath).toLowerCase();
      if (detection.isValid && detection.extension && currentExt !== detection.extension) {
        const basePath = destinationPath.slice(0, destinationPath.length - currentExt.length);
        finalPath = `${basePath}${detection.extension}`;
      }

      // Write directly to disk
      fs.writeFileSync(finalPath, buffer);

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
        destinationPath: finalPath,
        bytes: buffer.length,
        mimeType: detection.mimeType,
        isValidImage: detection.isValid,
        durationMs,
      });

      return {
        downloadedFiles: [finalPath],
        bytesDownloaded: buffer.length,
        destinationPath: finalPath,
        durationMs,
        mimeType: detection.mimeType,
        isValidImage: detection.isValid,
      };
    } catch (err) {
      logger.error('safe_downloader', 'Background download error', err as Error);
      throw err;
    }
  }

  /**
   * Detects the real image MIME type from binary magic bytes and optional Content-Type header.
   * Supports PNG, JPEG, WebP, GIF, AVIF, BMP, and SVG.
   */
  static detectImageMime(
    buffer: Buffer,
    headerContentType = '',
  ): { mimeType: string; extension: string; isValid: boolean } {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { mimeType: 'image/png', extension: '.png', isValid: true };
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: 'image/jpeg', extension: '.jpg', isValid: true };
    }
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { mimeType: 'image/webp', extension: '.webp', isValid: true };
    }
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') {
      return { mimeType: 'image/gif', extension: '.gif', isValid: true };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12).toLowerCase();
      if (brand.startsWith('mp4') || brand.startsWith('iso') || brand.startsWith('m4v')) {
        return { mimeType: 'video/mp4', extension: '.mp4', isValid: true };
      }
      return { mimeType: 'image/avif', extension: '.avif', isValid: true };
    }
    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return { mimeType: 'image/bmp', extension: '.bmp', isValid: true };
    }

    // Inspect Content-Type header as fallback
    if (headerContentType) {
      const cleanHeader = headerContentType.split(';')[0]?.trim().toLowerCase() ?? '';
      if (cleanHeader.startsWith('image/')) {
        let ext = '.png';
        if (cleanHeader === 'image/jpeg') ext = '.jpg';
        else if (cleanHeader === 'image/webp') ext = '.webp';
        else if (cleanHeader === 'image/gif') ext = '.gif';
        else if (cleanHeader === 'image/avif') ext = '.avif';
        return { mimeType: cleanHeader, extension: ext, isValid: true };
      }
      if (cleanHeader.startsWith('video/')) {
        let ext = '.mp4';
        if (cleanHeader === 'video/webm') ext = '.webm';
        return { mimeType: cleanHeader, extension: ext, isValid: true };
      }
    }

    return { mimeType: 'application/octet-stream', extension: '.bin', isValid: false };
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
