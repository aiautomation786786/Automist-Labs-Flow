/**
 * ProfileSession – Lifecycle manager for a single Chrome browser profile.
 *
 * Responsibilities:
 *  - Spawning Chrome with isolation flags and the profile-specific user-data dir.
 *  - Polling the CDP debugging port until Chrome is ready.
 *  - Attaching Playwright via chromium.connectOverCDP().
 *  - Running the state machine: created → ... → ready / auth_required / error.
 *  - Detecting Chrome crashes and emitting the 'crash' event.
 *  - Providing a typed snapshot for IPC/UI consumption.
 *
 * ISOLATION GUARANTEE:
 *  Every instance owns its own browser, context, and page objects.
 *  No static or module-level browser state is ever shared.
 *  ProfileA.browser !== ProfileB.browser always.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import { spawn, execSync, type ChildProcess } from 'child_process';
import * as http from 'http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import type {
  ProfileConfig,
  ProfileSessionStatus,
  ProfileSessionSnapshot,
} from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';
import { FlowAuthDetector } from './FlowAuthDetector';
import { FlowAutomationSession } from './FlowAutomationSession';
import { LocalChromeProfileDiscoverer } from './LocalChromeProfileDiscoverer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many times to probe the CDP port before giving up. */
const CDP_PROBE_MAX_ATTEMPTS = 20;
/** Milliseconds between CDP probe attempts. */
const CDP_PROBE_INTERVAL_MS = 1000;
/** How long to wait for a CDP probe response before moving to next attempt. */
const CDP_PROBE_TIMEOUT_MS = 500;

/** Chrome startup flags. Chosen for:
 *  - Anti-detection: navigator.webdriver is hidden, automation banners suppressed.
 *  - Isolation: each profile is an independent Chrome instance.
 *  - Stability: known-good flags for CDP headful/headless mode.
 *  - Windows-specific: no /tmp, no --user-data-dir="/tmp/...", no --no-sandbox
 *    (sandbox is required on Windows; --no-sandbox is Linux-only).
 */
const CHROME_FLAGS_BASE: string[] = [
  '--disable-blink-features=AutomationControlled', // navigator.webdriver === false
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1920,1080',
  '--disable-features=TranslateUI',   // Suppress translation popups
  '--disable-extensions',              // No extensions in automation profile
  '--disable-popup-blocking',
  '--disable-infobars',
  '--disable-save-password-bubble',
  '--hide-crash-restore-bubble',
  '--disable-session-crashed-bubble',
  '--metrics-recording-only',
  '--safebrowsing-disable-auto-update',
  '--disable-component-update',       // Prevent Chrome from updating mid-session
];

// Google Flow URL (English by default; may be updated after locale detection)
export const FLOW_BASE_URL = 'https://labs.google/fx/en/tools/flow';

// ---------------------------------------------------------------------------
// ProfileSession events
// ---------------------------------------------------------------------------

export interface ProfileSessionEventMap {
  'status_change': [snapshot: ProfileSessionSnapshot];
  'crash': [profileId: string];
  'error': [profileId: string, message: string];
}

// ---------------------------------------------------------------------------
// ProfileSession class
// ---------------------------------------------------------------------------

export class ProfileSession extends EventEmitter<ProfileSessionEventMap> {
  // ---- Identity / Config --------------------------------------------------
  readonly profileId: string;
  private config: ProfileConfig;
  private readonly log: AppLogger;

  // ---- State --------------------------------------------------------------
  private _status: ProfileSessionStatus = 'created';
  private errorMessage: string | null = null;
  private launchedAt: number | null = null;   // process.hrtime.bigint equivalent in ms
  private lastStatusChange: Date = new Date();

  // ---- Runtime objects (all per-instance — NEVER static) ------------------
  private chromeProcess: ChildProcess | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private automationSession: FlowAutomationSession | null = null;
  private isExistingBrowser = false;

