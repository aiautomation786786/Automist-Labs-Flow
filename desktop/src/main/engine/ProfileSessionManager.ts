/**
 * ProfileSessionManager – Manages multiple independent ProfileSession instances.
 *
 * This is the top-level orchestrator for Phase 1. It:
 *  - Maintains a Map<profileId, ProfileSession> collection.
 *  - Owns the ChromePortAllocator singleton.
 *  - Delegates to ProfileConfigManager for persistence.
 *  - Exposes a typed EventEmitter interface for session lifecycle events.
 *  - Provides the API surface that Phase 4+ Electron IPC handlers will call.
 *
 * ISOLATION GUARANTEE:
 *  Each profile's Browser, BrowserContext, and Page are owned exclusively by
 *  that profile's ProfileSession instance. The manager never shares these across
 *  profiles.
 */

import { EventEmitter } from 'events';
import type {
  ProfileConfig,
  ProfileSessionSnapshot,
  ProfileSessionStatus,
} from '../../shared/types';
import { ProfileSession, probeCdpPort } from './ProfileSession';
import { ProfileConfigManager } from './ProfileConfig';
import { ChromePortAllocator } from './ChromePortAllocator';
import { WindowsChromeFinder } from './WindowsChromeFinder';
import { LocalChromeProfileDiscoverer } from './LocalChromeProfileDiscoverer';
import { appLogger } from '../utils/AppLogger';

// ---------------------------------------------------------------------------
// Manager events
// ---------------------------------------------------------------------------

export interface ManagerEventMap {
  /** Emitted whenever any session changes status. */
  'session:status': [snapshot: ProfileSessionSnapshot];
  /** Emitted when a session needs user sign-in. */
  'session:auth_required': [profileId: string];
  /** Emitted when a session is ready for automation. */
  'session:ready': [profileId: string];
  /** Emitted on unrecoverable error. */
  'session:error': [profileId: string, message: string];
  /** Emitted on Chrome crash. */
  'session:crash': [profileId: string];
  /** Emitted when a profile is created. */
  'profile:created': [config: ProfileConfig];
  /** Emitted when a profile is deleted. */
  'profile:deleted': [profileId: string];
}

// ---------------------------------------------------------------------------
// ProfileSessionManager class
// ---------------------------------------------------------------------------

export class ProfileSessionManager extends EventEmitter<ManagerEventMap> {
  private readonly sessions = new Map<string, ProfileSession>();
  private readonly portAllocator: ChromePortAllocator;
  private chromePath: string;

  constructor(options: {
    portAllocator?: ChromePortAllocator;
    chromePath?: string;
  } = {}) {
    super();

    this.portAllocator = options.portAllocator ?? new ChromePortAllocator();

    // Resolve Chrome path: use provided path, or auto-discover
    if (options.chromePath) {
      if (!WindowsChromeFinder.verifyPath(options.chromePath)) {
        throw new Error(`Provided Chrome path does not exist: ${options.chromePath}`);
      }
      this.chromePath = options.chromePath;
    } else {
      this.chromePath = WindowsChromeFinder.findOrThrow();
    }

    appLogger.info('session_manager', 'ProfileSessionManager initialized', {
      chromePath: this.chromePath,
    });
  }

  // ---------------------------------------------------------------------------
  // Profile lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates a new profile (persists it) and optionally starts it immediately.
   *
   * @param displayName   Human-readable name for this profile.
   * @param autoStart     If true, starts the session after creation.
   * @param headless      Launch Chrome headless (for testing only).
   */
  async createProfile(params: {
    displayName: string;
    autoStart?: boolean;
    headless?: boolean;
    notes?: string;
    expectedEmail?: string;
  }): Promise<ProfileConfig> {
    // Use a stable temporary key for the port allocation.
    // We reassign to the real profileId immediately after the config is created.
    const tempKey = `pending_${process.hrtime.bigint().toString()}`;
    const cdpPort = await this.portAllocator.allocate(tempKey);

    const config = ProfileConfigManager.create({
      displayName: params.displayName,
      chromePath: this.chromePath,
      cdpPort,
      notes: params.notes,
      expectedEmail: params.expectedEmail,
    });

    // Move the allocation from the temp key to the real profileId.
    this.portAllocator.release(tempKey);
    this.portAllocator.setAllocation(config.profileId, cdpPort);

    appLogger.info('session_manager', 'Profile created', {
      profileId: config.profileId,
      displayName: config.displayName,
      expectedEmail: config.expectedEmail,
      cdpPort,
    });

    this.emit('profile:created', config);

    if (params.autoStart) {
      await this.startProfile(config.profileId, params.headless ?? false);
    }

    return config;
  }

