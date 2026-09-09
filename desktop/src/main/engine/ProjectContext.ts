/**
 * ProjectContext – Reliable project navigation and context management for Google Flow.
 *
 * Fixes the "project stickiness" bug from the old MCP where any open project
 * was blindly reused even when a completely different project was requested.
 *
 * Rules:
 *  1. If a specific projectId is requested and page is already on that project -> reuse it.
 *  2. If a specific projectId is requested and page is on a DIFFERENT project -> navigate to requested project.
 *  3. If no projectId is requested and page is on any project -> reuse current project.
 *  4. If forceNew is true -> always creates a new project.
 *  5. Language-agnostic navigation (supports English, French, etc.).
 */

import type { Page } from 'playwright';
import type { FlowProjectContext, FlowProjectInfo, ProjectCreationDiscoveryResult } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { FlowDriver } from './FlowDriver';
import { FlowUIDiscovery } from './FlowUIDiscovery';
import { FlowAuthDetector } from './FlowAuthDetector';

const logger = new AppLogger({ mirrorToStderr: false });

export const PROJECT_URL_REGEX = /(?:(?:\/tools\/flow)?\/project\/([a-zA-Z0-9_-]+))/;

export class ProjectContext {
  /**
   * Extracts project ID from a given URL string, or null if not a project URL.
   */
  static extractProjectId(url: string): string | null {
    if (!url) return null;
    const match = url.match(PROJECT_URL_REGEX);
    return match?.[1] ?? null;
  }