  // ---- Auth / locale (discovered at runtime) ------------------------------
  private detectedEmail: string | null = null;
  private flowUrl: string | null = null;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(config: ProfileConfig) {
    super();
    this.profileId = config.profileId;
    this.config = config;
    this.log = new AppLogger({ profileId: config.profileId, mirrorToStderr: true });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Starts the session: launches Chrome, connects Playwright, checks auth. */
  async start(headless = false): Promise<void> {
    if (this._status !== 'created' && this._status !== 'stopped' && this._status !== 'error') {
      throw new Error(
        `Cannot start profile ${this.profileId}: current status is '${this._status}'.`
      );
    }

    this.setStatus('starting');
    this.errorMessage = null;

    try {
      if (this.config.connectionMode === 'existing_chrome') {
        const detection = await LocalChromeProfileDiscoverer.detectProfileState({
          userDataDir: this.config.localUserDataDir,
          profileDirectory: this.config.localProfileDirectory || this.config.chromeProfileName,
          email: this.config.expectedEmail ?? undefined,
          displayName: this.config.displayName,
          preferredCdpPort: this.config.cdpPort,
        });

        if (detection.state === 'open_not_attachable') {
          // Case B: Profile is open but NOT automation-connectable
          // Do NOT kill or close it. Do NOT launch another browser against the same normal profile.
          this.log.warn('session', 'Existing profile is running without automation endpoint', {
            profile: detection.profileDisplayName || detection.profileDirectory,
            pids: detection.pids,
          });
          throw new Error(detection.details);
        }

        if (detection.state === 'open_and_attachable') {
          // Case A: Profile is already open and automation-connectable
          this.isExistingBrowser = true;
          if (detection.cdpPort) {
            this.config.cdpPort = detection.cdpPort;
          }
          this.log.info('session', 'Attaching to running Chrome profile', {
            profile: detection.profileDisplayName || detection.profileDirectory,
            cdpPort: this.config.cdpPort,
          });
          await this.connectPlaywright();
          await this.checkAuth();
          return;
        }

        // Case C: Profile is not open. Launch Chrome session targeting this local profile.
        this.isExistingBrowser = false;
        await this.launchChrome(headless);
        await this.connectPlaywright();
        await this.checkAuth();
        return;
      }

      // Mode B: Dedicated application-managed profile
      this.isExistingBrowser = false;
      await this.launchChrome(headless);
      await this.connectPlaywright();
      await this.checkAuth();
    } catch (err) {
      const message = (err as Error).message;
      this.log.error('session', 'Session start failed', err as Error);
      this.errorMessage = message;
      this.setStatus('error');
      this.emit('error', this.profileId, message);
      // Attempt cleanup so resources are not leaked
      await this.cleanupResources();
      throw err;
    }
  }

  /** Gracefully stops the session: closes Playwright, then terminates Chrome. */
  async stop(): Promise<void> {
    if (this._status === 'stopped' || this._status === 'stopping') {
      return;
    }

    this.log.info('session', 'Stopping session');
    this.setStatus('stopping');

    await this.cleanupResources();
    this.setStatus('stopped');
    this.log.info('session', 'Session stopped');
  }

  /** Restarts the session (stop + start). */
  async restart(headless = false): Promise<void> {
    this.log.info('session', 'Restarting session');
    await this.stop();
    // Brief pause to let OS release the port/process
    await delay(1500);
    this.setStatus('created');
    await this.start(headless);
  }

  /**
   * Launches the dedicated Chrome window for manual Google login.
   *
   * DESIGN INTENT:
   *  - This is the FAST PATH for "Open Login". It does NOT wait for CDP, does NOT
   *    connect Playwright, and does NOT check authentication.
   *  - It spawns Chrome visibly (no --headless), creates the dedicated user-data
   *    directory if needed, and returns as soon as the OS PID is confirmed running.
   *  - Chrome stays open on the user's desktop for manual sign-in.
   *  - Call verifyAccount() separately after the user has signed in.
   *
   * SAFETY:
   *  - Only the application-owned dedicated profile directory is used.
   *  - No existing Chrome processes are touched.
   *  - Process termination is by specific PID only. Never by image-name or recursive flags.
   *
   * @returns PID, CDP port, and userDataDir for confirmation.
   */
  async launchLoginBrowser(): Promise<{ pid: number; cdpPort: number; userDataDir: string }> {
    // If Chrome is already running for this session (browser_open or chrome_launched), reuse it.
    if (
      this._status === 'browser_open' ||
      this._status === 'chrome_launched' ||
      this._status === 'connecting' ||
      this._status === 'connected' ||
      this._status === 'auth_required' ||
      this._status === 'ready' ||
      this._status === 'busy'
    ) {
      const pid = this.chromeProcess?.pid;
      if (pid) {
        this.log.info('session', 'launchLoginBrowser: Chrome already running, reusing', {
          pid,
          status: this._status,
        });
        return { pid, cdpPort: this.config.cdpPort, userDataDir: this.config.userDataDir };
      }
    }

    const { chromePath, cdpPort, userDataDir, chromeProfileName } = this.config;

    // Verify Chrome executable exists
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Chrome not found at: ${chromePath}`);
    }

    // Ensure the dedicated user-data directory exists (creates on first run)
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      this.log.info('session', 'Created dedicated Chrome user-data directory', { userDataDir });
    }

    const flags: string[] = [
      ...CHROME_FLAGS_BASE,
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      `--profile-directory=${chromeProfileName || 'Default'}`,
      // Navigate to Google Flow immediately so the user lands there for sign-in
      'https://labs.google/fx/en/tools/flow',
    ];
    // CRITICAL: no --headless flag — window must be visible

    this.setStatus('starting');
    this.errorMessage = null;

    this.log.info('chrome_launch', 'launchLoginBrowser: Spawning dedicated Chrome for login', {
      chromePath,
      cdpPort,
      userDataDir,
      profileDirectory: chromeProfileName || 'Default',
    });

    const chromeProcess = spawn(chromePath, flags, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    if (!chromeProcess.pid) {
      this.errorMessage = `Failed to spawn Chrome (no PID assigned). Path: ${chromePath}`;
      this.setStatus('error');
      throw new Error(this.errorMessage);
    }

    this.chromeProcess = chromeProcess;
    this.launchedAt = Date.now();

    // Set status immediately to browser_open — Chrome is alive
    this.setStatus('browser_open');

    const pid = chromeProcess.pid;
    this.log.info('chrome_launch', 'launchLoginBrowser: Chrome process confirmed', {
      pid,
      cdpPort,
      userDataDir,
    });

    // Pipe Chrome stderr for diagnostics
    chromeProcess.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.log.debug('chrome_stderr', line);
      }
    });

    // Watch for unexpected exit
    chromeProcess.once('exit', (code, signal) => {
      if (
        this._status !== 'stopping' &&
        this._status !== 'stopped' &&
        this._status !== 'created'
      ) {
        this.log.warn('chrome_crash', 'Chrome exited unexpectedly after login launch', { code, signal, pid });
        if (this._status !== 'error') {
          this.errorMessage = `Chrome exited unexpectedly (code=${code}, signal=${signal})`;
          this.setStatus('error');
          this.emit('crash', this.profileId);
        }
        this.cleanupPlaywrightObjects();
      }
      this.chromeProcess = null;
    });

    return { pid, cdpPort, userDataDir };
  }

  /** Returns the current snapshot for this session. */
  getSnapshot(): ProfileSessionSnapshot {
    let connectionState: ProfileSessionSnapshot['connectionState'] = 'profile_closed';
    if (this._status === 'ready') {
      connectionState = this.isExistingBrowser ? 'connected_existing' : 'connected_dedicated';
    } else if (this._status === 'auth_required') {
      connectionState = 'login_required';
    } else if (this._status === 'browser_open') {
      connectionState = 'browser_open';
    } else if (this._status === 'error') {
      connectionState = this.errorMessage?.includes('does not expose an automation connection')
        ? 'profile_open_not_attachable'
        : 'error';
    } else if (this._status === 'connected' || this._status === 'busy') {
      connectionState = this.isExistingBrowser ? 'connected_existing' : 'connected_dedicated';
    } else if (this._status === 'chrome_launched' || this._status === 'connecting') {
      connectionState = 'browser_open';
    }

    return {
      profileId: this.profileId,
      displayName: this.config.displayName,
      status: this._status,
      cdpPort: this.config.cdpPort,
      chromePath: this.config.chromePath,
      detectedEmail: this.detectedEmail,
      expectedEmail: this.config.expectedEmail ?? null,
      flowUrl: this.flowUrl,
      errorMessage: this.errorMessage,
      lastStatusChange: this.lastStatusChange.toISOString(),
      uptimeMs: this.launchedAt ? Date.now() - this.launchedAt : 0,
      connectionMode: this.config.connectionMode ?? 'dedicated_flow_browser',
      connectionState,
      tabCount: this.context ? this.context.pages().length : 0,
      flowTabUrl: this.page ? this.page.url() : null,
      localProfileDirectory: this.config.localProfileDirectory,
      chromePid: this.chromeProcess?.pid,
    };
  }

  /** Returns the active Playwright Page, or null if not connected. */
  getPage(): Page | null {
    return this.page;
  }

  /** Returns the active BrowserContext, or null if not connected. */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /** Returns the active Browser, or null if not connected. */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Returns the FlowAutomationSession bound to this profile.
   * Lazily initialized on first access.
   */
  getAutomationSession(): FlowAutomationSession {
    if (!this.automationSession) {
      this.automationSession = new FlowAutomationSession(this);
    }
    return this.automationSession;
  }

  /** Current session status. */
  get status(): ProfileSessionStatus {
    return this._status;
  }

  /** True if the session is connected and authenticated. */
  get isReady(): boolean {
    return this._status === 'ready';
  }

  /** True if the session is able to accept automation jobs. */
  get canAcceptJob(): boolean {
    return this._status === 'ready';
  }

  /** The OS process ID of the spawned Chrome instance, or undefined if not running. */
  get pid(): number | undefined {
    return this.chromeProcess?.pid;
  }

  /** Refreshes the ProfileConfig from the caller (e.g., after a user edit). */
  updateConfig(config: ProfileConfig): void {
    if (config.profileId !== this.profileId) {
      throw new Error(`Cannot update config: profileId mismatch.`);
    }
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Private: Chrome launch
  // ---------------------------------------------------------------------------

  private async launchChrome(headless: boolean): Promise<void> {
    const { chromePath, cdpPort, userDataDir } = this.config;

    // If an app-managed Flow profile is already running on this port, connect to it
    try {
      await probeCdpPort(cdpPort);
      this.log.info('chrome_launch', `CDP port ${cdpPort} is already active. Attaching to existing profile session.`);
      this.setStatus('chrome_launched');
      return;
    } catch {
      // Not yet active; proceed with launching fresh dedicated Chrome process
    }

    const effectiveUserData = (this.config.connectionMode === 'existing_chrome' && this.config.localUserDataDir)
      ? this.config.localUserDataDir
      : userDataDir;
    const effectiveProfileDir = (this.config.connectionMode === 'existing_chrome' && this.config.localProfileDirectory)
      ? this.config.localProfileDirectory
      : this.config.chromeProfileName;

    // Verify paths
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Chrome not found at: ${chromePath}`);
    }
    if (!fs.existsSync(effectiveUserData)) {
      fs.mkdirSync(effectiveUserData, { recursive: true });
    }

