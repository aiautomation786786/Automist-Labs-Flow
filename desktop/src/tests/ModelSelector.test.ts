/**
 * Tests for ModelSelector.
 *
 * Verifies Nano Banana 2 detection, active selection, and video safety guards.
 */

import { describe, it, expect, vi } from 'vitest';
import { ModelSelector, NANO_BANANA_2 } from '../main/engine/ModelSelector';

describe('ModelSelector', () => {
  describe('isVideoModel safety guard', () => {
    it('should identify video models correctly', () => {
      expect(ModelSelector.isVideoModel('Omni Flash')).toBe(true);
      expect(ModelSelector.isVideoModel('Veo 3.1 - Fast')).toBe(true);
      expect(ModelSelector.isVideoModel('Veo 3.1 - Quality')).toBe(true);
      expect(ModelSelector.isVideoModel('Veo')).toBe(true);
      expect(ModelSelector.isVideoModel('Omni')).toBe(true);
    });

    it('should NOT identify image models as video models', () => {
      expect(ModelSelector.isVideoModel('Nano Banana 2')).toBe(false);
      expect(ModelSelector.isVideoModel('Nano Banana')).toBe(false);
      expect(ModelSelector.isVideoModel('Imagen 3')).toBe(false);
      expect(ModelSelector.isVideoModel('Imagen')).toBe(false);
      expect(ModelSelector.isVideoModel(null)).toBe(false);
    });
  });

  describe('ensureNanoBanana2', () => {
    it('should return verified without clicking if Nano Banana 2 is already active', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => 'Nano Banana 2'),
        locator: vi.fn(),
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureNanoBanana2(fakePage);

      expect(result.modelRequested).toBe(NANO_BANANA_2);
      expect(result.modelDetectedBefore).toBe('Nano Banana 2');
      expect(result.selectionAttempted).toBe(false);
      expect(result.modelDetectedAfter).toBe('Nano Banana 2');
      expect(result.verified).toBe(true);
      expect(fakePage.locator).not.toHaveBeenCalled();
    });

    it('should return a structured error if model dropdown button is not found', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => 'Imagen 3'),
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn(async () => false),
          }),
        })),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureNanoBanana2(fakePage);

      expect(result.modelRequested).toBe(NANO_BANANA_2);
      expect(result.selectionAttempted).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error).toContain('Could not locate');
    });

    it('should actively click dropdown and option when switching to Nano Banana 2', async () => {
      let currentModel = 'Imagen 3';

      const mockDropdownBtn = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {}),
      };

      const mockOption = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {
          currentModel = 'Nano Banana 2';
        }),
      };

      const fakePage = {
        evaluate: vi.fn(async () => currentModel),
        locator: vi.fn((sel: string) => ({
          first: () => {
            if (sel.includes('Nano Banana 2') || sel.includes('option')) {
              return mockOption;
            }
            return mockDropdownBtn;
          },
        })),
        waitForTimeout: vi.fn(async () => {}),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureNanoBanana2(fakePage);

      expect(result.selectionAttempted).toBe(true);
      expect(result.modelDetectedBefore).toBe('Imagen 3');
      expect(result.modelDetectedAfter).toBe('Nano Banana 2');
      expect(result.verified).toBe(true);
      expect(mockDropdownBtn.click).toHaveBeenCalled();
      expect(mockOption.click).toHaveBeenCalled();
    });
  });
});
