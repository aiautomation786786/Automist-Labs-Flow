/**
 * Tests for SafeDownloader.
 *
 * Verifies non-navigating media download using Playwright's APIRequestContext.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SafeDownloader } from '../main/engine/SafeDownloader';

describe('SafeDownloader', () => {
  let tmpTestDir: string;

  beforeEach(() => {
    tmpTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-download-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpTestDir)) {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    }
  });

  it('should download a media asset without navigating the page', async () => {
    const originalFlowUrl = 'https://labs.google/fx/en/tools/flow/project/active-project-123';
    let currentPageUrl = originalFlowUrl;

    const fakeImageBuffer = Buffer.from('FAKE_PNG_BINARY_DATA_12345');

    const fakePage = {
      url: vi.fn(() => currentPageUrl),
      request: {
        get: vi.fn(async (_url: string) => ({
          ok: () => true,
          status: () => 200,
          statusText: () => 'OK',
          body: async () => fakeImageBuffer,
        })),
      },
    } as unknown as import('playwright').Page;

    const targetFile = path.join(tmpTestDir, 'downloaded_image.png');
    const result = await SafeDownloader.download(
      fakePage,
      'test-image-uuid-1234',
      targetFile,
    );

    // Verify download result
    expect(result.downloadedFiles).toContain(targetFile);
    expect(result.bytesDownloaded).toBe(fakeImageBuffer.length);
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile).toString()).toBe('FAKE_PNG_BINARY_DATA_12345');

    // CRITICAL: Verify page URL was NEVER changed
    expect(fakePage.url()).toBe(originalFlowUrl);
    expect(fakePage.request.get).toHaveBeenCalledWith(
      'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=test-image-uuid-1234',
      expect.any(Object),
    );
  });

  it('should throw if download receives non-200 HTTP response', async () => {
    const fakePage = {
      url: vi.fn(() => 'https://labs.google/fx/en/tools/flow/project/active-project-123'),
      request: {
        get: vi.fn(async () => ({
          ok: () => false,
          status: () => 404,
          statusText: () => 'Not Found',
          body: async () => Buffer.from(''),
        })),
      },
    } as unknown as import('playwright').Page;

    const targetFile = path.join(tmpTestDir, 'should_fail.png');

    await expect(
      SafeDownloader.download(fakePage, 'nonexistent-uuid', targetFile),
    ).rejects.toThrow('Download failed with HTTP 404');
  });

  it('should throw if download receives an empty body', async () => {
    const fakePage = {
      url: vi.fn(() => 'https://labs.google/fx/en/tools/flow/project/active-project-123'),
      request: {
        get: vi.fn(async () => ({
          ok: () => true,
          status: () => 200,
          statusText: () => 'OK',
          body: async () => Buffer.alloc(0),
        })),
      },
    } as unknown as import('playwright').Page;

    const targetFile = path.join(tmpTestDir, 'empty.png');

    await expect(
      SafeDownloader.download(fakePage, 'empty-uuid', targetFile),
    ).rejects.toThrow('empty (0 bytes)');
  });
});