    const flags: string[] = [
      ...CHROME_FLAGS_BASE,
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${effectiveUserData}`,
      `--profile-directory=${effectiveProfileDir}`,
    ];

    if (headless) {
      // Headless mode for CI/testing. Note: Chrome 112+ uses --headless=new.
      flags.push('--headless=new');
    }

    this.log.info('chrome_launch', 'Spawning Chrome', {
      chromePath,
      cdpPort,
      headless,
      userDataDir: effectiveUserData,
      profileDirectory: effectiveProfileDir,
    });

    const chromeProcess = spawn(chromePath, flags, {
      // Detach so the Chrome window is independent of the Node parent process
      detached: false,
      // Explicitly redirect stdio so Chrome logs don't bleed into our process
      stdio: ['ignore', 'pipe', 'pipe'],
      // IMPORTANT: never use shell: true — prevents cmd.exe injection on Windows
      shell: false,
    });

    if (!chromeProcess.pid) {
      throw new Error(`Failed to spawn Chrome (no PID assigned). Path: ${chromePath}`);
    }

    this.chromeProcess = chromeProcess;
    this.launchedAt = Date.now();
    this.setStatus('chrome_launched');

    this.log.info('chrome_launch', 'Chrome spawned', { pid: chromeProcess.pid, cdpPort });

    // Pipe Chrome stderr to our log file so diagnostics are available
    chromeProcess.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.log.debug('chrome_stderr', line);
      }
    });

    // Set up crash detection
    chromeProcess.once('exit', (code, signal) => {
      if (this._status !== 'stopping' && this._status !== 'stopped') {
        this.log.warn('chrome_crash', 'Chrome exited unexpectedly', { code, signal });
        this.errorMessage = `Chrome exited unexpectedly (code=${code}, signal=${signal})`;
        this.setStatus('error');
        this.emit('crash', this.profileId);
        // Clean up playwright references
        this.cleanupPlaywrightObjects();
      }
      this.chromeProcess = null;
    });

    // Poll the CDP port until Chrome is ready
    await this.waitForCdpPort(cdpPort);
  }

  // ---------------------------------------------------------------------------
  // Private: CDP readiness polling
  // ---------------------------------------------------------------------------

  /**
   * Polls http://127.0.0.1:{cdpPort}/json/version until Chrome responds.
   * Uses the same strategy as the original connect.js (up to 20 attempts, 1s apart).
   */
  private async waitForCdpPort(port: number): Promise<void> {
    this.log.info('cdp_probe', `Waiting for CDP port ${port} to open...`);

    for (let attempt = 1; attempt <= CDP_PROBE_MAX_ATTEMPTS; attempt++) {
      if (this._status === 'error') {
        throw new Error('Chrome crashed before CDP port opened.');
      }

      try {
        await probeCdpPort(port);
        this.log.info('cdp_probe', `CDP port ${port} is open`, { attempt });
        return; // Success
      } catch {
        this.log.debug('cdp_probe', `CDP not ready`, { attempt, port });
        await delay(CDP_PROBE_INTERVAL_MS);
      }
    }

    throw new Error(
      `CDP port ${port} did not open after ${CDP_PROBE_MAX_ATTEMPTS} attempts. ` +
      'Chrome may have failed to start or the port is blocked.'
    );
  }

  // ---------------------------------------------------------------------------
  // Private: Playwright connection
  // ---------------------------------------------------------------------------

  private async connectPlaywright(): Promise<void> {
    const { cdpPort } = this.config;
    this.setStatus('connecting');

    const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
    this.log.info('playwright', `Connecting via CDP`, { endpoint: cdpEndpoint });

    try {
      this.browser = await chromium.connectOverCDP(cdpEndpoint, {
        timeout: 15000,
      });
    } catch (err) {
      throw new Error(
        `Playwright CDP connection failed on port ${cdpPort}: ${(err as Error).message}`
      );
    }

    // Use the first existing browser context, or create one
    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? await this.browser.newContext();

    if (this.isExistingBrowser || this.config.connectionMode === 'existing_chrome') {
      // CRITICAL REQUIREMENT 5: Always create a NEW tab in the existing browser.
      // NEVER navigate or close existing tabs!
      this.page = await this.context.newPage();
      this.log.info('playwright', 'Opened dedicated new tab for Google Flow in existing Chrome session', {
        totalTabs: this.context.pages().length,
      });
    } else {
      // In dedicated application-managed browser mode, use the initial blank tab or open a new one
      const pages = this.context.pages();
      this.page = pages[0] ?? await this.context.newPage();
    }

    this.setStatus('connected');
    this.log.info('playwright', 'CDP connection established', {
      contextsFound: contexts.length,
      pagesFound: this.context.pages().length,
      isExistingBrowser: this.isExistingBrowser,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: Authentication check
  // ---------------------------------------------------------------------------

  private async checkAuth(): Promise<void> {
    if (!this.page) {
      throw new Error('No page available for auth check.');
    }

    const result = await FlowAuthDetector.navigateAndCheck(
      this.page,
      this.config.flowUrlLocale
        ? `https://labs.google${this.config.flowUrlLocale}`
        : FLOW_BASE_URL,
      this.profileId,
    );

