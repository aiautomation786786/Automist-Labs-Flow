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
export const FLOW_ASB_MEDIA_REGEX = /\/asb\/([a-zA-Z0-9_-]+)/;
export const GEMINI_MEDIA_REGEX = /(?:googleusercontent\.com|googlevideo\.com)\/(?:video\/)?([a-zA-Z0-9_-]+)/;

export interface RecoveryScanResult {
  found: boolean;
  videoUrl?: string;
  uuid?: string;
  isStillGenerating: boolean;
  candidateCount: number;
}

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
        continue;
      }
      const asbMatch = url.match(FLOW_ASB_MEDIA_REGEX);
      if (asbMatch?.[1]) {
        uuids.push(asbMatch[1]);
        matchedUrls.push(url);
        continue;
      }
      const geminiMatch = url.match(GEMINI_MEDIA_REGEX);
      if (geminiMatch?.[1]) {
        uuids.push(geminiMatch[1]);
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
          const src = video.src || (video as HTMLMediaElement).currentSrc || video.querySelector('source')?.src || video.getAttribute('src') || video.getAttribute('poster') || '';
          if (src) {
            videoSources.push(src);
          }
        });

        // 3. Scan Google Flow dedicated flow-video-tile custom elements
        const videoTiles = Array.from(document.querySelectorAll('flow-video-tile, [class*="video-tile"]'));
        videoTiles.forEach((tile) => {
          const tileVid = tile.querySelector('video');
          if (tileVid) {
            const s = tileVid.src || (tileVid as HTMLMediaElement).currentSrc || tileVid.getAttribute('src') || '';
            if (s && !videoSources.includes(s)) videoSources.push(s);
          }
          const tileImg = tile.querySelector('img');
          if (tileImg && tileImg.src) {
            if (tileImg.src.includes('/asb/')) {
              const vidUrl = tileImg.src.split('=')[0] + '=mm,22,15';
              if (!videoSources.includes(vidUrl)) videoSources.push(vidUrl);
            } else if (tileImg.src.includes('flow-content.google/image/') || tileImg.src.includes('flow-content.google/video/')) {
              if (!videoSources.includes(tileImg.src)) videoSources.push(tileImg.src);
            }
          }
        });

        return { imageSrcs, videoSources, hasVideo: videos.length > 0 || videoTiles.length > 0 };
      });

      const { uuids: imageUuids, matchedUrls: imageMatchedUrls } = this.parseMediaUuids(raw.imageSrcs);
      const { uuids: videoUuids, matchedUrls: videoMatchedUrls } = this.parseMediaUuids(raw.videoSources);

      logger.debug('media_detector', 'Media scan complete', {
        imagesFound: imageUuids.length,
        videosFound: raw.videoSources.length,
        videoUuidsFound: videoUuids.length,
      });

      return {
        imageUuids,
        mediaUrls: [...new Set([...imageMatchedUrls, ...videoMatchedUrls])],
        hasVideo: raw.hasVideo || raw.videoSources.length > 0,
        videoSources: raw.videoSources,
        videoUuids,
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
        videoUuids: [],
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

  /**
   * Polls the page until a newly generated video source or UUID is detected (delta from beforeUrls),
   * or the timeout expires.
   */
  static async waitForGeneratedVideo(
    page: Page,
    beforeUrls: Set<string>,
    timeoutMs = 180000,
    pollIntervalMs = 2500,
  ): Promise<{ videoUrl: string; uuid?: string } | null> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const result = await this.detectMedia(page);

      // Check for new video sources
      for (const src of result.videoSources) {
        if (!beforeUrls.has(src) && src.trim().length > 0) {
          const parsed = this.parseMediaUuids([src]);
          return { videoUrl: src, uuid: parsed.uuids[0] };
        }
      }

      // Check for new media URLs pointing to video
      for (const url of result.mediaUrls) {
        if (!beforeUrls.has(url) && (url.includes('/video/') || url.includes('.mp4'))) {
          const parsed = this.parseMediaUuids([url]);
          return { videoUrl: url, uuid: parsed.uuids[0] };
        }
      }

      await page.waitForTimeout(pollIntervalMs);
    }

    return null;
  }

  /**
   * Performs an aggressive, multi-strategy recovery scan across the Google Flow interface.
   * Examines DOM video elements, tiles, stream sources, and download buttons to recover
   * completed video media even after the primary polling window has timed out.
   */
  static async detectRecoveryVideo(
    page: Page,
    beforeUrls: Set<string> = new Set(),
  ): Promise<RecoveryScanResult> {
    try {
      const scan = await page.evaluate((beforeList) => {
        const bSet = new Set(beforeList);
        const candidates: string[] = [];

        // Check if any progress bar / spinner is still animating
        const isStillGenerating = document.querySelector(
          '.progress-bar, flow-video-tile .generating, mat-spinner, [aria-label*="generating" i]'
        ) !== null;

        // Strategy 1: Check all Flow video tiles in reverse DOM order (newest first)
        const tiles = Array.from(document.querySelectorAll('flow-video-tile, [class*="video-tile"]'));
        for (let i = tiles.length - 1; i >= 0; i--) {
          const tile = tiles[i]!;
          const vid = tile.querySelector('video');
          const vidSrc = vid?.src || (vid as HTMLMediaElement)?.currentSrc || vid?.getAttribute('src');
          if (vidSrc && !bSet.has(vidSrc) && (vidSrc.startsWith('http') || vidSrc.startsWith('blob:'))) {
            candidates.push(vidSrc);
          }

          const img = tile.querySelector('img.thumbnail, img[src*="/asb/"], img[src*="flow-content.google"]') as HTMLImageElement | null;
          if (img && img.src) {
            if (img.src.includes('/asb/')) {
              const streamUrl = img.src.split('=')[0] + '=mm,22,15';
              if (!bSet.has(streamUrl)) candidates.push(streamUrl);
            } else if (img.src.includes('flow-content.google/video')) {
              if (!bSet.has(img.src)) candidates.push(img.src);
            }
          }

          // Check download anchors inside tile
          const dl = tile.querySelector('a[href*=".mp4"], a[download], a[aria-label*="download" i]') as HTMLAnchorElement | null;
          if (dl && dl.href && !bSet.has(dl.href)) {
            candidates.push(dl.href);
          }
        }

        // Strategy 2: All <video> elements on page
        const allVideos = Array.from(document.querySelectorAll('video'));
        for (let i = allVideos.length - 1; i >= 0; i--) {
          const v = allVideos[i]!;
          const src = v.currentSrc || v.src || v.getAttribute('src');
          if (src && !bSet.has(src) && (src.startsWith('http') || src.startsWith('blob:'))) {
            candidates.push(src);
          }
        }

        return {
          candidates: Array.from(new Set(candidates)),
          isStillGenerating,
        };
      }, Array.from(beforeUrls));

      if (scan.candidates.length > 0) {
        const chosenUrl = scan.candidates[0]!;
        const parsed = this.parseMediaUuids([chosenUrl]);
        return {
          found: true,
          videoUrl: chosenUrl,
          uuid: parsed.uuids[0],
          isStillGenerating: scan.isStillGenerating,
          candidateCount: scan.candidates.length,
        };
      }

      return {
        found: false,
        isStillGenerating: scan.isStillGenerating,
        candidateCount: 0,
      };
    } catch (err) {
      logger.warn('media_detector', `Recovery scan error: ${(err as Error).message}`);
      return {
        found: false,
        isStillGenerating: false,
        candidateCount: 0,
      };
    }
  }
}