  /**
   * Creates a new profile configured to attach to an existing local Chrome profile.
   */
  async createExistingChromeProfile(params: {
    displayName: string;
    localProfileDirectory: string;
    localUserDataDir?: string;
    expectedEmail?: string;
    notes?: string;
    preferredCdpPort?: number;
    autoStart?: boolean;
  }): Promise<ProfileConfig> {
    const userDataDir = params.localUserDataDir || LocalChromeProfileDiscoverer.discoverChromeUserDataDir() || '';
    const tempKey = `pending_${process.hrtime.bigint().toString()}`;
    const cdpPort = params.preferredCdpPort ?? await this.portAllocator.allocate(tempKey);

    const config = ProfileConfigManager.create({
      displayName: params.displayName,
      chromePath: this.chromePath,
      cdpPort,
      notes: params.notes,
      expectedEmail: params.expectedEmail,
    });

    const updated = ProfileConfigManager.update(config.profileId, {
      connectionMode: 'existing_chrome',
      localProfileDirectory: params.localProfileDirectory,
      localUserDataDir: userDataDir,
      preferredCdpPort: cdpPort,
    });

    this.portAllocator.release(tempKey);
    this.portAllocator.setAllocation(config.profileId, cdpPort);

    this.emit('profile:created', updated);

    if (params.autoStart) {
      await this.startProfile(config.profileId, false);
    }

    return updated;
  }

  /**
   * Scans local Chrome profiles on Windows and checks their current runtime / lock status.
   */
  async detectLocalChromeProfiles(): Promise<Array<import('../../shared/types').DiscoveredLocalProfile & {
    isOpen: boolean;
    isAttachable: boolean;
    cdpPort?: number;
  }>> {
    const userDataDir = LocalChromeProfileDiscoverer.discoverChromeUserDataDir();
    if (!userDataDir) return [];

    const discovered = LocalChromeProfileDiscoverer.scanProfiles(userDataDir);
    const results: Array<import('../../shared/types').DiscoveredLocalProfile & {
      isOpen: boolean;
      isAttachable: boolean;
      cdpPort?: number;
    }> = [];

    for (const p of discovered) {
      const state = await LocalChromeProfileDiscoverer.detectProfileState({
        userDataDir,
        profileDirectory: p.profileDirectory,
        email: p.accountEmail ?? undefined,
        displayName: p.profileDisplayName,
      });

      results.push({
        ...p,
        isOpen: state.state === 'open_and_attachable' || state.state === 'open_not_attachable',
        isAttachable: state.state === 'open_and_attachable',
        cdpPort: state.cdpPort,
      });
    }

    return results;
  }

  /**
   * Detects the runtime / lock state of a specific target Chrome profile.
   */
  async detectExistingProfileState(profileIdOrTarget: string | {
    userDataDir?: string;
    profileDirectory?: string;
    email?: string;
    displayName?: string;
    preferredCdpPort?: number;
  }): Promise<import('../../shared/types').ExistingProfileDetectionResult> {
    if (typeof profileIdOrTarget === 'string') {
      const config = ProfileConfigManager.read(profileIdOrTarget);
      return await LocalChromeProfileDiscoverer.detectProfileState({
        userDataDir: config.localUserDataDir,
        profileDirectory: config.localProfileDirectory,
        displayName: config.displayName,
        email: config.expectedEmail ?? undefined,
        preferredCdpPort: config.preferredCdpPort ?? config.cdpPort,
      });
    }
    return await LocalChromeProfileDiscoverer.detectProfileState(profileIdOrTarget);
  }

