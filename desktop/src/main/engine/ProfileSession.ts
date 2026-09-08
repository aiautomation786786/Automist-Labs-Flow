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
  FlowAuthCheckResult,
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
  async start(options: boolean | { headless?: boolean; background?: boolean } = false): Promise<void> {
    const headless = typeof options === 'boolean' ? options : (options?.headless ?? false);
    const background = typeof options === 'boolean' ? !headless : (options?.background ?? !headless);

    if (
      this._status !== 'created' &&
      this._status !== 'stopped' &&
      this._status !== 'error' &&
      this._status !== 'browser_open'
    ) {
      throw new Error(
        `Cannot start profile ${this.profileId}: current status is '${this._status}'.`
      );
    }

    // If browser process is already running (e.g. from launchLoginBrowser), attach without re-spawning
    if (this._status === 'browser_open' || (this.chromeProcess && this.isProcessAlive())) {
      this.log.info('session', 'Chrome is already running for profile; attaching Playwright and checking auth');
      this.isExistingBrowser = false;
      await this.connectToRunningBrowser();
      await this.checkAuth();
      return;
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
        await this.launchChrome(headless, background);
        await this.connectPlaywright();
        await this.checkAuth();
        return;
      }

      // Mode B: Dedicated application-managed profile
      this.isExistingBrowser = false;
      await this.launchChrome(headless, background);
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
    // If Chrome is already running for this session, reposition it on-screen and bring to front
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
        this.log.info('session', 'launchLoginBrowser: Chrome already running, repositioning on-screen for sign-in', {
          pid,
          status: this._status,
        });

        try {
          if (this.context) {
            const pages = this.context.pages();
            const p = this.page && !this.page.isClosed() ? this.page : (pages[0] ?? await this.context.newPage());
            this.page = p;
            const cdp = await this.context.newCDPSession(p);
            const { windowId } = await cdp.send('Browser.getWindowForTarget');
            await cdp.send('Browser.setWindowBounds', {
              windowId,
              bounds: { left: 100, top: 100, width: 1280, height: 900, windowState: 'normal' },
            });
            await p.bringToFront().catch(() => {});
            const currentUrl = p.url();
            if (!currentUrl.includes('labs.google') && !currentUrl.includes('accounts.google.com')) {
              await p.goto('https://labs.google/fx/en/tools/flow', { waitUntil: 'domcontentloaded' }).catch(() => {});
            }
          }
        } catch (repositionErr) {
          this.log.debug('chrome_launch', 'CDP reposition notice', { error: (repositionErr as Error).message });
        }

        // If we previously called Win32 ShowWindow(SW_HIDE), restore window to taskbar via SW_SHOW=5
        if (process.platform === 'win32') {
          try {
            const port = this.config.cdpPort;
            const rootPid = pid || 0;
            const restoreScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowRestorer {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@ -ErrorAction SilentlyContinue

$targetPids = @(${rootPid});
$port = ${port};

$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1;
if ($conn) { $targetPids += [int]$conn.OwningProcess }

$snapshotPids = @($targetPids | Where-Object { $_ -gt 0 });
foreach ($p in $snapshotPids) {
  $children = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq $p }
  foreach ($c in $children) { $targetPids += [int]$c.ProcessId }
}

$byCmd = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" }
foreach ($b in $byCmd) { $targetPids += [int]$b.ProcessId }

$targetPids = $targetPids | Where-Object { $_ -gt 0 } | Select-Object -Unique

if ($targetPids.Count -gt 0) {
  [Win32WindowRestorer]::EnumWindows({
    param($hwnd, $lparam)
    $procId = 0
    [Win32WindowRestorer]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    if ($targetPids -contains $procId) {
      [Win32WindowRestorer]::ShowWindow($hwnd, 5) | Out-Null # SW_SHOW = 5
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
}
`.trim();

            const encoded = Buffer.from(restoreScript, 'utf16le').toString('base64');
            execSync(`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`, {
              timeout: 5000,
              stdio: 'ignore',
              windowsHide: true,
            });
            this.log.info('chrome_launch', 'Chrome window restored to taskbar via Win32 EnumWindows + SW_SHOW');
          } catch {
            // Non-fatal
          }
        }

        return { pid, cdpPort: this.config.cdpPort, userDataDir: this.config.userDataDir };

      }
    }

    const { chromePath, cdpPort } = this.config;
    const userDataDir = (this.config.connectionMode === 'existing_chrome' && this.config.localUserDataDir)
      ? this.config.localUserDataDir
      : this.config.userDataDir;
    const chromeProfileName = (this.config.connectionMode === 'existing_chrome' && this.config.localProfileDirectory)
      ? this.config.localProfileDirectory
      : (this.config.chromeProfileName || 'Default');

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
      '--window-position=100,100',
      '--window-size=1280,900',
      // Navigate to Google Flow immediately so the user lands there for sign-in
      'https://labs.google/fx/en/tools/flow',
    ];
    // CRITICAL: no --headless flag — window must be visible for manual user sign-in

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
      stdio: ['ignore', 'ignore', 'pipe'],
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

  /** Returns true if the Chrome child process is currently known to be alive. */
  isProcessAlive(): boolean {
    if (!this.chromeProcess) return false;
    return !this.chromeProcess.killed && this.chromeProcess.exitCode === null;
  }

  /**
   * Connects Playwright over CDP to an already-running Chrome browser for this profile.
   *
   * Reuses the existing browser process (never re-spawns, never kills).
   * Finds and reuses the existing Google Flow tab if open;
   * otherwise creates one new tab and navigates to Google Flow.
   *
   * @param timeoutMs Max time to wait for CDP port to be responsive (default: 15000ms).
   * @returns The active Flow Page.
   */
  async connectToRunningBrowser(timeoutMs = 15000): Promise<Page> {
    const { cdpPort, flowUrlLocale } = this.config;

    // 1. Check if known process is explicitly dead
    if (this.chromeProcess && (this.chromeProcess.killed || this.chromeProcess.exitCode !== null)) {
      throw new Error(`Dedicated Chrome process (PID ${this.chromeProcess.pid}) has exited.`);
    }

    // 2. Poll CDP endpoint until ready or timeout (polling every 300ms)
    const startTime = Date.now();
    let portReady = false;
    while (Date.now() - startTime < timeoutMs) {
      try {
        await probeCdpPort(cdpPort);
        portReady = true;
        break;
      } catch {
        await delay(300);
      }
    }

    if (!portReady) {
      throw new Error(
        `Dedicated Chrome is running, but its automation endpoint (port ${cdpPort}) is not available yet.`
      );
    }

    // 3. Connect Playwright over CDP if not already connected
    const previousStatus = this._status;
    const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;

    // Verify existing browser connection if already held
    if (this.browser && this.browser.isConnected()) {
      try {
        const testContexts = this.browser.contexts();
        if (testContexts.length > 0 && testContexts[0].pages().length > 0) {
          this.log.debug('reconnect', 'Reusing existing healthy Playwright connection');
        }
      } catch {
        this.log.warn('reconnect', 'Existing Playwright connection is unresponsive, resetting');
        try { await Promise.race([this.browser.close(), delay(1000)]); } catch {}
        this.browser = null;
        this.context = null;
        this.page = null;
      }
    }

    if (!this.browser || !this.browser.isConnected()) {
      this.setStatus('connecting');
      this.log.info('reconnect', 'Connecting Playwright to running browser over CDP', { endpoint: cdpEndpoint });
      try {
        this.browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 8000 });
      } catch (err) {
        // Restore status instead of leaving stuck in 'connecting'
        const fallbackStatus = (this.chromeProcess && this.isProcessAlive()) ? 'browser_open' : (previousStatus !== 'connecting' ? previousStatus : 'created');
        this.setStatus(fallbackStatus);
        throw new Error(
          `Failed to connect Playwright to running Chrome on port ${cdpPort}: ${(err as Error).message}`
        );
      }
    }

    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? await this.browser.newContext();

    // 4. Inspect existing tabs/pages
    const allPages = this.context.pages();
    this.log.info('reconnect', `Inspect existing tabs: found ${allPages.length} tabs`);

    // Priority 1: find a page already on a Flow project (/project/)
    let flowPage: Page | null = null;
    for (const p of allPages) {
      try {
        const url = p.url();
        if (url.includes('flow.google.com/project/') || url.includes('labs.google/fx/project/')) {
          flowPage = p;
          this.log.info('reconnect', `Found and reusing existing Flow project tab: ${url}`);
          await Promise.race([flowPage.bringToFront(), delay(1500)]).catch(() => {});
          break;
        }
      } catch {
        /* page may be closing */
      }
    }

    // Priority 2: find any page on Google Flow (labs.google or flow.google.com)
    if (!flowPage) {
      for (const p of allPages) {
        try {
          const url = p.url();
          if (url.includes('labs.google') || url.includes('flow.google.com')) {
            flowPage = p;
            this.log.info('reconnect', `Found and reusing existing Flow tab: ${url}`);
            await Promise.race([flowPage.bringToFront(), delay(1500)]).catch(() => {});
            break;
          }
        } catch {
          /* page may be closing */
        }
      }
    }

    // Second priority: find an accounts.google.com sign-in tab if user is currently there
    if (!flowPage) {
      for (const p of allPages) {
        try {
          const url = p.url();
          if (url.includes('accounts.google.com') || url.includes('google.com/signin')) {
            flowPage = p;
            this.log.info('reconnect', `Found and reusing Google sign-in tab: ${url}`);
            await Promise.race([flowPage.bringToFront(), delay(1500)]).catch(() => {});
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    // Third priority: if no Flow or sign-in tab, create one new tab and navigate to Flow
    if (!flowPage) {
      this.log.info('reconnect', 'No Flow tab found in running browser; creating new Flow tab');
      flowPage = await this.context.newPage();
      const targetUrl = flowUrlLocale
        ? `https://labs.google${flowUrlLocale}`
        : FLOW_BASE_URL;
      await flowPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => {
        this.log.warn('reconnect', `Navigation to Flow tab returned warning: ${(e as Error).message}`);
      });
    }

    this.page = flowPage;
    this.setStatus('connected');
    if (this.config.connectionMode === 'existing_chrome') {
      this.isExistingBrowser = true;
    }

    return flowPage;
  }

  /**
   * Reconnects to the running dedicated browser if needed, finds the Flow page,
   * runs FlowAuthDetector, and updates session state and metadata.
   */
  async verifyAuth(): Promise<FlowAuthCheckResult & { pagesCount: number; flowPageFound: boolean }> {
    // 1. Ensure connected to running browser
    let page = this.page;
    if (!page || page.isClosed() || !this.browser || !this.browser.isConnected()) {
      page = await this.connectToRunningBrowser();
    }

    const pages = this.context ? this.context.pages() : [];
    const pagesCount = pages.length;
    const currentUrl = page.url();
    const flowPageFound = currentUrl.includes('labs.google') || currentUrl.includes('flow.google.com');

    this.log.info('auth_verify', 'Verifying Google Flow authentication state', {
      url: currentUrl,
      pagesCount,
      flowPageFound,
      pid: this.pid,
      cdpPort: this.config.cdpPort,
    });

    // 2. If page is loading, poll briefly (up to 4 seconds) for Flow to finish initialising
    let result = await FlowAuthDetector.check(page, this.profileId);
    if (result.state === 'loading') {
      const startPoll = Date.now();
      while (Date.now() - startPoll < 4000) {
        await delay(800);
        result = await FlowAuthDetector.check(page, this.profileId);
        if (result.state !== 'loading') break;
      }
    }

    // If page is on an unexpected URL (e.g. blank page), navigate to Flow
    if (result.state === 'unknown' && !currentUrl.includes('labs.google') && !currentUrl.includes('flow.google.com') && !currentUrl.includes('accounts.google')) {
      const targetUrl = this.config.flowUrlLocale
        ? `https://labs.google${this.config.flowUrlLocale}`
        : FLOW_BASE_URL;
      this.log.info('auth_verify', 'Page not on Flow or Google login; navigating to Flow URL', { targetUrl });
      result = await FlowAuthDetector.navigateAndCheck(page, targetUrl, this.profileId);
    }

    this.flowUrl = result.url;
    this.detectedEmail = result.detectedEmail ?? this.detectedEmail;

    // 3. Update status based on detected result
    switch (result.state) {
      case 'authenticated':
        this.setStatus('ready');
        this.emit('status_change', this.getSnapshot());
        this.log.info('auth_verify', 'Flow authenticated and ready', {
          email: this.detectedEmail,
          locale: result.locale,
        });
        // Hide the Chrome window from the normal taskbar view since automation runs headlessly
        this.hideWindowFromTaskbar(page).catch((e) => {
          this.log.debug('auth_verify', `Window hide notice: ${(e as Error).message}`);
        });
        break;

      case 'login_required':
        this.setStatus('auth_required');
        this.emit('status_change', this.getSnapshot());
        this.log.info('auth_verify', 'Login required — user needs to sign in via Chrome');
        break;

      case 'captcha':
        this.setStatus('auth_required');
        this.emit('status_change', this.getSnapshot());
        this.log.warn('auth_verify', 'CAPTCHA detected on Flow page');
        break;

      case 'loading':
      case 'unknown':
        this.setStatus('browser_open');
        this.emit('status_change', this.getSnapshot());
        this.log.warn('auth_verify', `Indeterminate auth state: ${result.state}`);
        break;
    }

    return {
      ...result,
      pagesCount,
      flowPageFound,
    };
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

  /**
   * Spawns a dedicated fresh Flow tab for an execution job.
   * Keeps the persistent background browser alive.
   *
   * CRITICAL: Always navigates to the BASE Flow creation URL, never a stale
   * project-specific URL. this.flowUrl is whatever page Chrome was on during
   * authentication (e.g. flow.google.com/project/abc123) which does NOT have
   * the model selector toolbar. We must always land on the generation interface.
   */
  async createJobPage(flowUrl?: string): Promise<Page> {
    if (!this.context) {
      await this.connectToRunningBrowser();
    }
    if (!this.context) {
      throw new Error(`Profile ${this.profileId} has no active browser context.`);
    }

    const jobPage = await this.context.newPage();

    // Determine the correct base Flow URL — NEVER use this.flowUrl directly since
    // it may point to a specific project page (flow.google.com/project/...) where
    // the generation toolbar and model selector do not exist.
    let url: string;
    if (flowUrl) {
      // Explicit caller override — use it only if it looks like a base Flow URL
      if (!flowUrl.includes('/project/')) {
        url = flowUrl;
      } else {
        // Caller passed a project URL — ignore it, use base URL
        this.log.warn('tab_lifecycle', 'createJobPage: ignoring project-specific flowUrl, using base URL', { rejectedUrl: flowUrl });
        url = this.config.flowUrlLocale
          ? `https://labs.google${this.config.flowUrlLocale}`
          : FLOW_BASE_URL;
      }
    } else {
      // Always use locale-specific base URL, derived from config (set after locale detection at auth time)
      url = this.config.flowUrlLocale
        ? `https://labs.google${this.config.flowUrlLocale}`
        : FLOW_BASE_URL;
    }

    this.log.info('tab_lifecycle', `Created dedicated job tab, navigating to base Flow URL`, { url });

    try {
      await jobPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Wait for the client-side SPA to mount buttons and prompt toolbar
      await jobPage.waitForSelector('button', { state: 'visible', timeout: 20000 }).catch(() => {});
      await jobPage.waitForTimeout(1500);
    } catch (navErr) {
      this.log.warn('tab_lifecycle', `Navigation warning on job tab: ${(navErr as Error).message}`);
    }

    return jobPage;
  }

  /**
   * Closes a dedicated job tab after asset persistence is complete (or on failure).
   * Ensures at least one tab remains alive so the persistent background Chrome process stays open.
   */
  async closeJobPage(jobPage: Page): Promise<void> {
    try {
      if (jobPage && !jobPage.isClosed()) {
        const pages = this.context?.pages() || [];
        if (pages.length > 1) {
          this.log.info('tab_lifecycle', 'Closing dedicated job tab after persistence', { url: jobPage.url() });
          await jobPage.close();
        } else {
          this.log.info('tab_lifecycle', 'Job tab is the only active page; keeping as standby tab');
        }
      }
    } catch (err) {
      this.log.debug('tab_lifecycle', `Error closing job page: ${(err as Error).message}`);
    }
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
  // Private: Window visibility management
  // ---------------------------------------------------------------------------

  /**
   * Hides the Chrome window from the user's taskbar after authentication succeeds.
   *
   * Strategy (layered):
   *  1. CDP Browser.setWindowBounds → windowState: 'minimized'
   *  2. Windows PowerShell with EnumWindows calling ShowWindow(hwnd, SW_HIDE = 0).
   *     Encoded via Base64 UTF-16LE (-EncodedCommand) to eliminate quote-escaping failures.
   *     Finds all Chrome processes by PID, Parent PID, or CDP port connection.
   */
  async hideWindowFromTaskbar(page?: Page): Promise<void> {
    const targetPage = page && !page.isClosed() ? page : (this.page && !this.page.isClosed() ? this.page : this.context?.pages()[0]);

    // Step 1: Minimize via CDP (cross-platform, keeps CDP alive)
    if (this.context && targetPage) {
      try {
        if (typeof (this.context as any).newCDPSession === 'function') {
          const cdp = await (this.context as any).newCDPSession(targetPage);
          const { windowId } = await cdp.send('Browser.getWindowForTarget');
          await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'minimized' },
          });
          this.log.info('session', 'Chrome window minimized via CDP', { windowId });
          await cdp.detach().catch(() => {});
        }
      } catch (cdpErr) {
        this.log.debug('session', `CDP minimize notice: ${(cdpErr as Error).message}`);
      }
    }

    // Step 2: Win32 ShowWindow(hwnd, SW_HIDE=0) via PowerShell Base64 EncodedCommand
    if (process.platform !== 'win32') return;

    try {
      const port = this.config.cdpPort;
      const rootPid = this.chromeProcess?.pid || 0;

      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowHider {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@ -ErrorAction SilentlyContinue

$targetPids = @(${rootPid});
$port = ${port};

$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1;
if ($conn) {
  $targetPids += [int]$conn.OwningProcess
}

$snapshotPids = @($targetPids | Where-Object { $_ -gt 0 });
foreach ($p in $snapshotPids) {
  $children = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq $p }
  foreach ($c in $children) {
    $targetPids += [int]$c.ProcessId
  }
}

$byCmd = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" }
foreach ($b in $byCmd) {
  $targetPids += [int]$b.ProcessId
}

$targetPids = $targetPids | Where-Object { $_ -gt 0 } | Select-Object -Unique

if ($targetPids.Count -gt 0) {
  [Win32WindowHider]::EnumWindows({
    param($hwnd, $lparam)
    $procId = 0
    [Win32WindowHider]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    if ($targetPids -contains $procId) {
      [Win32WindowHider]::ShowWindow($hwnd, 0) | Out-Null # SW_HIDE = 0
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
}
`.trim();

      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      execSync(`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`, {
        timeout: 5000,
        stdio: 'ignore',
        windowsHide: true,
      });
      this.log.info('session', 'Chrome window hidden from taskbar via Win32 EnumWindows + SW_HIDE');
    } catch (psErr) {
      this.log.debug('session', `Win32 hide notice: ${(psErr as Error).message?.substring(0, 120)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Chrome launch
  // ---------------------------------------------------------------------------

  private async launchChrome(headless: boolean, background = true): Promise<void> {
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
    } else if (background) {
      // Off-screen headed mode: Keeps full WebGL/Canvas/DOM rendering while running unobtrusively in background
      flags.push('--window-position=-2400,-2400');
    }

    this.log.info('chrome_launch', 'Spawning Chrome', {
      chromePath,
      cdpPort,
      headless,
      background,
      userDataDir: effectiveUserData,
      profileDirectory: effectiveProfileDir,
    });

    const chromeProcess = spawn(chromePath, flags, {
      // Detach so the Chrome window is independent of the Node parent process
      detached: false,
      // Explicitly redirect stdio so Chrome logs don't bleed into our process
      stdio: ['ignore', 'ignore', 'pipe'],
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
        timeout: 8000,
      });
    } catch (err) {
      const fallbackStatus = (this.chromeProcess && this.isProcessAlive()) ? 'browser_open' : 'error';
      this.setStatus(fallbackStatus);
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
      // In dedicated application-managed browser mode, reuse existing Flow tab if present
      const pages = this.context.pages();
      let flowPage: Page | null = null;
      for (const p of pages) {
        try {
          const url = p.url();
          if (url.includes('labs.google') || url.includes('flow.google.com') || url.includes('accounts.google')) {
            flowPage = p;
            break;
          }
        } catch { /* ignore */ }
      }
      this.page = flowPage ?? pages[0] ?? await this.context.newPage();
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
