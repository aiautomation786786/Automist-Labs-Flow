/**
 * FlowAutomationSession – Flow automation facade bound to a single ProfileSession.
 *
 * CONCEPTUAL BOUNDARY:
 *  ProfileSessionManager
 *        │
 *        ├── ProfileSession A
 *        │         └── FlowAutomationSession A (isolated to Profile A's browser/page/context)
 *        │
 *        └── ProfileSession B
 *                  └── FlowAutomationSession B (isolated to Profile B's browser/page/context)
 *
 * Each FlowAutomationSession operates ONLY on the browser/page/context owned by
 * its injected ProfileSession. There is NO global Playwright page or browser state.
 */

import type { Page } from 'playwright';
import type {
  FlowAuthCheckResult,
  FlowAutomationStatus,
  FlowProjectContext,
  FlowProjectInfo,
  FlowUIDiscoveryResult,
  MediaDetectionResult,
  MediaDownloadResult,
  ModelSelectionResult,
  RatioSelectionResult,
  SupportedAspectRatio,
} from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { ProfileSession } from './ProfileSession';
import { FlowAuthDetector } from './FlowAuthDetector';
import { FlowUIDiscovery } from './FlowUIDiscovery';
import { ProjectContext } from './ProjectContext';
import { ModelSelector, NANO_BANANA_2 } from './ModelSelector';
import { RatioSelector } from './RatioSelector';
import { MediaDetector } from './MediaDetector';
import { SafeDownloader } from './SafeDownloader';

export class FlowAutomationSession {
  readonly profileId: string;
  private readonly profileSession: ProfileSession;
  private readonly log: AppLogger;
  private _status: FlowAutomationStatus = 'idle';
  private currentProject: FlowProjectInfo | null = null;

  constructor(profileSession: ProfileSession) {
    this.profileSession = profileSession;
    this.profileId = profileSession.profileId;
    this.log = new AppLogger({ profileId: this.profileId, mirrorToStderr: false });

    this.log.info('flow_automation', 'FlowAutomationSession created for profile', {
      profileId: this.profileId,
    });
  }

  // ---------------------------------------------------------------------------
  // Session / Page validation
  // ---------------------------------------------------------------------------

  /**
   * Retrieves the active Playwright Page from the underlying ProfileSession.
   * Throws if the session has not been started or page is unavailable.
   */
  getPage(): Page {
    const page = this.profileSession.getPage();
    if (!page) {
      throw new Error(
        `ProfileSession ${this.profileId} has no active Page. Status: '${this.profileSession.status}'. ` +
        'Ensure the session is started before invoking Flow automation.'
      );
    }
    return page;
  }

  /**
   * Current high-level automation status.
   */
  get status(): FlowAutomationStatus {
    return this._status;
  }

  // ---------------------------------------------------------------------------
  // Flow Page / Authentication
  // ---------------------------------------------------------------------------

  /**
   * Navigates to Google Flow and waits for domcontentloaded.
   */
  async ensureFlowLoaded(locale = 'en'): Promise<void> {
    this.setStatus('navigating');
    const page = this.getPage();
    const flowUrl = `https://labs.google/fx/${locale}/tools/flow`;

    this.log.info('flow_automation', 'Navigating to Flow', { flowUrl });
    try {
      await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      this.setStatus('idle');
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * Checks the authentication state of Google Flow on this session's page.
   * Reuses the language-independent FlowAuthDetector.
   */
  async checkAuthentication(): Promise<FlowAuthCheckResult> {
    this.setStatus('checking_auth');
    const page = this.getPage();

    try {
      const result = await FlowAuthDetector.check(page, this.profileId);
      this.setStatus('idle');
      return result;
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // UI Discovery
  // ---------------------------------------------------------------------------

  /**
   * Performs structured introspection of the current Flow page.
   */
  async discoverUI(): Promise<FlowUIDiscoveryResult> {
    this.setStatus('discovering');
    const page = this.getPage();

    try {
      const result = await FlowUIDiscovery.discover(page);
      this.setStatus('idle');
      return result;
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Project Context
  // ---------------------------------------------------------------------------

  /**
   * Ensures the page is operating in the requested project context.
   * Eliminates the project stickiness bug.
   */
  async ensureProject(context: FlowProjectContext = {}): Promise<FlowProjectInfo> {
    this.setStatus('navigating');
    const page = this.getPage();

    try {
      const project = await ProjectContext.ensureProject(page, context);
      this.currentProject = project;
      this.setStatus('idle');
      return project;
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * Explicitly navigates to a project by ID or URL.
   */
  async openProject(projectIdOrUrl: string): Promise<FlowProjectInfo> {
    this.setStatus('navigating');
    const page = this.getPage();

    try {
      const project = await ProjectContext.openProject(page, projectIdOrUrl);
      this.currentProject = project;
      this.setStatus('idle');
      return project;
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * Returns the currently active project info for this session, if known.
   */
  getCurrentProject(): FlowProjectInfo | null {
    if (this.currentProject) return this.currentProject;
    const page = this.profileSession.getPage();
    if (!page) return null;
    return ProjectContext.getCurrentProject(page);
  }

  // ---------------------------------------------------------------------------
  // Model Selection (Nano Banana 2 Requirement)
  // ---------------------------------------------------------------------------

  /**
   * Inspects the current model and actively switches the Flow dropdown
   * to Nano Banana 2, verifying the change in the UI.
   */
  async selectNanoBanana2(): Promise<ModelSelectionResult> {
    this.setStatus('selecting_model');
    const page = this.getPage();

    try {
      const result = await ModelSelector.ensureNanoBanana2(page);
      this.setStatus('idle');
      return result;
    } catch (err) {
      this.setStatus('error');
      return {
        modelRequested: NANO_BANANA_2,
        modelDetectedBefore: null,
        selectionAttempted: true,
        modelDetectedAfter: null,
        verified: false,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Detects the currently active model string on the toolbar.
   */
  async detectCurrentModel(): Promise<string | null> {
    const page = this.getPage();
    return await ModelSelector.detectCurrentModel(page);
  }

  // ---------------------------------------------------------------------------
  // Aspect Ratio Selection (16:9 and 9:16)
  // ---------------------------------------------------------------------------

  /**
   * Selects and verifies an aspect ratio (16:9 or 9:16).
   */
  async selectRatio(ratio: SupportedAspectRatio): Promise<RatioSelectionResult> {
    this.setStatus('selecting_ratio');
    const page = this.getPage();

    try {
      const result = await RatioSelector.selectRatio(page, ratio);
      this.setStatus('idle');
      return result;
    } catch (err) {
      this.setStatus('error');
      return {
        requestedRatio: ratio,
        detectedBefore: null,
        selected: false,
        detectedAfter: null,
        verified: false,
        error: (err as Error).message,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Media Detection & Safe Background Download
  // ---------------------------------------------------------------------------

  /**
   * Detects generated image UUIDs and video elements on the current project canvas.
   */
  async detectGeneratedMedia(): Promise<MediaDetectionResult> {
    const page = this.getPage();
    return await MediaDetector.detectMedia(page);
  }

  /**
   * Downloads a media asset in the background without navigating the main Flow page.
   */
  async downloadMedia(
    uuidOrUrl: string,
    destinationPath: string,
  ): Promise<MediaDownloadResult> {
    this.setStatus('downloading');
    const page = this.getPage();

    try {
      const result = await SafeDownloader.download(page, uuidOrUrl, destinationPath);
      this.setStatus('idle');
      return result;
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helper
  // ---------------------------------------------------------------------------

  private setStatus(newStatus: FlowAutomationStatus): void {
    this._status = newStatus;
  }
}