  /**
   * Starts an existing profile session (launches Chrome + connects Playwright).
   *
   * @param profileId  The profile to start.
   * @param headless   Launch Chrome headless.
   */
  async startProfile(profileId: string, headless = false): Promise<void> {
    const config = ProfileConfigManager.read(profileId);

    // Reuse existing session object if possible
    let session = this.sessions.get(profileId);

    if (session && session.status !== 'stopped' && session.status !== 'error') {
      if (session.status === 'browser_open' || (session.isProcessAlive() && !session.getPage())) {
        appLogger.info('session_manager', 'Connecting to existing running session', { profileId });
        await session.connectToRunningBrowser();
        await session.verifyAuth();
        return;
      }
      appLogger.warn('session_manager', 'Profile already running', {
        profileId,
        status: session.status,
      });
      return;
    }

    // Ensure port is allocated
    const existingPort = this.portAllocator.getPort(profileId);
    if (!existingPort) {
      // Allocate the port stored in the profile config
      const available = await this.portAllocator.allocate(profileId);
      if (available !== config.cdpPort) {
        // Port stored in profile config is taken; update config with new port
        const updatedConfig = ProfileConfigManager.update(profileId, { cdpPort: available });
        appLogger.warn('session_manager', 'CDP port conflict — assigned new port', {
          profileId,
          oldPort: config.cdpPort,
          newPort: available,
        });
        Object.assign(config, updatedConfig);
      }
    }

    // Check if Chrome is already active on the configured CDP port
    let isPortActive = false;
    try {
      await probeCdpPort(config.cdpPort);
      isPortActive = true;
    } catch {
      isPortActive = false;
    }

    session = new ProfileSession(config);
    this.sessions.set(profileId, session);
    this.attachSessionEvents(session);

    if (isPortActive) {
      appLogger.info('session_manager', 'CDP port already active; attaching to running Chrome', { profileId, port: config.cdpPort });
      await session.connectToRunningBrowser();
      await session.verifyAuth();
      return;
    }

    appLogger.info('session_manager', 'Starting profile', { profileId, headless });

    // Non-blocking start; session events will update callers
    await session.start(headless);
  }

  /**
   * Stops a running profile session.
   */
  async stopProfile(profileId: string): Promise<void> {
    const session = this.sessions.get(profileId);

    if (!session) {
      appLogger.warn('session_manager', 'stopProfile called on unknown profile', { profileId });
      return;
    }

    await session.stop();
    this.portAllocator.release(profileId);
    appLogger.info('session_manager', 'Profile stopped', { profileId });
  }

  /**
   * Restarts a profile session (stop + start).
   */
  async restartProfile(profileId: string, headless = false): Promise<void> {
    const session = this.sessions.get(profileId);

    if (!session) {
      // Profile exists in storage but has no active session; start fresh
      await this.startProfile(profileId, headless);
      return;
    }

    await session.restart(headless);
  }

