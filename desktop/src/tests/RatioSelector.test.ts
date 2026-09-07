/**
 * Tests for RatioSelector.
 *
 * Verifies 16:9 and 9:16 aspect ratio detection and active UI selection.
 */

import { describe, it, expect, vi } from 'vitest';
import { RatioSelector } from '../main/engine/RatioSelector';

describe('RatioSelector', () => {
  describe('detectCurrentRatio', () => {
    it('should detect 16:9 when 16:9 element is active', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => '16:9'),
      } as unknown as import('playwright').Page;

      const ratio = await RatioSelector.detectCurrentRatio(fakePage);
      expect(ratio).toBe('16:9');
    });

    it('should detect 9:16 when 9:16 element is active', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => '9:16'),
      } as unknown as import('playwright').Page;

      const ratio = await RatioSelector.detectCurrentRatio(fakePage);
      expect(ratio).toBe('9:16');
    });

    it('should return null when no ratio is discernible', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => null),
      } as unknown as import('playwright').Page;

      const ratio = await RatioSelector.detectCurrentRatio(fakePage);
      expect(ratio).toBeNull();
    });
  });

  describe('selectRatio', () => {
    it('should return verified without clicking if target ratio is already active', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => '16:9'),
        locator: vi.fn(),
      } as unknown as import('playwright').Page;

      const result = await RatioSelector.selectRatio(fakePage, '16:9');

      expect(result.requestedRatio).toBe('16:9');
      expect(result.detectedBefore).toBe('16:9');
      expect(result.selected).toBe(false);
      expect(result.verified).toBe(true);
      expect(fakePage.locator).not.toHaveBeenCalled();
    });

    it('should actively click ratio control when switching to 9:16', async () => {
      let currentRatio = '16:9';

      const mockRatioBtn = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {
          currentRatio = '9:16';
        }),
      };

      const fakePage = {
        evaluate: vi.fn(async () => currentRatio),
        locator: vi.fn(() => ({
          first: () => mockRatioBtn,
        })),
        waitForTimeout: vi.fn(async () => {}),
      } as unknown as import('playwright').Page;

      const result = await RatioSelector.selectRatio(fakePage, '9:16');

      expect(result.requestedRatio).toBe('9:16');
      expect(result.detectedBefore).toBe('16:9');
      expect(result.selected).toBe(true);
      expect(result.detectedAfter).toBe('9:16');
      expect(result.verified).toBe(true);
      expect(mockRatioBtn.click).toHaveBeenCalled();
    });

    it('should return structured error if ratio button is not found', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => null),
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn(async () => false),
          }),
        })),
        waitForTimeout: vi.fn(async () => {}),
      } as unknown as import('playwright').Page;

      const result = await RatioSelector.selectRatio(fakePage, '16:9');

      expect(result.requestedRatio).toBe('16:9');
      expect(result.verified).toBe(false);
      expect(result.error).toContain('Could not locate');
    });
  });
});
