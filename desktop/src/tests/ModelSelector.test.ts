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

  describe('ensureImageModel', () => {
    it('should return verified without clicking if requested model is already active', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => 'Nano Banana Pro'),
        locator: vi.fn(),
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Nano Banana Pro' });

      expect(result.modelRequested).toBe('Nano Banana Pro');
      expect(result.modelDetectedBefore).toBe('Nano Banana Pro');
      expect(result.selectionAttempted).toBe(false);
      expect(result.modelDetectedAfter).toBe('Nano Banana Pro');
      expect(result.verified).toBe(true);
      expect(fakePage.locator).not.toHaveBeenCalled();
    });

    it('should switch from Nano Banana 2 to Nano Banana Pro when requested', async () => {
      let currentModel = 'Nano Banana 2';

      const mockDropdownBtn = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {}),
      };

      const mockOption = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {
          currentModel = 'Nano Banana Pro';
        }),
      };

      const fakePage = {
        evaluate: vi.fn(async () => currentModel),
        locator: vi.fn((sel: string) => ({
          first: () => {
            if (sel.includes('Nano Banana Pro') || sel.includes('option')) {
              return mockOption;
            }
            return mockDropdownBtn;
          },
        })),
        waitForTimeout: vi.fn(async () => {}),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Nano Banana Pro' });

      expect(result.selectionAttempted).toBe(true);
      expect(result.modelDetectedBefore).toBe('Nano Banana 2');
      expect(result.modelDetectedAfter).toBe('Nano Banana Pro');
      expect(result.verified).toBe(true);
      expect(mockDropdownBtn.click).toHaveBeenCalled();
      expect(mockOption.click).toHaveBeenCalled();
    });

    it('should select Nano Banana 2 Lite when requested', async () => {
      let currentModel = 'Nano Banana 2';

      const mockDropdownBtn = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {}),
      };

      const mockOption = {
        isVisible: vi.fn(async () => true),
        click: vi.fn(async () => {
          currentModel = 'Nano Banana 2 Lite';
        }),
      };

      const fakePage = {
        evaluate: vi.fn(async () => currentModel),
        locator: vi.fn((sel: string) => ({
          first: () => {
            if (sel.includes('Lite') || sel.includes('option')) {
              return mockOption;
            }
            return mockDropdownBtn;
          },
        })),
        waitForTimeout: vi.fn(async () => {}),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Nano Banana 2 Lite' });

      expect(result.selectionAttempted).toBe(true);
      expect(result.modelDetectedAfter).toBe('Nano Banana 2 Lite');
      expect(result.verified).toBe(true);
    });

    it('should refuse to select a video model via ensureImageModel', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => 'Veo 3.1 Quality'),
        locator: vi.fn(),
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Veo 3.1 Fast' });
      expect(result.verified).toBe(false);
      expect(result.error).toContain('is not a supported image model');
    });
  });

  describe('exact model name matching (disambiguation)', () => {
    it('should NOT treat "Nano Banana 2 Lite" as already matching "Nano Banana 2" target', async () => {
      // This is the CRITICAL bug fix test:
      // The old code used .includes() which caused "Nano Banana 2 Lite" to match "Nano Banana 2"
      const fakePage = {
        // Simulate: current model is "Nano Banana 2 Lite" but we want "Nano Banana 2"
        evaluate: vi.fn(async () => 'Nano Banana 2 Lite'),
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn(async () => false),
          }),
        })),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Nano Banana 2' });

      // Must NOT return verified=true with selectionAttempted=false
      // (the old code would short-circuit and say "already active")
      expect(result.selectionAttempted).toBe(false); // no dropdown found (mock)
      expect(result.verified).toBe(false); // not verified because dropdown not found
      // The key assertion: it did NOT short-circuit claiming "already active"
      // If it had, selectionAttempted would be false AND verified would be true - that's the bug
      expect(!(result.selectionAttempted === false && result.verified === true)).toBe(true);
    });

    it('should NOT treat "Nano Banana Pro" as already matching "Nano Banana 2" target', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => 'Nano Banana Pro'),
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn(async () => false),
          }),
        })),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Nano Banana 2' });
      // Must attempt selection (not short-circuit)
      expect(result.verified).toBe(false);
    });

    it('should treat "🍌 Nano Banana 2 arrow_drop_down" as exact match for "Nano Banana 2"', async () => {
      // The composite pill button text includes emoji and Material icon text
      const fakePage = {
        evaluate: vi.fn(async () => '🍌 Nano Banana 2 arrow_drop_down'),
        locator: vi.fn(),
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureNanoBanana2(fakePage);
      // After normalization, this should match and short-circuit as verified
      expect(result.selectionAttempted).toBe(false);
      expect(result.verified).toBe(true);
    });

    it('should NOT treat "🍌 Nano Banana 2 Lite arrow_drop_down" as match for "Nano Banana 2"', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => '🍌 Nano Banana 2 Lite arrow_drop_down'),
        locator: vi.fn(() => ({
          first: () => ({
            isVisible: vi.fn(async () => false),
          }),
        })),
        keyboard: { press: vi.fn() },
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureNanoBanana2(fakePage);
      // Nano Banana 2 Lite must NOT match Nano Banana 2 target
      expect(result.verified).toBe(false);
      // Should not short-circuit with verified=true
      expect(result.selectionAttempted === false && result.verified === true).toBe(false);
    });

    it('should correctly identify "Nano Banana 2 Lite" as already active when requesting "Nano Banana 2 Lite"', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => 'Nano Banana 2 Lite'),
        locator: vi.fn(),
      } as unknown as import('playwright').Page;

      const result = await ModelSelector.ensureImageModel(fakePage, { modelName: 'Nano Banana 2 Lite' });
      expect(result.selectionAttempted).toBe(false);
      expect(result.verified).toBe(true);
    });
  });
});
