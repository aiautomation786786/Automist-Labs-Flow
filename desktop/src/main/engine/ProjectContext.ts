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
import type { FlowProjectContext, FlowProjectInfo } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { FlowDriver } from './FlowDriver';

const logger = new AppLogger({ mirrorToStderr: false });

export const PROJECT_URL_REGEX = /\/tools\/flow\/project\/([a-zA-Z0-9_-]+)/;

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
    const baseFlowUrl = options.baseFlowUrl ?? 'https://labs.google/fx/en/tools/flow';

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
   * Creates a new project in Flow by clicking the "New Project" control,
   * waiting for the project URL to be generated, and returning the new project info.
   */
  static async createNewProject(
    page: Page,
    name?: string,
    options: { baseFlowUrl?: string } = {},
  ): Promise<FlowProjectInfo> {
    const baseFlowUrl = options.baseFlowUrl ?? 'https://labs.google/fx/en/tools/flow';
    logger.info('project_context', 'Creating new Flow project...');

    // Make sure we're on the Flow main page first if currently inside a project
    const currentUrl = page.url();
    if (currentUrl.includes('/project/')) {
      await page.goto(baseFlowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    // Resilient multilingual "New project" candidates
    const newProjectSelectors = [
      'button:has-text("New project")',
      'button:has-text("Nouveau projet")',
      'a:has-text("New project")',
      'a:has-text("Nouveau projet")',
      '[aria-label*="New project" i]',
      '[aria-label*="Nouveau projet" i]',
      'button:has-text("Create")',
      'button:has-text("Créer")',
      '[data-testid="new-project-button"]',
    ];

    const btnLocator = await FlowDriver.findFirstVisible(page, newProjectSelectors, 2000);

    if (btnLocator) {
      await btnLocator.click();
    } else {
      // Fallback: search for any button containing an "add" icon
      const addIconBtn = page.locator('button:has([class*="add"]), button:has-text("add")').first();
      const addVisible = await addIconBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (addVisible) {
        await addIconBtn.click();
      } else {
        throw new Error(
          'Could not find "New Project" button on the Google Flow page. The UI structure may have changed.'
        );
      }
    }

    // Wait for the URL to change into a project URL
    let newProjectId: string | null = null;
    let newProjectUrl: string = '';
    const startWait = Date.now();

    while (Date.now() - startWait < 15000) {
      await page.waitForTimeout(1000);
      const url = page.url();
      const id = this.extractProjectId(url);
      if (id) {
        newProjectId = id;
        newProjectUrl = url;
        break;
      }
    }

    if (!newProjectId) {
      throw new Error('Created new project, but browser did not transition to a project URL within 15s.');
    }

    // If an optional name was provided, attempt to name the project
    if (name) {
      const nameInputSelectors = [
        'input[placeholder*="name" i]',
        'input[placeholder*="nom" i]',
        '[contenteditable="true"][aria-label*="title" i]',
      ];
      const nameInput = await FlowDriver.findFirstVisible(page, nameInputSelectors, 1000);
      if (nameInput) {
        await FlowDriver.safeFill(page, nameInput, name);
        await page.keyboard.press('Enter');
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