    this.flowUrl = result.url;
    this.detectedEmail = result.detectedEmail;

    switch (result.state) {
      case 'authenticated':
        this.setStatus('ready');
        this.emit('status_change', this.getSnapshot());
        this.log.info('auth', 'Flow authenticated and ready', {
          email: this.detectedEmail,
          locale: result.locale,
        });
        break;

      case 'login_required':
        this.setStatus('auth_required');
        this.emit('status_change', this.getSnapshot());
        this.log.info('auth', 'Login required — waiting for user to sign in');
        break;

      case 'captcha':
        this.setStatus('auth_required'); // Treat as auth_required for UI purposes
        this.log.warn('auth', 'CAPTCHA detected — user intervention required');
        break;

      case 'loading':
      case 'unknown':
        // Mark as auth_required conservatively — the UI will show a prompt
        this.setStatus('auth_required');
        this.log.warn('auth', `Indeterminate auth state: ${result.state}`);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: State machine helpers
  // ---------------------------------------------------------------------------

  private setStatus(newStatus: ProfileSessionStatus): void {
    const prev = this._status;
    this._status = newStatus;
    this.lastStatusChange = new Date();

    this.log.info('state_machine', `Status: ${prev} → ${newStatus}`);
    this.emit('status_change', this.getSnapshot());
  }

  // ---------------------------------------------------------------------------
  // Private: Cleanup
  // ---------------------------------------------------------------------------

  private async cleanupResources(): Promise<void> {
    // If connected to an existing browser, close ONLY our dedicated Flow tab
    if (this.isExistingBrowser) {
      this.log.info('session', 'Detaching from existing Chrome session (preserving existing tabs & browser process)');
      if (this.page && !this.page.isClosed()) {
        try {
          await this.page.close();
        } catch { /* ignore */ }
      }
      this.page = null;
      if (this.browser) {
        try {
          await Promise.race([this.browser.close(), delay(1000)]);
        } catch { /* ignore */ }
        this.browser = null;
      }
      this.context = null;
      return; // NEVER terminate the user's running Chrome instance!
    }

    await this.cleanupPlaywrightObjects();
    await this.killChrome();
  }

  private async cleanupPlaywrightObjects(): Promise<void> {
    // Close context with timeout (which closes all pages)
    if (this.context) {
      try {
        await Promise.race([
          this.context.close(),
          delay(1500),
        ]);
      } catch { /* ignore */ }
      this.context = null;
    }

    // Disconnect browser from CDP with timeout
    if (this.browser) {
      try {
        await Promise.race([
          this.browser.close(),
          delay(1500),
        ]);
      } catch { /* ignore */ }
      this.browser = null;
    }

    this.page = null;
  }

  private async killChrome(): Promise<void> {
    const proc = this.chromeProcess;
    if (!proc) return;

    this.log.info('chrome_kill', 'Terminating dedicated Chrome process', { pid: proc.pid });

    try {
      // Graceful process kill attempt first via ChildProcess.kill()
      proc.kill('SIGTERM');
      await delay(800);

      // If still running on Windows, use non-recursive taskkill strictly targeting this exact proc.pid
      // (CRITICAL: NEVER use /T or /IM chrome.exe — only terminate this dedicated child process PID)
      if (process.platform === 'win32' && proc.pid && !proc.killed && proc.exitCode === null) {
        try {
          execSync(`taskkill /pid ${proc.pid} /F`, { stdio: 'ignore' });
        } catch {
          /* already exited */
        }
      } else if (!proc.killed && proc.exitCode === null) {
        proc.kill('SIGKILL');
        await delay(300);
      }
    } catch {
      // If process is already gone, ignore
    }

    this.chromeProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Returns a promise that resolves after a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probes the Chrome CDP /json/version endpoint.
 * Resolves if Chrome responds with any HTTP 200.
 * Rejects (throws) if the request fails or times out.
 */
export function probeCdpPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}/json/version`,
      { timeout: CDP_PROBE_TIMEOUT_MS },
      (res) => {
        if (res.statusCode === 200) {
          // Consume response body to free socket
          res.resume();
          resolve();
        } else {
          reject(new Error(`Unexpected status: ${res.statusCode}`));
        }
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('CDP probe timed out'));
    });
  });
}