  /**
   * Inspects the current page URL and returns FlowProjectInfo if on a project page.
   */
  static getCurrentProject(page: Page): FlowProjectInfo | null {
    try {
      const currentUrl = page.url();
      const id = this.extractProjectId(currentUrl);
      if (!id) return null;

      return {
        id,
        url: currentUrl,
        lastAccessed: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Navigates to a specific project by ID or full URL, and verifies that the page
   * actually reached that project.
   */
  static async openProject(
    page: Page,
    projectIdOrUrl: string,
    options: { baseFlowUrl?: string; timeoutMs?: number } = {},
  ): Promise<FlowProjectInfo> {
    const timeoutMs = options.timeoutMs ?? 30000;
    const isFullUrl = projectIdOrUrl.startsWith('http://') || projectIdOrUrl.startsWith('https://');

    let targetUrl: string;
    let expectedId: string;

    if (isFullUrl) {
      targetUrl = projectIdOrUrl;
      const extracted = this.extractProjectId(targetUrl);
      if (!extracted) {
        throw new Error(`Target URL does not appear to be a valid Flow project URL: ${targetUrl}`);
      }
      expectedId = extracted;
    } else {
      expectedId = projectIdOrUrl;
      const base = options.baseFlowUrl ?? 'https://labs.google/fx/en/tools/flow';
      // Ensure base ends cleanly before appending /project/id
      const cleanBase = base.replace(/\/project\/.*$/, '').replace(/\/$/, '');
      targetUrl = `${cleanBase}/project/${expectedId}`;
    }

    const currentUrl = page.url();
    const currentId = this.extractProjectId(currentUrl);

    // If already on this exact project, no navigation needed
    if (currentId === expectedId) {
      logger.debug('project_context', 'Already on requested project', { projectId: expectedId });
      return {
        id: expectedId,
        url: currentUrl,
        lastAccessed: new Date().toISOString(),
      };
    }

    logger.info('project_context', `Navigating to project: ${expectedId}`, { targetUrl });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(2000);

    const postNavUrl = page.url();
    const postNavId = this.extractProjectId(postNavUrl);

    if (postNavId !== expectedId) {
      throw new Error(
        `Failed to open project ${expectedId}. Browser navigated to: ${postNavUrl}`
      );
    }

    logger.info('project_context', `Successfully verified active project: ${expectedId}`);
    return {
      id: expectedId,
      url: postNavUrl,
      lastAccessed: new Date().toISOString(),
    };
  }

  /**
   * Ensures that the page is in the requested project context.
   * Resolves the "stickiness" problem by never reusing an unintended project.
   */
  static async ensureProject(
    page: Page,
    context: FlowProjectContext = {},
    options: { baseFlowUrl?: string } = {},
  ): Promise<FlowProjectInfo> {
    const current = this.getCurrentProject(page);
    const baseFlowUrl = options.baseFlowUrl ?? (page.url().includes('flow.google.com') ? 'https://flow.google.com' : 'https://labs.google/fx/en/tools/flow');

    // Scenario 1: User requested a specific projectId or URL
    if (context.projectId || context.projectUrl) {
      const target = context.projectId ?? context.projectUrl!;
      const expectedId = this.extractProjectId(target) ?? target;

      // If already on this exact project, reuse it
      if (current && current.id === expectedId && !context.forceNew) {
        logger.debug('project_context', 'Reusing currently active project', { id: expectedId });
        return current;
      }

      // If on a different project or not in a project, navigate to the target
      return await this.openProject(page, target, { baseFlowUrl });
    }

    // Scenario 2: No specific project requested, but forceNew is false and we're already in a project
    if (current && !context.forceNew) {
      logger.debug('project_context', 'No specific project requested — reusing active project', {
        id: current.id,
      });
      return current;
    }

    // Scenario 3: Not in a project, or forceNew requested -> create a new project
    return await this.createNewProject(page, context.name, { baseFlowUrl });
  }

  /**
   * Creates a new project in Flow using adaptive multi-strategy discovery,
   * overlay dismissal, and post-creation verification.
   */
  static async createNewProject(
    page: Page,
    name?: string,
    options: { baseFlowUrl?: string; timeoutMs?: number } = {},
  ): Promise<FlowProjectInfo> {
    const baseFlowUrl = options.baseFlowUrl ?? (page.url().includes('flow.google.com') ? 'https://flow.google.com' : 'https://labs.google/fx/en/tools/flow');
    const timeoutMs = options.timeoutMs ?? 15000;
    logger.info('project_context', 'Creating new Flow project...', { baseFlowUrl, timeoutMs });

    // Step 1: Pre-check authentication if on an active page
    try {
      const auth = await FlowAuthDetector.check(page);
      if (auth.state === 'login_required' || auth.state === 'captcha') {
        throw new Error(
          `Cannot create Flow project: authentication challenge encountered (${auth.state}) at ${auth.url}. Manual login required.`
        );
      }
    } catch (err: any) {
      if (err?.message?.includes('Cannot create Flow project: authentication challenge encountered')) {
        throw err;
      }
      // Non-fatal auth check exception on unnavigated/mock pages
      logger.debug('project_context', 'Auth check non-fatal warning', { err: String(err) });
    }

    // Step 2: Make sure we navigate to the Flow main page if currently inside a project or not on Flow
    const currentUrl = page.url();
    if (currentUrl.includes('/project/')) {
      logger.info('project_context', 'Currently inside a project, navigating to base Flow page first...', { baseFlowUrl });
      await page.goto(baseFlowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    } else if (!currentUrl.includes('flow.google.com') && !currentUrl.includes('labs.google')) {
      logger.info('project_context', 'Navigating to base Flow page...', { baseFlowUrl });
      await page.goto(baseFlowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    }

    // Step 3: Dismiss non-critical overlays before discovery
    await FlowDriver.dismissNonCriticalOverlays(page);

    // Step 4: Adaptive discovery loop
    const startWait = Date.now();
    let discoveryResult: ProjectCreationDiscoveryResult | null = null;

    while (Date.now() - startWait < timeoutMs) {
      // Check if page already transitioned to a project URL and composer is mounted
      const existingProject = this.getCurrentProject(page);
      if (existingProject) {
        const composerFound = await FlowDriver.findFirstVisible(page, [
          '[contenteditable="true"]',
          'textarea[placeholder]',
          'textarea',
        ], 500);
        if (composerFound) {
          logger.info('project_context', 'Already in ready project canvas', { projectId: existingProject.id });
          return existingProject;
        }
      }

      // Dismiss any newly appeared non-critical modals/toasts/dialogs
      await FlowDriver.dismissNonCriticalOverlays(page);

      // Attempt 5-tier project creation discovery
      discoveryResult = await FlowUIDiscovery.discoverProjectCreationControl(page);
      if (discoveryResult && discoveryResult.found && discoveryResult.locator) {
        break;
      }

      await page.waitForTimeout(350);
    }

    // Step 5: If discovery failed, gather diagnostic DOM info and fail with detailed error
    if (!discoveryResult || !discoveryResult.found || !discoveryResult.locator) {
      const diagnosticInfo = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
          .map((el) => {
            const text = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60);
            const aria = el.getAttribute('aria-label') || '';
            const cls = el.className || '';
            return `tag=${el.tagName.toLowerCase()} text="${text}" aria="${aria}" class="${cls.substring(0, 40)}"`;
          })
          .filter((s) => s.length > 0)
          .slice(0, 20);

        const bodySnippet = (document.body ? document.body.innerText : '')
          .substring(0, 300)
          .replace(/\s+/g, ' ');

        return {
          buttons,
          bodySnippet,
          title: document.title,
        };
      }).catch(() => ({ buttons: [], bodySnippet: 'unable to inspect body', title: 'unknown' }));

      const authAfter = await FlowAuthDetector.check(page).catch(() => null);

      throw new Error(
        `Could not find project creation control on Google Flow after ${timeoutMs}ms.\n` +
        `Current URL: ${page.url()}\n` +
        `Page Title: ${diagnosticInfo.title}\n` +
        `Auth State: ${authAfter?.state ?? 'unknown'}\n` +
        `Visible Interactive Elements (${diagnosticInfo.buttons.length}):\n` +
        diagnosticInfo.buttons.map((b) => `  - ${b}`).join('\n') + '\n' +
        `Body Snippet: ${diagnosticInfo.bodySnippet}\n` +
        `The UI structure may have changed, or an unhandled overlay/login modal may be blocking the dashboard.`
      );
    }

    // Step 6: Click the discovered project creation control
    logger.info('project_context', 'Clicking discovered project creation control', {
      strategy: discoveryResult.strategy ?? discoveryResult.selectorStrategy,
      selector: discoveryResult.selector ?? discoveryResult.elementDescription,
      confidence: discoveryResult.confidence ?? 'high',
    });

    try {
      await discoveryResult.locator.click({ timeout: 5000 });
    } catch (clickErr: any) {
      logger.warn('project_context', 'Standard click failed, falling back to evaluate click', {
        error: (clickErr as Error).message,
      });
      await discoveryResult.locator.evaluate((el: any) => (el as HTMLElement).click()).catch((evalErr: any) => {
        throw new Error(
          `Failed to click project creation control: ${(clickErr as Error).message} / ${(evalErr as Error).message}`
        );
      });
    }

    // Step 7: Wait for URL on the SAME page to change to a project URL
    let newProjectId: string | null = null;
    let newProjectUrl: string = '';
    const navStart = Date.now();
    const navTimeoutMs = 15000;

    while (Date.now() - navStart < navTimeoutMs) {
      await page.waitForTimeout(300);
      const url = page.url();
      const id = this.extractProjectId(url);
      if (id) {
        newProjectId = id;
        newProjectUrl = url;
        break;
      }
    }

    if (!newProjectId) {
      throw new Error(
        `Clicked project creation button, but browser did not transition to a project URL within ${navTimeoutMs}ms. Current URL: ${page.url()}`
      );
    }

    logger.info('project_context', 'Project URL detected, verifying canvas/composer readiness...', {
      projectId: newProjectId,
      url: newProjectUrl,
    });

    // Step 8: Post-creation verification - ensure composer or canvas is ready
    const composerCandidates = [
      '[contenteditable="true"]',
      'textarea[placeholder]',
      'textarea',
      'flow-prompt-box',
      '.composer',
      'flow-canvas',
      'canvas',
    ];
    const composerReady = await FlowDriver.waitForFirstVisible(page, composerCandidates, 12000, 300);
    if (!composerReady) {
      logger.warn('project_context', 'Composer or canvas not visibly confirmed within 12s, but project URL is active', {
        projectId: newProjectId,
      });
    } else {
      logger.info('project_context', 'Project canvas/composer is ready', { projectId: newProjectId });
    }

    // Step 9: If an optional name was provided, attempt to name the project
    if (name) {
      const nameInputSelectors = [
        'input[placeholder*="name" i]',
        'input[placeholder*="nom" i]',
        'input[aria-label*="project name" i]',
        'input[aria-label*="title" i]',
        '[contenteditable="true"][aria-label*="title" i]',
      ];
      const nameInput = await FlowDriver.findFirstVisible(page, nameInputSelectors, 1500);
      if (nameInput) {
        await FlowDriver.safeFill(page, nameInput, name);
        await page.keyboard.press('Enter').catch(() => {});
      }
    }

    logger.info('project_context', 'New project ready', { projectId: newProjectId });
    return {
      id: newProjectId,
      url: newProjectUrl,
      name,
      lastAccessed: new Date().toISOString(),
    };
  }
}
