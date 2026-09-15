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
const CDP_PROBE_TIMEOUT_MS = 2000;

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
  '--disable-quic',                   // Prevent net::ERR_QUIC_PROTOCOL_ERROR
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
  private mainPage: Page | null = null;
  private activeJobPages: Map<string, { page: Page; jobId: string; createdAt: number }> = new Map();
  private automationSession: FlowAutomationSession | null = null;
  private isExistingBrowser = false;
  private isRecoveringMainPage = false;
  private postLoginWatcherTimer: NodeJS.Timeout | null = null;

  // ---- Auth / locale (discovered at runtime) ------------------------------
  private detectedEmail: string | null = null;
  private flowUrl: string | null = null;
  private isConnectingPromise: Promise<Page> | null = null;
  private jobPageCreationMutex: Promise<void> = Promise.resolve();

  private acquireJobPageCreationLock(): Promise<() => void> {
    let releaseLock: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const currentLock = this.jobPageCreationMutex;
    this.jobPageCreationMutex = this.jobPageCreationMutex.then(() => nextLock);
    return currentLock.then(() => releaseLock);
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(config: ProfileConfig) {
    super();
    this.profileId = config.profileId;
    this.config = config;
    this.log = new AppLogger({ profileId: config.profileId, mirrorToStderr: true });
    this.detectedEmail =
      LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
        config.userDataDir,
        config.chromeProfileName || 'Default'
      ) ||
      config.detectedEmail ||
      config.expectedEmail ||
      null;
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

        if (detection.state === 'open_and_attachable') {
          // Case A: Profile is already open and automation-connectable via CDP
          this.isExistingBrowser = true;
          if (detection.cdpPort) {
            this.config.cdpPort = detection.cdpPort;
          }
          this.log.info('session', 'Attaching to running Chrome profile with CDP', {
            profile: detection.profileDisplayName || detection.profileDirectory,
            cdpPort: this.config.cdpPort,
          });
          await this.connectPlaywright();
          await this.checkAuth();
          return;
        }

        // Case B / C: Profile is running without CDP endpoint or not running.
        // We preserve/reuse the authenticated Google session by seeding our isolated dedicated
        // user-data directory and launching a dedicated automation instance on its assigned CDP port.
        // The user's personal Chrome session is never killed, hijacked, or locked.
        this.log.info('session', 'Launching dedicated automation Chrome with seeded profile session', {
          profile: detection.profileDisplayName || detection.profileDirectory,
          sourceState: detection.state,
          cdpPort: this.config.cdpPort,
        });

        if (this.config.localUserDataDir && this.config.localProfileDirectory) {
          LocalChromeProfileDiscoverer.seedDedicatedUserDataDir(
            this.config.localUserDataDir,
            this.config.localProfileDirectory,
            this.config.userDataDir
          );
        }

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
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
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
      # Clear WS_EX_TOOLWINDOW (0x80), add WS_EX_APPWINDOW (0x40000)
      $exStyle = [Win32WindowRestorer]::GetWindowLong($hwnd, -20)
      $newExStyle = ($exStyle -band (-bnot 0x00000080)) -bor 0x00040000
      [Win32WindowRestorer]::SetWindowLong($hwnd, -20, $newExStyle) | Out-Null
      [Win32WindowRestorer]::ShowWindow($hwnd, 5) | Out-Null # SW_SHOW = 5
      # SWP_SHOWWINDOW = 0x0040
      [Win32WindowRestorer]::SetWindowPos($hwnd, [IntPtr]::Zero, 100, 100, 1280, 900, 0x0040) | Out-Null
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

        this.startPostLoginWatcher();
        return { pid, cdpPort: this.config.cdpPort, userDataDir: this.config.userDataDir };

      }
    }

    const { chromePath, cdpPort } = this.config;
    const userDataDir = this.config.userDataDir;
    const chromeProfileName = this.config.chromeProfileName || 'Default';

    // Verify Chrome executable exists
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Chrome not found at: ${chromePath}`);
    }

    // Seed session data if needed
    if (this.config.connectionMode === 'existing_chrome' && this.config.localUserDataDir && this.config.localProfileDirectory) {
      LocalChromeProfileDiscoverer.seedDedicatedUserDataDir(
        this.config.localUserDataDir,
        this.config.localProfileDirectory,
        userDataDir
      );
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

    // Watch for Chrome exit after login launch
    chromeProcess.once('exit', async (code, signal) => {
      this.stopPostLoginWatcher();
      this.cleanupPlaywrightObjects();
      this.chromeProcess = null;

      if (
        this._status === 'stopping' ||
        this._status === 'stopped' ||
        this._status === 'created'
      ) {
        return;
      }

      this.log.info('chrome_exit', 'Dedicated Chrome process closed by user/system', { code, signal, pid });
      this.setStatus('stopped');
      this.errorMessage = null;
      this.emit('status_change', this.getSnapshot());
    });

    this.startPostLoginWatcher();
    return { pid, cdpPort, userDataDir };
  }

  /** Returns true if the Chrome child process is currently known to be alive. */
  isProcessAlive(): boolean {
    if (!this.chromeProcess) return false;
    return !this.chromeProcess.killed && this.chromeProcess.exitCode === null;
  }

  /**
   * Starts a background watcher that monitors the login page for successful sign-in.
   * As soon as the user logs in and reaches an authenticated Flow state, the window
   * is automatically hidden into the background, status is set to 'ready', and events emitted.
   */
  startPostLoginWatcher(): void {
    if (this.postLoginWatcherTimer) return;

    this.log.info('auth_watcher', 'Starting post-login background auto-hide watcher');

    const startTime = Date.now();
    const MAX_WATCH_TIME_MS = 15 * 60 * 1000; // 15 minutes max

    this.postLoginWatcherTimer = setInterval(async () => {
      // 1. Terminate watcher if session stopped, killed, or timed out
      if (!this.isProcessAlive() || Date.now() - startTime > MAX_WATCH_TIME_MS) {
        this.stopPostLoginWatcher();
        return;
      }

      // If already ready, no need to keep watching
      if (this._status === 'ready') {
        this.stopPostLoginWatcher();
        return;
      }

      try {
        // Ensure connected to browser
        let page = this.page;
        if (!page || page.isClosed() || !this.browser || !this.browser.isConnected()) {
          try {
            page = await this.connectToRunningBrowser();
          } catch {
            return; // Chrome might still be initializing
          }
        }

        const currentUrl = page.url();
        // If still on Google accounts sign-in / password entry, keep waiting quietly
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('myaccount.google.com')) {
          return;
        }

        // Check auth status
        const authResult = await FlowAuthDetector.check(page, this.profileId);
        if (authResult.state === 'authenticated') {
          this.log.info('auth_watcher', 'Successful authentication detected! Auto-hiding window.', {
            detectedEmail: authResult.detectedEmail,
            locale: authResult.locale,
          });

          this.flowUrl = authResult.url;
          if (authResult.detectedEmail) {
            const localEmail = LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
              this.config.userDataDir,
              this.config.chromeProfileName || 'Default'
            );
            if (localEmail && localEmail.toLowerCase() !== authResult.detectedEmail.toLowerCase()) {
              this.log.warn('auth_watcher', `Detected email '${authResult.detectedEmail}' does not match profile's local account '${localEmail}'. Preserving local identity.`);
              this.detectedEmail = localEmail;
            } else {
              this.detectedEmail = authResult.detectedEmail;
            }
          }
          this.setStatus('ready');
          this.emit('status_change', this.getSnapshot());

          // Automatically hide the window from the desktop and taskbar
          await this.hideWindowFromTaskbar(page).catch(() => {});

          this.stopPostLoginWatcher();
        }
      } catch (err) {
        this.log.debug('auth_watcher', `Post-login check notice: ${(err as Error).message}`);
      }
    }, 1500);

    if (this.postLoginWatcherTimer && typeof this.postLoginWatcherTimer.unref === 'function') {
      this.postLoginWatcherTimer.unref();
    }
  }

  /** Stops the post-login background watcher. */
  stopPostLoginWatcher(): void {
    if (this.postLoginWatcherTimer) {
      clearInterval(this.postLoginWatcherTimer);
      this.postLoginWatcherTimer = null;
      this.log.info('auth_watcher', 'Stopped post-login background watcher');
    }
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
    // Fast path: if already connected with a valid page, return it immediately
    if (this.browser && this.browser.isConnected() && this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (this.isConnectingPromise) {
      return this.isConnectingPromise;
    }

    this.isConnectingPromise = this._connectToRunningBrowserInternal(timeoutMs);
    try {
      return await this.isConnectingPromise;
    } finally {
      this.isConnectingPromise = null;
    }
  }

  private async _connectToRunningBrowserInternal(timeoutMs = 15000): Promise<Page> {
    const { cdpPort, flowUrlLocale } = this.config;

    // 1. Check if known process is explicitly dead
    if (this.chromeProcess && (this.chromeProcess.killed || this.chromeProcess.exitCode !== null)) {
      throw new Error(`Dedicated Chrome process (PID ${this.chromeProcess.pid}) has exited.`);
    }

    // 2. Poll CDP endpoint until ready or timeout (polling every 300ms)
    this.setStatus('waiting_for_cdp');
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
      this.setStatus('connection_error');
      this.errorMessage = `Dedicated Chrome is running, but its automation endpoint (port ${cdpPort}) is not available yet.`;
      throw new Error(this.errorMessage);
    }

    // 3. Connect Playwright over CDP if not already connected
    const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;

    // Verify existing browser connection if already held
    if (this.browser && this.browser.isConnected()) {
      try {
        const testContexts = this.browser.contexts();
        if (testContexts.length > 0) {
          this.log.debug('reconnect', 'Reusing existing healthy Playwright connection');
        }
      } catch {
        this.log.warn('reconnect', 'Existing Playwright connection is unresponsive, resetting');
        try { await Promise.race([this.browser.close(), delay(1000)]); } catch {}
        this.browser = null;
        this.context = null;
        this.page = null;
        this.mainPage = null;
      }
    }

    if (!this.browser || !this.browser.isConnected()) {
      this.setStatus('connecting');
      this.log.info('reconnect', 'Connecting Playwright to running browser over CDP', { endpoint: cdpEndpoint });
      try {
        this.browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 25000 });
        this.attachBrowserListeners(this.browser);
      } catch (err) {
        this.setStatus('connection_error');
        this.errorMessage = `Failed to connect Playwright to running Chrome on port ${cdpPort}: ${(err as Error).message}`;
        throw new Error(this.errorMessage);
      }
    }

    this.setStatus('creating_page');

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

    this.mainPage = flowPage;
    this.page = flowPage;
    this.attachMainPageListeners(flowPage);

    // Prune extraneous restored tabs for dedicated profiles to enforce the single-tab idle invariant
    if (this.config.connectionMode !== 'existing_chrome') {
      for (const p of allPages) {
        if (p !== flowPage && !this.isJobPage(p)) {
          try {
            await p.close();
            this.log.info('tab_lifecycle', 'Closed extraneous restored tab to preserve single-tab idle invariant');
          } catch {
            /* ignore */
          }
        }
      }
    }

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

    // If page is not on Flow domain, check if another open tab has Flow or navigate current tab to Flow
    if (!currentUrl.includes('labs.google') && !currentUrl.includes('flow.google.com')) {
      const flowTab = pages.find((p) => {
        try {
          const u = p.url();
          return u.includes('labs.google') || u.includes('flow.google.com');
        } catch {
          return false;
        }
      });
      if (flowTab) {
        page = flowTab;
        this.page = flowTab;
        this.mainPage = flowTab;
        result = await FlowAuthDetector.check(page, this.profileId);
      } else {
        const targetUrl = this.config.flowUrlLocale
          ? `https://labs.google${this.config.flowUrlLocale}`
          : FLOW_BASE_URL;
        this.log.info('auth_verify', 'Navigating to Flow URL to verify authentication', { targetUrl });
        result = await FlowAuthDetector.navigateAndCheck(page, targetUrl, this.profileId);
      }
    }

    this.flowUrl = result.url;
    if (result.detectedEmail) {
      const localEmail = LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
        this.config.userDataDir,
        this.config.chromeProfileName || 'Default'
      );
      if (localEmail && localEmail.toLowerCase() !== result.detectedEmail.toLowerCase()) {
        this.log.warn('auth_verify', `Detected email '${result.detectedEmail}' differs from profile's local account '${localEmail}'. Preserving local identity.`);
        this.detectedEmail = localEmail;
      } else {
        this.detectedEmail = result.detectedEmail;
      }
    } else if (!this.detectedEmail) {
      this.detectedEmail =
        LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
          this.config.userDataDir,
          this.config.chromeProfileName || 'Default'
        ) ||
        this.config.detectedEmail ||
        this.config.expectedEmail ||
        null;
    }

    // 3. Update status based on detected result
    switch (result.state) {
      case 'authenticated':
        this.setStatus('ready');
        this.emit('status_change', this.getSnapshot());
        this.stopPostLoginWatcher();
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
        this.errorMessage = 'Bot challenge / CAPTCHA detected on Flow. Manual solve required.';
        this.emit('status_change', this.getSnapshot());
        this.log.warn('auth_verify', 'CAPTCHA detected; setting status to auth_required');
        break;

      case 'loading':
      case 'unknown':
      default:
        this.setStatus('browser_open');
        this.emit('status_change', this.getSnapshot());
        this.log.info('auth_verify', `Auth state '${result.state}'; keeping browser_open`);
        break;
    }

    return {
      ...result,
      pagesCount,
      flowPageFound,
    };
  }


  // ---------------------------------------------------------------------------
  // Snapshots & Getters
  // ---------------------------------------------------------------------------

  /**
   * Returns a serialisable snapshot of the current session state.
   * Emitted to renderer via IPC on state changes.
   */
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

    const resolvedEmail =
      this.detectedEmail ||
      LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
        this.config.userDataDir,
        this.config.chromeProfileName || 'Default'
      ) ||
      this.config.detectedEmail ||
      this.config.expectedEmail ||
      null;

    return {
      profileId: this.profileId,
      displayName: this.config.displayName,
      status: this._status,
      cdpPort: this.config.cdpPort,
      chromePath: this.config.chromePath,
      detectedEmail: resolvedEmail,
      expectedEmail: this.config.expectedEmail ?? null,
      flowUrl: this.flowUrl,
      errorMessage: this.errorMessage,
      lastStatusChange: this.lastStatusChange.toISOString(),
      uptimeMs: this.launchedAt ? Date.now() - this.launchedAt : 0,
      connectionMode: this.config.connectionMode ?? 'dedicated_flow_browser',
      connectionState,
      tabCount: this.context ? this.context.pages().length : 0,
      flowTabUrl: this.page && !this.page.isClosed() ? this.page.url() : null,
      localProfileDirectory: this.config.localProfileDirectory,
      chromePid: this.chromeProcess?.pid,
    };
  }

  /** Returns the active Playwright Page, or null if not connected or closed. */
  getPage(): Page | null {
    const isAlive = (p: Page | null): boolean => {
      if (!p) return false;
      return typeof p.isClosed === 'function' ? !p.isClosed() : true;
    };

    if (this.page && isAlive(this.page)) {
      return this.page;
    }
    if (this.mainPage && isAlive(this.mainPage)) {
      this.page = this.mainPage;
      return this.page;
    }
    if (this.context) {
      const pages = typeof this.context.pages === 'function' ? this.context.pages() : [];
      const available = pages.filter((p) => isAlive(p) && !this.isJobPage(p));
      if (available.length > 0) {
        this.mainPage = available[0];
        this.page = available[0];
        return this.page;
      }
      const anyAvailable = pages.filter((p) => isAlive(p));
      if (anyAvailable.length > 0) {
        this.page = anyAvailable[0];
        return this.page;
      }
    }
    return null;
  }

  /** Checks whether the given page belongs to an active generation job. */
  private isJobPage(page: Page): boolean {
    for (const entry of this.activeJobPages.values()) {
      if (entry.page === page) return true;
    }
    return false;
  }

  /**
   * Spawns a dedicated fresh Flow or provider tab for an execution job.
   * Tracks the tab in activeJobPages for automatic cleanup.
   * Keeps the persistent background browser and main profile page alive.
   */
  async createJobPage(jobIdOrUrl?: string, customUrl?: string): Promise<Page> {
    let jobId: string;
    let flowUrl: string | undefined;

    if (jobIdOrUrl && (jobIdOrUrl.startsWith('http://') || jobIdOrUrl.startsWith('https://'))) {
      flowUrl = jobIdOrUrl;
      jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    } else {
      jobId = jobIdOrUrl || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      flowUrl = customUrl;
    }

    if (!this.context || !this.browser || !this.browser.isConnected()) {
      await this.connectToRunningBrowser();
    }
    if (!this.context) {
      throw new Error(`Profile ${this.profileId} has no active browser context.`);
    }

    const releaseLock = await this.acquireJobPageCreationLock();
    let jobPage: Page | null = null;
    const trackingKey = `${jobId}_${Date.now()}`;

    try {
      jobPage = await this.context.newPage();
      this.activeJobPages.set(trackingKey, { page: jobPage, jobId, createdAt: Date.now() });

      // Track ONLY child popups opened by this specific generation tab
      const popupTracker = (popup: Page) => {
        const childKey = `${jobId}_popup_${Date.now()}`;
        this.activeJobPages.set(childKey, { page: popup, jobId, createdAt: Date.now() });
        this.log.info('tab_lifecycle', `Popup tracked for job ${jobId}`, { popupKey: childKey });
        popup.once('close', () => {
          this.activeJobPages.delete(childKey);
        });
      };
      jobPage.on('popup', popupTracker);

      jobPage.once('close', () => {
        this.activeJobPages.delete(trackingKey);
      });

      await jobPage.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

      let url: string;
      if (flowUrl) {
        if (!flowUrl.includes('/project/')) {
          url = flowUrl;
        } else {
          url = this.config.flowUrlLocale
            ? `https://labs.google${this.config.flowUrlLocale}`
            : FLOW_BASE_URL;
        }
      } else {
        url = this.config.flowUrlLocale
          ? `https://labs.google${this.config.flowUrlLocale}`
          : FLOW_BASE_URL;
      }

      this.log.info('tab_lifecycle', `[Job ${jobId}] Created dedicated job tab, navigating to: ${url}`);

      await jobPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await jobPage.waitForSelector('button', { state: 'visible', timeout: 20000 }).catch(() => {});
      await jobPage.waitForTimeout(500);

      return jobPage;
    } catch (navErr) {
      this.log.warn('tab_lifecycle', `[Job ${jobId}] Navigation failure on job tab, closing tab immediately: ${(navErr as Error).message}`);
      if (jobPage && !jobPage.isClosed()) {
        await jobPage.close().catch(() => {});
      }
      this.activeJobPages.delete(trackingKey);
      throw navErr;
    } finally {
      releaseLock();
    }
  }

  /**
   * Closes a dedicated job tab and any child popups after asset persistence is complete (or on failure).
   * Ensures the persistent mainPage remains open so Chrome does not terminate.
   */
  async closeJobPage(jobIdOrPage?: string | Page): Promise<void> {
    try {
      const pagesToClose: Page[] = [];

      if (typeof jobIdOrPage === 'string') {
        const targetJobId = jobIdOrPage;
        for (const [key, entry] of Array.from(this.activeJobPages.entries())) {
          if (entry.jobId === targetJobId) {
            pagesToClose.push(entry.page);
            this.activeJobPages.delete(key);
          }
        }
      } else if (jobIdOrPage) {
        const targetPage = jobIdOrPage;
        pagesToClose.push(targetPage);
        for (const [key, entry] of Array.from(this.activeJobPages.entries())) {
          if (entry.page === targetPage) {
            this.activeJobPages.delete(key);
          }
        }
      }

      for (const p of pagesToClose) {
        if (p === this.mainPage) {
          this.log.warn('tab_lifecycle', 'Attempted to close main profile page; preserving main page');
          continue;
        }
        if (!p.isClosed()) {
          this.log.info('tab_lifecycle', 'Closing dedicated disposable generation tab', { url: p.url().substring(0, 100) });
          await p.close().catch(() => {});
        }
      }
    } catch (err) {
      this.log.debug('tab_lifecycle', `Error closing job page: ${(err as Error).message}`);
    }
  }

  /**
   * Scans browser context and safely closes all tabs that are neither the main profile page
   * nor actively tracked for an in-flight job.
   */
  async cleanupOrphanedJobPages(): Promise<number> {
    if (!this.context) return 0;
    let closed = 0;
    try {
      const allPages = this.context.pages();
      const activePages = new Set(Array.from(this.activeJobPages.values()).map((e) => e.page));

      for (const p of allPages) {
        if (p === this.mainPage) continue;
        if (activePages.has(p)) continue;
        if (!p.isClosed()) {
          this.log.info('tab_lifecycle', 'Closing orphaned untracked generation tab', { url: p.url().substring(0, 100) });
          await p.close().catch(() => {});
          closed++;
        }
      }
    } catch (err) {
      this.log.debug('tab_lifecycle', `Error during orphan cleanup: ${(err as Error).message}`);
    }
    return closed;
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

  /** True if the session is connected, authenticated, and has an active usable page. */
  get isReady(): boolean {
    if (this._status !== 'ready') return false;
    if (this.chromeProcess && !this.isProcessAlive()) return false;
    if (this.browser && typeof this.browser.isConnected === 'function' && !this.browser.isConnected()) return false;
    return true;
  }

  /** True if the session is able to accept automation jobs. */
  get canAcceptJob(): boolean {
    return this.isReady;
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
   */
  async hideWindowFromTaskbar(page?: Page): Promise<void> {
    const targetPage = page && !page.isClosed() ? page : (this.page && !this.page.isClosed() ? this.page : this.context?.pages()[0]);

    // Native CDP window minimization (instant, cross-platform, zero process overhead, preserves CDP connection)
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
  }

  // ---------------------------------------------------------------------------
  // Private: Browser and Page event management & auto-recovery
  // ---------------------------------------------------------------------------

  private attachBrowserListeners(browser: Browser): void {
    if (typeof (browser as any)?.on === 'function') {
      (browser as any).on('disconnected', () => {
        this.log.warn('session', 'Playwright browser connection disconnected');
        this.cleanupPlaywrightObjects();
        if (this._status !== 'stopping' && this._status !== 'stopped' && this._status !== 'created') {
          this.setStatus(this.isProcessAlive() ? 'connection_error' : 'stopped');
        }
      });
    }
  }

  private attachMainPageListeners(page: Page): void {
    if (typeof (page as any)?.once === 'function') {
      (page as any).once('close', async () => {
        this.log.warn('session', 'Main profile page was closed; attempting recovery');
        if (this.page === page) this.page = null;
        if (this.mainPage === page) this.mainPage = null;
        if (this._status === 'ready' || this._status === 'busy' || this._status === 'connected') {
          try {
            await this.recoverMainPage();
          } catch (err) {
            this.log.error('session', 'Failed to recover main profile page', { error: (err as Error).message });
            this.setStatus('connection_error');
          }
        }
      });
    }
  }

  private async recoverMainPage(): Promise<Page> {
    if (this.isRecoveringMainPage) {
      this.log.info('session', 'Main page recovery already in progress; waiting for completion');
      const start = Date.now();
      while (this.isRecoveringMainPage && Date.now() - start < 5000) {
        await delay(200);
      }
      if (this.mainPage && !this.mainPage.isClosed()) return this.mainPage;
    }

    this.isRecoveringMainPage = true;
    try {
      if (this.mainPage && !this.mainPage.isClosed()) {
        return this.mainPage;
      }

      if (!this.context || !this.browser || !this.browser.isConnected()) {
        return await this.connectToRunningBrowser();
      }

      const nonJobPages = this.context.pages().filter((p) => !p.isClosed() && !this.isJobPage(p));
      let recoveredPage: Page;
      if (nonJobPages.length > 0) {
        recoveredPage = nonJobPages[0];
      } else {
        recoveredPage = await this.context.newPage();
        const targetUrl = this.config.flowUrlLocale
          ? `https://labs.google${this.config.flowUrlLocale}`
          : FLOW_BASE_URL;
        await recoveredPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      }

      this.mainPage = recoveredPage;
      this.page = recoveredPage;
      this.attachMainPageListeners(recoveredPage);

      // In dedicated profile sessions, enforce single-tab invariant: close any extraneous non-job tabs
      if (!this.isExistingBrowser && this.config.connectionMode !== 'existing_chrome') {
        const remaining = this.context.pages().filter((p) => !p.isClosed() && p !== this.mainPage && !this.isJobPage(p));
        for (const extraPage of remaining) {
          this.log.info('tab_lifecycle', 'Closing extraneous non-job tab to maintain single-tab invariant', { url: extraPage.url().substring(0, 100) });
          await extraPage.close().catch(() => {});
        }
      }

      this.log.info('session', 'Main profile page successfully recovered', { url: recoveredPage.url() });
      return recoveredPage;
    } finally {
      this.isRecoveringMainPage = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Chrome launch
  // ---------------------------------------------------------------------------

  private async launchChrome(headless: boolean, background = true): Promise<void> {
    const { chromePath, cdpPort } = this.config;

    // If an app-managed Flow profile is already running on this port, connect to it
    try {
      await probeCdpPort(cdpPort);
      this.log.info('chrome_launch', `CDP port ${cdpPort} is already active. Attaching to existing profile session.`);
      this.setStatus('chrome_launched');
      return;
    } catch {
      // Not yet active; proceed with launching fresh dedicated Chrome process
    }

    const effectiveUserData = this.config.userDataDir;
    const effectiveProfileDir = this.config.chromeProfileName || 'Default';

    // Verify paths
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Chrome not found at: ${chromePath}`);
    }

    // If existing_chrome, ensure the dedicated directory is seeded with the latest session data
    if (this.config.connectionMode === 'existing_chrome' && this.config.localUserDataDir && this.config.localProfileDirectory) {
      LocalChromeProfileDiscoverer.seedDedicatedUserDataDir(
        this.config.localUserDataDir,
        this.config.localProfileDirectory,
        effectiveUserData
      );
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
      // Off-screen headed mode: Keeps full WebGL/Canvas/DOM rendering while running completely off-screen
      flags.push('--window-position=-32000,-32000');
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
      windowsHide: background,
    });

    if (!chromeProcess.pid) {
      throw new Error(`Failed to spawn Chrome (no PID assigned). Path: ${chromePath}`);
    }

    this.chromeProcess = chromeProcess;
    this.launchedAt = Date.now();
    this.setStatus('chrome_launched');

    // Immediately enforce Win32 hidden window and toolwindow attributes on Windows
    if (background && process.platform === 'win32') {
      this.hideWindowFromTaskbar().catch(() => {});
    }

    this.log.info('chrome_launch', 'Chrome spawned', { pid: chromeProcess.pid, cdpPort });

    // Pipe Chrome stderr to our log file so diagnostics are available
    chromeProcess.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.log.debug('chrome_stderr', line);
      }
    });

    // Set up exit detection
    chromeProcess.once('exit', (code, signal) => {
      this.stopPostLoginWatcher();
      this.cleanupPlaywrightObjects();
      this.chromeProcess = null;

      if (this._status === 'stopping' || this._status === 'stopped' || this._status === 'created') {
        return;
      }

      this.log.info('chrome_exit', 'Chrome process closed', { code, signal, pid: chromeProcess.pid });
      this.setStatus('stopped');
      this.errorMessage = null;
      this.emit('status_change', this.getSnapshot());
    });

    // Poll the CDP port until Chrome is ready
    this.setStatus('waiting_for_cdp');
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

    this.setStatus('connection_error');
    this.errorMessage = `CDP port ${port} did not open after ${CDP_PROBE_MAX_ATTEMPTS} attempts. Chrome may have failed to start or the port is blocked.`;
    throw new Error(this.errorMessage);
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
        timeout: 25000,
      });
      this.attachBrowserListeners(this.browser);
    } catch (err) {
      const fallbackStatus = (this.chromeProcess && this.isProcessAlive()) ? 'connection_error' : 'error';
      this.setStatus(fallbackStatus);
      this.errorMessage = `Playwright CDP connection failed on port ${cdpPort}: ${(err as Error).message}`;
      throw new Error(this.errorMessage);
    }

    // Use the first existing browser context, or create one
    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? await this.browser.newContext();

    this.setStatus('creating_page');

    if (this.isExistingBrowser || this.config.connectionMode === 'existing_chrome') {
      // CRITICAL REQUIREMENT 5: Always create a NEW tab in the existing browser.
      // NEVER navigate or close existing tabs!
      this.page = await this.context.newPage();
      this.mainPage = this.page;
      this.attachMainPageListeners(this.page);
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
      this.mainPage = this.page;
      this.attachMainPageListeners(this.page);

      // Prune extraneous restored tabs for dedicated profiles to enforce the single-tab idle invariant
      for (const p of pages) {
        if (p !== this.mainPage && !this.isJobPage(p)) {
          try {
            await p.close();
            this.log.info('tab_lifecycle', 'Closed extraneous restored tab on startup to enforce 1-tab invariant');
          } catch {
            /* ignore */
          }
        }
      }
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

    let result = await FlowAuthDetector.navigateAndCheck(
      this.page,
      this.config.flowUrlLocale
        ? `https://labs.google${this.config.flowUrlLocale}`
        : FLOW_BASE_URL,
      this.profileId,
    );

    if (result.state === 'loading') {
      const startPoll = Date.now();
      while (Date.now() - startPoll < 15000) {
        await delay(1000);
        result = await FlowAuthDetector.check(this.page, this.profileId);
        if (result.state !== 'loading') break;
      }
    }

    this.flowUrl = result.url;
    this.detectedEmail = result.detectedEmail ?? this.detectedEmail;

    switch (result.state) {
      case 'authenticated':
        this.setStatus('ready');
        this.emit('status_change', this.getSnapshot());
        this.stopPostLoginWatcher();
        this.log.info('auth', 'Flow authenticated and ready', {
          email: this.detectedEmail,
          locale: result.locale,
        });
        // Ensure the Chrome window is hidden from taskbar and off-screen
        await this.hideWindowFromTaskbar(this.page).catch(() => {});
        break;

      case 'login_required':
      case 'captcha':
        this.setStatus('auth_required');
        this.emit('status_change', this.getSnapshot());
        this.log.info('auth', 'Login or CAPTCHA required — waiting for user to sign in');
        if (this.context && this.page) {
          try {
            if (typeof (this.context as any).newCDPSession === 'function') {
              const cdp = await (this.context as any).newCDPSession(this.page);
              const { windowId } = await cdp.send('Browser.getWindowForTarget');
              await cdp.send('Browser.setWindowBounds', {
                windowId,
                bounds: { windowState: 'normal', left: 100, top: 100, width: 1280, height: 900 },
              });
              await cdp.detach().catch(() => {});
            }
          } catch {
            // Non-fatal if CDP window bounds not supported
          }
        }
        this.startPostLoginWatcher();
        break;

      case 'loading':
      case 'unknown':
        this.setStatus('connection_error');
        this.errorMessage = `Unable to verify Flow authentication (state: ${result.state}).`;
        this.log.warn('auth', `Indeterminate auth state: ${result.state}; set connection_error`);
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
    this.stopPostLoginWatcher();

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
    this.stopPostLoginWatcher();
    this.activeJobPages.clear();
    this.mainPage = null;

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
