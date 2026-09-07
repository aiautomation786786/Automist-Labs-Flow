/**
 * Tests for FlowDriver.
 *
 * Verifies DOM primitives and safe actions on injected Page instances.
 */

import { describe, it, expect, vi } from 'vitest';
import { FlowDriver } from '../main/engine/FlowDriver';

describe('FlowDriver', () => {
  describe('findFirstVisible', () => {
    it('should return the first locator that reports visible', async () => {
      const mockFirstLoc = {
        isVisible: vi.fn(async () => false),
      };
      const mockSecondLoc = {
        isVisible: vi.fn(async () => true),
      };

      const fakePage = {
        locator: vi.fn((sel: string) => ({
          first: () => {
            if (sel === 'button.candidate-two') return mockSecondLoc;
            return mockFirstLoc;
          },
        })),
      } as unknown as import('playwright').Page;

      const found = await FlowDriver.findFirstVisible(
        fakePage,
        ['button.candidate-one', 'button.candidate-two', 'button.candidate-three'],
        500,
      );

      expect(found).not.toBeNull();
      expect(fakePage.locator).toHaveBeenCalledWith('button.candidate-one');
      expect(fakePage.locator).toHaveBeenCalledWith('button.candidate-two');
    });

    it('should return null if none of the candidate selectors are visible', async () => {
      const mockHiddenLoc = {
        isVisible: vi.fn(async () => false),
      };

      const fakePage = {
        locator: vi.fn(() => ({
          first: () => mockHiddenLoc,
        })),
      } as unknown as import('playwright').Page;

      const found = await FlowDriver.findFirstVisible(
        fakePage,
        ['.hidden-one', '.hidden-two'],
        200,
      );

      expect(found).toBeNull();
    });
  });

  describe('getVisibleTexts', () => {
    it('should return texts extracted by evaluate', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => ['Submit', 'Cancel', 'Preview']),
      } as unknown as import('playwright').Page;

      const texts = await FlowDriver.getVisibleTexts(fakePage, 'button');
      expect(texts).toEqual(['Submit', 'Cancel', 'Preview']);
    });

    it('should return empty array on evaluate failure', async () => {
      const fakePage = {
        evaluate: vi.fn(async () => {
          throw new Error('context destroyed');
        }),
      } as unknown as import('playwright').Page;

      const texts = await FlowDriver.getVisibleTexts(fakePage, 'button');
      expect(texts).toEqual([]);
    });
  });

  describe('detectInteractiveElements', () => {
    it('should return structured button, input, and link arrays', async () => {
      const fakeElements = {
        buttons: [{ tag: 'BUTTON', text: 'Generate', visible: true }],
        inputs: [{ tag: 'TEXTAREA', text: '', visible: true }],
        links: [{ tag: 'A', text: 'Help', visible: true }],
      };

      const fakePage = {
        evaluate: vi.fn(async () => fakeElements),
      } as unknown as import('playwright').Page;

      const result = await FlowDriver.detectInteractiveElements(fakePage);
      expect(result.buttons).toHaveLength(1);
      expect(result.inputs).toHaveLength(1);
      expect(result.links).toHaveLength(1);
      expect(result.buttons[0]?.text).toBe('Generate');
    });
  });
});
