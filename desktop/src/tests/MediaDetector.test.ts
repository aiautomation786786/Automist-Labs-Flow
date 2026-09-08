/**
 * Tests for MediaDetector.
 *
 * Verifies TRPC image redirect URL parsing, regex isolation, and media detection.
 */

import { describe, it, expect, vi } from 'vitest';
import { MediaDetector, TRPC_IMAGE_REDIRECT_REGEX } from '../main/engine/MediaDetector';

describe('MediaDetector', () => {
  describe('TRPC_IMAGE_REDIRECT_REGEX', () => {
    it('should match standard Flow media redirect URLs and extract UUID', () => {
      const url = 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=12345678-abcd-1234-abcd-1234567890ab';
      const match = url.match(TRPC_IMAGE_REDIRECT_REGEX);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('12345678-abcd-1234-abcd-1234567890ab');
    });

    it('should match URLs with additional parameters', () => {
      const url = 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=abcdef12-3456-7890-abcd-ef1234567890&format=png';
      const match = url.match(TRPC_IMAGE_REDIRECT_REGEX);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('abcdef12-3456-7890-abcd-ef1234567890');
    });

    it('should NOT match unrelated URLs', () => {
      expect('https://labs.google/fx/tools/flow'.match(TRPC_IMAGE_REDIRECT_REGEX)).toBeNull();
      expect('https://google.com/search?q=test'.match(TRPC_IMAGE_REDIRECT_REGEX)).toBeNull();
    });
  });

  describe('parseMediaUuids', () => {
    it('should extract and deduplicate multiple media UUIDs', () => {
      const urls = [
        'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=uuid-1111-2222-3333-444455556666',
        'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=uuid-aaaa-bbbb-cccc-ddddeeeeffff',
        'https://flow-content.google/image/debef7d6-40f4-4f13-9e27-b284095ce1d6?Expires=1788872677&KeyName=la',
        'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=uuid-1111-2222-3333-444455556666', // duplicate
        'https://fonts.googleapis.com/css2?family=Roboto', // unrelated
      ];

      const { uuids, matchedUrls } = MediaDetector.parseMediaUuids(urls);

      expect(uuids).toHaveLength(3);
      expect(uuids).toContain('uuid-1111-2222-3333-444455556666');
      expect(uuids).toContain('uuid-aaaa-bbbb-cccc-ddddeeeeffff');
      expect(uuids).toContain('debef7d6-40f4-4f13-9e27-b284095ce1d6');
      expect(matchedUrls).toHaveLength(3);
    });

    it('should return empty arrays when no URLs match', () => {
      const { uuids, matchedUrls } = MediaDetector.parseMediaUuids(['https://example.com/logo.png']);
      expect(uuids).toEqual([]);
      expect(matchedUrls).toEqual([]);
    });
  });

  describe('buildTrpcUrl', () => {
    it('should construct correct TRPC redirect URL for a UUID', () => {
      const url = MediaDetector.buildTrpcUrl('my-sample-uuid-1234');
      expect(url).toBe('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=my-sample-uuid-1234');
    });
  });

  describe('detectMedia', () => {
    it('should detect image UUIDs and video elements on the page', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => ({
          imageSrcs: [
            'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=img-uuid-001',
            'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=img-uuid-002',
          ],
          videoSources: ['https://example.com/video.mp4'],
          hasVideo: true,
        })),
      } as unknown as import('playwright').Page;

      const result = await MediaDetector.detectMedia(fakePage);

      expect(result.imageUuids).toEqual(['img-uuid-001', 'img-uuid-002']);
      expect(result.mediaUrls).toHaveLength(2);
      expect(result.hasVideo).toBe(true);
      expect(result.videoSources).toEqual(['https://example.com/video.mp4']);
    });
  });
});
