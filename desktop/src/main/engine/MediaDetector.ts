/**
 * MediaDetector – Isolates Google Flow generated media detection logic.
 *
 * Responsibilities:
 *  - Extracting generated image UUIDs from DOM image src attributes using the TRPC redirect pattern
 *  - Detecting video playback elements and video stream URLs
 *  - Returning structured MediaDetectionResult without depending on any global state
 */

import type { Page } from 'playwright';
import type { MediaDetectionResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

/**
 * The canonical regex matching Google Flow TRPC image redirect URLs.
 * Extracts the UUID of the generated asset from the query parameter `name=...`.
 * Example:
 *   "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=12345678-abcd-1234-abcd-1234567890ab"
 *   -> match[1] = "12345678-abcd-1234-abcd-1234567890ab"
 */
export const TRPC_IMAGE_REDIRECT_REGEX = /media\.getMediaUrlRedirect\?name=([a-zA-Z0-9_-]+)/;
export const FLOW_CONTENT_MEDIA_REGEX = /flow-content\.google\/(?:image|video)\/([a-zA-Z0-9_-]+)/;

export class MediaDetector {
  /**
   * Extracts all unique media UUIDs and full URLs from an array of URL strings.
   * Useful for testing and parsing extracted sources.
   */
  static parseMediaUuids(urls: string[]): { uuids: string[]; matchedUrls: string[] } {
    const uuids: string[] = [];
    const matchedUrls: string[] = [];

    for (const url of urls) {
      const trpcMatch = url.match(TRPC_IMAGE_REDIRECT_REGEX);
      if (trpcMatch?.[1]) {
        uuids.push(trpcMatch[1]);
        matchedUrls.push(url);
        continue;
      }
      const flowContentMatch = url.match(FLOW_CONTENT_MEDIA_REGEX);
      if (flowContentMatch?.[1]) {
        uuids.push(flowContentMatch[1]);
        matchedUrls.push(url);
      }
    }

    return {
      uuids: [...new Set(uuids)],
      matchedUrls: [...new Set(matchedUrls)],
    };
  }

  /**
   * Constructs the full TRPC download URL for a given media UUID.
   */
  static buildTrpcUrl(uuid: string, baseUrl = 'https://labs.google/fx/api/trpc'): string {
    return `${baseUrl}/media.getMediaUrlRedirect?name=${uuid}`;
  }

  /**
   * Inspects the live Flow page and detects all generated images and video elements.
   * Filters out UI icons (width <= 64px) to ensure only generated content cards are captured.
   */
  static async detectMedia(page: Page): Promise<MediaDetectionResult> {
    try {
      const raw = await page.evaluate(() => {
        const imageSrcs: string[] = [];
        const videoSources: string[] = [];

        // 1. Scan images
        const imgs = Array.from(document.querySelectorAll('img'));
        imgs.forEach((img) => {
          const src = img.src || img.getAttribute('data-src') || '';
          // Filter out tiny UI icons and thumbnails
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          if (src && (width > 64 || height > 64 || width === 0)) {
            imageSrcs.push(src);
          }
        });

        // 2. Scan video elements
        const videos = Array.from(document.querySelectorAll('video'));
        videos.forEach((video) => {
          const src = video.src || video.querySelector('source')?.src || video.getAttribute('poster') || '';
          if (src) {
            videoSources.push(src);
          }
        });

        return { imageSrcs, videoSources, hasVideo: videos.length > 0 };
      });

      const { uuids, matchedUrls } = this.parseMediaUuids(raw.imageSrcs);

      logger.debug('media_detector', 'Media scan complete', {
        imagesFound: uuids.length,
        videosFound: raw.videoSources.length,
      });

      return {
        imageUuids: uuids,
        mediaUrls: matchedUrls,
        hasVideo: raw.hasVideo,
        videoSources: raw.videoSources,
      };
    } catch (err) {
      logger.warn('media_detector', 'Failed to inspect media on page', {
        error: (err as Error).message,
      });
      return {
        imageUuids: [],
        mediaUrls: [],
        hasVideo: false,
        videoSources: [],
      };
    }
  }

  /**
   * Polls the page until at least one generated image UUID is detected,
   * or the timeout expires.
   */
  static async waitForGeneratedImages(
    page: Page,
    timeoutMs = 60000,
    pollIntervalMs = 2000,
  ): Promise<string[]> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const result = await this.detectMedia(page);
      if (result.imageUuids.length > 0) {
        return result.imageUuids;
      }
      await page.waitForTimeout(pollIntervalMs);
    }

    return [];
  }
}