  /**
   * Automatically starts and reconnects all configured profiles in background mode on app launch.
   * Performs an internal auth health check so profiles with valid Google cookies become 'ready' (● Ready)
   * without requiring manual "Verify Account" or user browser interaction.
   */
  async autoStartProfiles(): Promise<void> {
    const profiles = ProfileConfigManager.list();
    if (profiles.length === 0) {
      appLogger.info('session_manager', 'No configured profiles to auto-start');
      return;
    }

    appLogger.info('session_manager', `Auto-starting ${profiles.length} background profile sessions...`);

    for (const config of profiles) {
      try {
        let session = this.sessions.get(config.profileId);
        if (!session) {
          const existingPort = this.portAllocator.getPort(config.profileId);
          if (!existingPort) {
            this.portAllocator.setAllocation(config.profileId, config.cdpPort);
          }
          session = new ProfileSession(config);
          this.sessions.set(config.profileId, session);
          this.attachSessionEvents(session);
        }

        if (session.isReady || session.status === 'busy') continue;

        // Auto-start in background off-screen mode
        await session.start({ headless: false, background: true });
        appLogger.info('session_manager', `Profile ${config.profileId} auto-start finished with status: ${session.status}`);
      } catch (err) {
        appLogger.warn('session_manager', `Auto-start notice for ${config.profileId}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Stops all active sessions and releases all resources.
   * Should be called when the application is shutting down.
   */
  async stopAll(): Promise<void> {
    appLogger.info('session_manager', `Stopping all sessions (${this.sessions.size} active)`);

    const stopPromises = Array.from(this.sessions.keys()).map((id) =>
      this.stopProfile(id).catch((err) => {
        appLogger.error('session_manager', `Error stopping profile ${id}`, err as Error);
      }),
    );

    await Promise.all(stopPromises);
    appLogger.info('session_manager', 'All sessions stopped');
  }

  // ---------------------------------------------------------------------------
  // Profile deletion
  // ---------------------------------------------------------------------------

  /**
   * Permanently deletes a profile (stops it first if running).
   *
   * WARNING: This deletes the Chrome user-data directory, removing all
   * cookies, cached sessions, and local storage for this profile.
   * The caller MUST confirm with the user before calling.
   */
  async deleteProfile(profileId: string): Promise<void> {
    // Stop first
    const session = this.sessions.get(profileId);
    if (session && session.status !== 'stopped' && session.status !== 'error') {
      await this.stopProfile(profileId);
    }

    // Remove from active sessions map
    this.sessions.delete(profileId);
    this.portAllocator.release(profileId);

    // Delete from disk
    ProfileConfigManager.delete(profileId);

    appLogger.info('session_manager', 'Profile deleted', { profileId });
    this.emit('profile:deleted', profileId);
  }

  // ---------------------------------------------------------------------------
  // Account & Authentication Actions (Phase 5.3+)
  // ---------------------------------------------------------------------------

  /**
   * Launches the dedicated Chrome login browser for manual Google sign-in.
   *
   * FAST PATH — returns as soon as the OS process PID is confirmed.
   * Does NOT wait for CDP, Playwright, or auth detection.
   * The Chrome window stays open on the user's desktop.
   *
   * SAFETY: Only the application-owned dedicated profile is touched.
   * Normal Chrome processes are never killed or modified.
   */
  async launchLoginBrowser(profileId: string): Promise<{
    success: boolean;
    pid: number;
    cdpPort: number;
    userDataDir: string;
    message: string;
  }> {
    const config = ProfileConfigManager.read(profileId);

    // Reuse or create a session object
    let session = this.sessions.get(profileId);
    if (!session) {
      // Ensure port is allocated
      const existingPort = this.portAllocator.getPort(profileId);
      if (!existingPort) {
        const available = await this.portAllocator.allocate(profileId);
        if (available !== config.cdpPort) {
          const updatedConfig = ProfileConfigManager.update(profileId, { cdpPort: available });
          Object.assign(config, updatedConfig);
        }
      }
      session = new ProfileSession(config);
      this.sessions.set(profileId, session);
      this.attachSessionEvents(session);
    }

    appLogger.info('session_manager', 'launchLoginBrowser: launching dedicated Chrome for login', {
      profileId,
      cdpPort: config.cdpPort,
      userDataDir: config.userDataDir,
    });

    const result = await session.launchLoginBrowser();

    return {
      success: true,
      pid: result.pid,
      cdpPort: result.cdpPort,
      userDataDir: result.userDataDir,
      message: `Chrome opened — Sign into Google in the Flow window. (PID: ${result.pid}, port: ${result.cdpPort})`,
    };
  }

  /**
   * Opens or activates Google Flow in the dedicated browser.
   * If Chrome is already running, reconnects to it and brings Flow tab to front.
   */
  async openSignIn(profileId: string): Promise<ProfileSessionSnapshot> {
    const config = ProfileConfigManager.read(profileId);
    let session = this.sessions.get(profileId);
    if (!session) {
      const existingPort = this.portAllocator.getPort(profileId);
      if (!existingPort) {
        this.portAllocator.setAllocation(profileId, config.cdpPort);
      }
      session = new ProfileSession(config);
      this.sessions.set(profileId, session);
      this.attachSessionEvents(session);
    }

    let isRunning = session.isProcessAlive();
    if (!isRunning) {
      try {
        await probeCdpPort(config.cdpPort);
        isRunning = true;
      } catch {
        isRunning = false;
      }
    }

    if (isRunning) {
      // Reconnect to existing browser and reuse/open Flow tab
      const page = await session.connectToRunningBrowser();
      await page.bringToFront().catch(() => {});
      return session.getSnapshot();
    }

    // Otherwise do a full start
    await session.start(false);
    return session.getSnapshot();
  }

  /**
   * Activates or opens Google Flow for an account.
   * Reconnects to running dedicated browser without spawning duplicate instances.
   */
  async openFlow(profileId: string): Promise<ProfileSessionSnapshot> {
    return this.openSignIn(profileId);
  }

  /**
   * Verifies the current Google Flow authentication state.
   *
   * Automatically reconnects to an already-running dedicated Chrome process
   * (e.g. launched via launchLoginBrowser) over CDP, finds the active Flow tab,
   * evaluates authentication via FlowAuthDetector, and updates status/metadata.
   */
  async verifyAccount(profileId: string): Promise<{
    success: boolean;
    status: ProfileSessionStatus;
    detectedEmail: string | null;
    error?: string;
  }> {
    const config = ProfileConfigManager.read(profileId);

    // 1. Get or instantiate session
    let session = this.sessions.get(profileId);
    if (!session) {
      const existingPort = this.portAllocator.getPort(profileId);
      if (!existingPort) {
        this.portAllocator.setAllocation(profileId, config.cdpPort);
      }
      session = new ProfileSession(config);
      this.sessions.set(profileId, session);
      this.attachSessionEvents(session);
    }

    // 2. Check if Chrome process is alive or CDP port is responsive
    const isPidAlive = session.isProcessAlive();
    let isPortActive = false;
    try {
      await probeCdpPort(config.cdpPort);
      isPortActive = true;
    } catch {
      isPortActive = false;
    }

    appLogger.info('session_manager', 'verifyAccount: Checking browser state', {
      profileId,
      pid: session.pid,
      pidAlive: isPidAlive,
      cdpPort: config.cdpPort,
      cdpPortActive: isPortActive,
      sessionStatus: session.status,
    });

    if (!isPidAlive && !isPortActive && session.status !== 'ready' && session.status !== 'connected' && session.status !== 'browser_open') {
      return {
        success: false,
        status: session.status,
        detectedEmail: null,
        error: 'Dedicated Chrome is not running. Click "Open Login" to launch it.',
      };
    }

    // 3. Connect to running browser & verify auth with defensive 12s timeout
    try {
      const verifyPromise = session.verifyAuth();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Verification timed out after 12s. Please ensure Google Flow is active in Chrome and click Verify again.')),
          12000,
        ),
      );
      const authResult = await Promise.race([verifyPromise, timeoutPromise]);

      // Diagnostic logging (Requirement 7)
      console.log(`[Diagnostic] PID alive: ${isPidAlive || isPortActive ? 'YES' : 'NO'} (PID: ${session.pid ?? 'attached'})`);
      console.log(`[Diagnostic] CDP port: ${config.cdpPort}`);
      console.log(`[Diagnostic] CDP endpoint: READY`);
      console.log(`[Diagnostic] Playwright attached: YES`);
      console.log(`[Diagnostic] Pages found: ${authResult.pagesCount}`);
      console.log(`[Diagnostic] Flow page found: ${authResult.flowPageFound ? 'YES' : 'NO'}`);
      console.log(`[Diagnostic] Flow URL: ${authResult.url}`);
      console.log(`[Diagnostic] Auth state: ${authResult.state}`);
      console.log(`[Diagnostic] Detected account: ${authResult.detectedEmail ?? 'none'}`);

      appLogger.info('session_manager', 'verifyAccount: Diagnostic summary', {
        pidAlive: isPidAlive || isPortActive,
        cdpPort: config.cdpPort,
        playwrightAttached: true,
        pagesFound: authResult.pagesCount,
        flowPageFound: authResult.flowPageFound,
        flowUrl: authResult.url,
        authState: authResult.state,
        detectedEmail: authResult.detectedEmail,
      });

      // Update persistent metadata if email or locale discovered
      if (authResult.detectedEmail || authResult.locale) {
        ProfileConfigManager.update(profileId, {
          ...(authResult.detectedEmail ? { detectedEmail: authResult.detectedEmail } : {}),
          ...(authResult.locale ? { flowUrlLocale: `/fx/${authResult.locale}/tools/flow` } : {}),
        });
      }

      this.emit('session:status', session.getSnapshot());
      if (authResult.state === 'authenticated') {
        this.emit('session:ready', profileId);
        // Explicitly hide the window from the taskbar after verification succeeds
        await session.hideWindowFromTaskbar().catch((err) => {
          appLogger.debug('session_manager', `Could not hide window after auth: ${(err as Error).message}`);
        });
      }

      return {
        success: authResult.state === 'authenticated',
        status: session.status,
        detectedEmail: authResult.detectedEmail ?? session.getSnapshot().detectedEmail,
        error: authResult.state === 'login_required' ? 'User sign-in required in Chrome window.' : undefined,
      };
    } catch (err) {
      appLogger.error('session_manager', `verifyAccount failed for ${profileId}`, err as Error);
      this.emit('session:status', session.getSnapshot());
      return {
        success: false,
        status: session.status,
        detectedEmail: session.getSnapshot().detectedEmail,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Tests CDP and browser responsiveness for a dedicated Flow profile.
   */
  async testConnection(profileId: string): Promise<{
    success: boolean;
    port: number;
    responsive: boolean;
    status: ProfileSessionStatus;
  }> {
    const config = ProfileConfigManager.read(profileId);
    const session = this.sessions.get(profileId);
    const port = session?.getSnapshot().cdpPort ?? config.cdpPort;

    try {
      await probeCdpPort(port);
      return {
        success: true,
        port,
        responsive: true,
        status: session ? session.status : 'stopped',
      };
    } catch {
      return {
        success: false,
        port,
        responsive: false,
        status: session ? session.status : 'stopped',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a live snapshot of all known profiles (active + inactive).
   * For inactive profiles, the snapshot reflects the persisted config but
   * no runtime state (status = 'stopped').
   */
  getAllProfiles(): ProfileSessionSnapshot[] {
    const diskProfiles = ProfileConfigManager.readAll();
    const snapshots: ProfileSessionSnapshot[] = [];

    for (const config of diskProfiles) {
      const session = this.sessions.get(config.profileId);

      if (session) {
        snapshots.push(session.getSnapshot());
      } else {
        // Synthesize a stopped snapshot from the persisted config
        snapshots.push({
          profileId: config.profileId,
          displayName: config.displayName,
          status: 'stopped',
          cdpPort: config.cdpPort,
          chromePath: config.chromePath,
          detectedEmail: config.detectedEmail,
          expectedEmail: config.expectedEmail ?? null,
          flowUrl: null,
          errorMessage: null,
          lastStatusChange: config.updatedAt,
          uptimeMs: 0,
          connectionMode: config.connectionMode ?? 'dedicated_flow_browser',
          connectionState: 'profile_closed',
          localProfileDirectory: config.localProfileDirectory,
        });
      }
    }

    return snapshots;
  }

  /**
   * Returns the active ProfileSession for a profile, or null.
   */
  getSession(profileId: string): ProfileSession | null {
    return this.sessions.get(profileId) ?? null;
  }

  /**
   * Returns all sessions in the given status.
   */
  getSessionsByStatus(status: ProfileSessionStatus): ProfileSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === status);
  }

  /**
   * Returns all profiles that are ready to accept automation jobs.
   */
  getReadySessions(): ProfileSession[] {
    return this.getSessionsByStatus('ready');
  }

  /**
   * Number of currently active (non-stopped, non-error) sessions.
   */
  get activeCount(): number {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status !== 'stopped' && s.status !== 'error'
    ).length;
  }

  // ---------------------------------------------------------------------------
  // Private: Event relay
  // ---------------------------------------------------------------------------

  private attachSessionEvents(session: ProfileSession): void {
    const id = session.profileId;

    session.on('status_change', (snapshot) => {
      this.emit('session:status', snapshot);

      if (snapshot.status === 'ready') {
        this.emit('session:ready', id);
      } else if (snapshot.status === 'auth_required') {
        this.emit('session:auth_required', id);
      } else if (snapshot.status === 'error') {
        this.emit('session:error', id, snapshot.errorMessage ?? 'Unknown error');
      }
    });

    session.on('crash', (profileId) => {
      this.emit('session:crash', profileId);
    });

    session.on('error', (profileId, message) => {
      this.emit('session:error', profileId, message);
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (convenience export for simple single-process use)
// ---------------------------------------------------------------------------

/** Singleton manager for the main Electron process. */
let _defaultManager: ProfileSessionManager | null = null;

/**
 * Returns the default ProfileSessionManager, creating it on first call.
 * Chrome path is auto-discovered.
 */
export function getDefaultManager(): ProfileSessionManager {
  if (!_defaultManager) {
    _defaultManager = new ProfileSessionManager();
  }
  return _defaultManager;
}
