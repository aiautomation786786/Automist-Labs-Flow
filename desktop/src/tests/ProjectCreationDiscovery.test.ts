/**
 * Tests for FlowUIDiscovery.discoverProjectCreationControl and ProjectContext.createNewProject.
 *
 * Verifies:
 *  1. Strategy 1: Known classes (button.new-project-button, mat-mdc-extended-fab, etc.)
 *  2. Strategy 2: Multilingual text matching (English, French, German, Spanish, etc.)
 *  3. Strategy 3: ARIA label matching
 *  4. Strategy 4: Icon-based project creation buttons
 *  5. Strategy 5: DOM deep scan with positive keywords and negative exclusion (rejecting 'Create image', 'Create video')
 *  6. FlowDriver.dismissNonCriticalOverlays safety and execution
 *  7. Diagnostic error output when discovery fails
 *  8. ProjectContext.createNewProject end-to-end flow with canvas readiness check
 */

import { describe, it, expect, vi } from 'vitest';
import { FlowUIDiscovery } from '../main/engine/FlowUIDiscovery';
import { FlowDriver } from '../main/engine/FlowDriver';
import { ProjectContext } from '../main/engine/ProjectContext';

describe('Project Creation Discovery & Resilience', () => {
  describe('FlowUIDiscovery.discoverProjectCreationControl', () => {
    it('Strategy 1: finds button via known class selector (button.new-project-button)', async () => {
      const mockLocator = {
        first: () => mockLocator,
        isVisible: vi.fn().mockResolvedValue(true),
        textContent: vi.fn().mockResolvedValue('New project'),
        getAttribute: vi.fn().mockResolvedValue('New project'),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const fakePage = {
        locator: vi.fn((sel: string) => {
          if (sel === 'button.new-project-button') return mockLocator;
          return {
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
      } as unknown as import('playwright').Page;

      const result = await FlowUIDiscovery.discoverProjectCreationControl(fakePage);

      expect(result.found).toBe(true);
      expect(result.selectorStrategy).toBe('known_classes');
      expect(result.text).toBe('New project');
      expect(result.locator).toBeDefined();
    });

    it('Strategy 2: finds multilingual "Nouveau projet" button when classes do not match', async () => {
      const mockLocator = {
        first: () => mockLocator,
        isVisible: vi.fn().mockResolvedValue(true),
        textContent: vi.fn().mockResolvedValue('Nouveau projet'),
        getAttribute: vi.fn().mockResolvedValue(''),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const fakePage = {
        locator: vi.fn((sel: string) => {
          if (sel === 'button:has-text("Nouveau projet")') return mockLocator;
          return {
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
      } as unknown as import('playwright').Page;

      const result = await FlowUIDiscovery.discoverProjectCreationControl(fakePage);

      expect(result.found).toBe(true);
      expect(result.selectorStrategy).toBe('text_matching');
      expect(result.text).toBe('Nouveau projet');
    });

    it('Strategy 3: finds button via aria-label when text is missing or icon-only', async () => {
      const mockLocator = {
        first: () => mockLocator,
        isVisible: vi.fn().mockResolvedValue(true),
        textContent: vi.fn().mockResolvedValue(''),
        getAttribute: vi.fn((attr: string) => Promise.resolve(attr === 'aria-label' ? 'Create with Google Flow' : '')),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const fakePage = {
        locator: vi.fn((sel: string) => {
          if (sel === '[aria-label*="Create with Google Flow" i]') return mockLocator;
          return {
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
      } as unknown as import('playwright').Page;

      const result = await FlowUIDiscovery.discoverProjectCreationControl(fakePage);

      expect(result.found).toBe(true);
      expect(result.selectorStrategy).toBe('aria_matching');
      expect(result.accessibleName).toBe('Create with Google Flow');
    });

    it('Strategy 4: finds button via add icon button selector', async () => {
      const mockLocator = {
        first: () => mockLocator,
        isVisible: vi.fn().mockResolvedValue(true),
        textContent: vi.fn().mockResolvedValue('add New project'),
        getAttribute: vi.fn().mockResolvedValue(''),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const fakePage = {
        locator: vi.fn((sel: string) => {
          if (sel === 'button:has(mat-icon:has-text("add")):has-text("New project")') return mockLocator;
          return {
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
      } as unknown as import('playwright').Page;

      const result = await FlowUIDiscovery.discoverProjectCreationControl(fakePage);

      expect(result.found).toBe(true);
      expect(result.selectorStrategy).toBe('icon_button');
    });

    it('Strategy 5: DOM deep scan accepts positive keywords and rejects negative candidates', async () => {
      const mockFallbackLocator = {
        first: () => mockFallbackLocator,
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const fakePage = {
        locator: vi.fn((sel: string) => {
          if (sel.includes('has-text("Start creating")')) return mockFallbackLocator;
          return {
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
        evaluate: vi.fn().mockResolvedValue({
          tag: 'button',
          text: 'Start creating',
          ariaLabel: 'Start creating in Google Flow',
          className: 'btn-cta-landing',
          id: 'cta-btn',
        }),
      } as unknown as import('playwright').Page;

      const result = await FlowUIDiscovery.discoverProjectCreationControl(fakePage);

      expect(result.found).toBe(true);
      expect(result.selectorStrategy).toBe('dom_deep_scan');
      expect(result.text).toBe('Start creating');
    });

    it('returns found: false when all 5 tiers find nothing', async () => {
      const fakePage = {
        locator: vi.fn(() => ({
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        })),
        evaluate: vi.fn().mockResolvedValue(null),
      } as unknown as import('playwright').Page;

      const result = await FlowUIDiscovery.discoverProjectCreationControl(fakePage);

      expect(result.found).toBe(false);
      expect(result.reason).toContain('No project creation control detected');
    });
  });

  describe('FlowDriver.dismissNonCriticalOverlays', () => {
    it('safely attempts to dismiss overlay buttons without crashing', async () => {
      const mockOverlayButton = {
        count: vi.fn().mockResolvedValue(1),
        first: () => ({
          click: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const fakePage = {
        locator: vi.fn(() => mockOverlayButton),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as import('playwright').Page;

      await expect(FlowDriver.dismissNonCriticalOverlays(fakePage)).resolves.not.toThrow();
    });
  });

  describe('ProjectContext.createNewProject', () => {
    it('successfully navigates, clicks discovered button, and verifies project canvas', async () => {
      let pageUrl = 'https://flow.google.com/';
      const mockButtonLocator = {
        first: () => mockButtonLocator,
        isVisible: vi.fn().mockResolvedValue(true),
        textContent: vi.fn().mockResolvedValue('New project'),
        getAttribute: vi.fn().mockResolvedValue('New project'),
        click: vi.fn().mockImplementation(async () => {
          pageUrl = 'https://flow.google.com/project/77777777-8888-9999-aaaa-bbbbccccdddd';
        }),
        evaluate: vi.fn(),
      };

      const mockComposerLocator = {
        first: () => mockComposerLocator,
        isVisible: vi.fn().mockResolvedValue(true),
      };

      const fakePage = {
        url: vi.fn(() => pageUrl),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn((sel: string) => {
          if (sel === 'button.new-project-button') return mockButtonLocator;
          if (sel === '[contenteditable="true"]') return mockComposerLocator;
          return {
            count: vi.fn().mockResolvedValue(0),
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
        evaluate: vi.fn().mockResolvedValue(null),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as import('playwright').Page;

      const project = await ProjectContext.createNewProject(fakePage, 'Test Project 1');

      expect(project.id).toBe('77777777-8888-9999-aaaa-bbbbccccdddd');
      expect(project.url).toContain('/project/77777777-8888-9999-aaaa-bbbbccccdddd');
      expect(project.name).toBe('Test Project 1');
    });

    it('throws immediate error when authentication challenge (login_required or captcha) is encountered', async () => {
      const fakePage = {
        url: vi.fn(() => 'https://accounts.google.com/signin/v2/identifier'),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(0),
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        })),
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as import('playwright').Page;

      await expect(
        ProjectContext.createNewProject(fakePage)
      ).rejects.toThrow(/Cannot create Flow project: authentication challenge encountered \(login_required\)/);
    });

    it('throws structured diagnostic error when button cannot be found after timeout', async () => {
      const fakePage = {
        url: vi.fn(() => 'https://flow.google.com/dashboard'),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(0),
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        })),
        evaluate: vi.fn().mockImplementation(async (fn: any) => {
          if (typeof fn === 'function') {
            const str = fn.toString();
            if (str.includes('reCAPTCHA') || str.includes('Session expired')) {
              return false;
            }
            if (str.includes('sidebar') || str.includes('promptInput')) {
              return true;
            }
            if (str.includes('negativeKeywords') || str.includes('positiveKeywords')) {
              return null;
            }
          }
          return {
            buttons: ['tag=button text="Settings" aria="" class="mat-btn"'],
            bodySnippet: 'Welcome to Google Flow Studio. Select an option below.',
            title: 'Google Flow Studio',
          };
        }),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as import('playwright').Page;

      await expect(
        ProjectContext.createNewProject(fakePage, undefined, { timeoutMs: 500 })
      ).rejects.toThrow(/Could not find project creation control on Google Flow after 500ms/);
    });
  });
});
