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
  ProfileConnectionProgress,
  ProfileConnectionResult,
  ProfileConnectionStage,
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
  /** Emitted during profile connection onboarding progress. */
  'profile:connection_progress': [progress: ProfileConnectionProgress];
}

// ---------------------------------------------------------------------------
// ProfileSessionManager class
// ---------------------------------------------------------------------------

export class ProfileSessionManager extends EventEmitter<ManagerEventMap> {
  private readonly sessions = new Map<string, ProfileSession>();
  private readonly portAllocator: ChromePortAllocator;
  private readonly profileOperationLocks = new Map<string, Promise<any>>();
  private readonly inFlightVerifications = new Map<
    string,
    Promise<{
      success: boolean;
      status: ProfileSessionStatus;
      detectedEmail: string | null;
      error?: string;
    }>
  >();
  private chromePath: string;

  private async withProfileLock<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.profileOperationLocks.get(profileId);
    if (existing) {
      await existing.catch(() => {});
    }
    const promise = fn();
    this.profileOperationLocks.set(profileId, promise);
    try {
      return await promise;
    } finally {
      if (this.profileOperationLocks.get(profileId) === promise) {
        this.profileOperationLocks.delete(profileId);
      }
    }
  }

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

    // Pre-register all persisted profile port allocations to ensure port isolation across manager lifetime
    try {
      const persisted = ProfileConfigManager.list();
      for (const p of persisted) {
        if (p.profileId && p.cdpPort) {
          this.portAllocator.setAllocation(p.profileId, p.cdpPort);
        }
      }
    } catch {
      // Ignore if profiles directory has not been initialized yet
    }
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
    // 1. Deduplication check: if canonical profile already exists with matching email, reuse it
    if (params.expectedEmail) {
      const normEmail = params.expectedEmail.trim().toLowerCase();
      const existing = ProfileConfigManager.list().find(
        (p) =>
          (p.expectedEmail && p.expectedEmail.trim().toLowerCase() === normEmail) ||
          (p.detectedEmail && p.detectedEmail.trim().toLowerCase() === normEmail)
      );
      if (existing) {
        appLogger.info('session_manager', 'Profile with this email already exists; returning canonical profile', {
          profileId: existing.profileId,
          email: normEmail,
        });
        if (params.autoStart) {
          await this.startProfile(existing.profileId, params.headless ?? false);
        }
        return existing;
      }
    }

    // 2. Use a stable temporary key for the port allocation.
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

    // Seed session data from existing local Chrome profile so authenticated session is preserved
    if (userDataDir && params.localProfileDirectory) {
      LocalChromeProfileDiscoverer.seedDedicatedUserDataDir(
        userDataDir,
        params.localProfileDirectory,
        config.userDataDir
      );
    }

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
   * Connects an existing local Chrome profile using the fast-path background verification flow:
   * 1. Preparing profile (creates config & allocates port)
   * 2. Copying account session (seeds cookies, local storage, indexedDB; skips disposable caches)
   * 3. Checking existing login (spawns headless Chrome --headless=new)
   * 4. Connecting to Google Flow (checks auth state in background)
   * 5. Finalizing account (if valid auth -> 'ready' & terminates background Chrome; if auth required -> launches visible login window)
   */
  async connectExistingChromeProfile(
    params: {
      displayName: string;
      localProfileDirectory: string;
      localUserDataDir?: string;
      expectedEmail?: string;
      notes?: string;
      preferredCdpPort?: number;
    },
    onProgress?: (progress: ProfileConnectionProgress) => void
  ): Promise<ProfileConnectionResult> {
    const connectStartTime = Date.now();
    let profileId = '';

    const emitProg = (
      stage: ProfileConnectionStage,
      message: string,
      progress: number,
      extra: Partial<ProfileConnectionProgress> = {}
    ) => {
      const payload: ProfileConnectionProgress = {
        profileId,
        stage,
        message,
        progress,
        displayName: params.displayName,
        ...extra,
      };
      this.emit('profile:connection_progress', payload);
      onProgress?.(payload);
    };

    try {
      // -----------------------------------------------------------------------
      // Stage 1: Preparing profile
      // -----------------------------------------------------------------------
      emitProg('preparing', 'Preparing profile configuration...', 10);
      const prepStart = Date.now();

      const userDataDir = params.localUserDataDir || LocalChromeProfileDiscoverer.discoverChromeUserDataDir() || '';
      const tempKey = `pending_${process.hrtime.bigint().toString()}`;
      const cdpPort = params.preferredCdpPort ?? (await this.portAllocator.allocate(tempKey));

      const config = ProfileConfigManager.create({
        displayName: params.displayName,
        chromePath: this.chromePath,
        cdpPort,
        notes: params.notes,
        expectedEmail: params.expectedEmail,
      });
      profileId = config.profileId;
      appLogger.info('session_manager', `Profile record created in ${Date.now() - prepStart} ms for '${profileId}'`);
      emitProg('preparing', 'Profile environment prepared', 20);

      // -----------------------------------------------------------------------
      // Stage 2: Copying account session
      // -----------------------------------------------------------------------
      emitProg('copying_session', 'Copying authenticated Google session data...', 35);
      const seedStart = Date.now();

      if (userDataDir && params.localProfileDirectory) {
        LocalChromeProfileDiscoverer.seedDedicatedUserDataDir(
          userDataDir,
          params.localProfileDirectory,
          config.userDataDir
        );
      }
      appLogger.info('session_manager', `Profile seed completed in ${Date.now() - seedStart} ms for '${profileId}'`);

      const updated = ProfileConfigManager.update(config.profileId, {
        connectionMode: 'existing_chrome',
        localProfileDirectory: params.localProfileDirectory,
        localUserDataDir: userDataDir,
        preferredCdpPort: cdpPort,
      });

      this.portAllocator.release(tempKey);
      this.portAllocator.setAllocation(config.profileId, cdpPort);
      this.emit('profile:created', updated);
      emitProg('copying_session', 'Session data copied successfully', 45);

      // -----------------------------------------------------------------------
      // Stage 3: Checking existing login
      // -----------------------------------------------------------------------
      emitProg('checking_auth', 'Checking existing Google login...', 55);

      let session = this.sessions.get(profileId);
      if (!session) {
        session = new ProfileSession(updated);
        this.sessions.set(profileId, session);
        this.attachSessionEvents(session);
      }

      // -----------------------------------------------------------------------
      // Stage 4: Connecting to Google Flow (Background Headless Verification)
      // -----------------------------------------------------------------------
      emitProg('connecting_flow', 'Connecting to Google Flow in background...', 70);
      const verifyStart = Date.now();

      const authResult = await session.verifyAuthBackground();
      appLogger.info('session_manager', `Background verification completed in ${Date.now() - verifyStart} ms for '${profileId}' (state: ${authResult.state})`);

      // -----------------------------------------------------------------------
      // Stage 5: Finalizing account / Handling outcome
      // -----------------------------------------------------------------------
      if (authResult.state === 'authenticated') {
        emitProg('finalizing', 'Finalizing account connection...', 90);

        if (authResult.detectedEmail || authResult.locale) {
          this.persistDiscoveredMetadata(profileId, updated, authResult);
        }

        session.isVerifiedInCurrentProcess = true;
        session.setStatus('ready');
        this.emit('session:ready', profileId);
        this.emit('session:status', session.getSnapshot());

        const totalMs = Date.now() - connectStartTime;
        appLogger.info('session_manager', `Connection completed in ${totalMs} ms for '${profileId}'`);

        const detectedEmail = authResult.detectedEmail ?? session.getSnapshot().detectedEmail;
        emitProg('success', 'Connected successfully ✓', 100, { detectedEmail });

        return {
          success: true,
          profileId,
          status: 'ready',
          detectedEmail,
        };
      } else {
        // Sign-in genuinely required: transition progress and launch interactive visible Chrome
        emitProg('auth_required', 'Google sign-in required. Opening secure Chrome window...', 75);
        appLogger.info('session_manager', `Existing profile '${profileId}' requires interactive sign-in; opening login browser`);

        await session.launchLoginBrowser();
        emitProg('waiting_for_user', 'Waiting for you to complete Google sign-in...', 80);

        // Listen for post-login completion on the session to advance progress
        const onSessionReady = (readyId: string) => {
          if (readyId === profileId) {
            this.off('session:ready', onSessionReady);
            emitProg('login_detected', 'Google sign-in detected!', 92);
            emitProg('finalizing', 'Finalizing account connection...', 96);
            emitProg('success', 'Connected successfully ✓', 100, {
              detectedEmail: session?.getSnapshot().detectedEmail,
            });
          }
        };
        this.on('session:ready', onSessionReady);

        return {
          success: false,
          profileId,
          status: 'browser_open',
          requiresInteraction: true,
        };
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      appLogger.error('session_manager', `Connection failed for profile '${profileId}': ${errMsg}`);
      emitProg('error', errMsg, 100, { error: errMsg });
      return {
        success: false,
        profileId,
        status: 'error',
        error: errMsg,
      };
    }
  }

  /**
   * Safely cancels an in-flight connection attempt for a specific profile.
   * Cleans up ONLY owned background or login browser processes belonging to that profile.
   * Leaves personal Chrome and all other Infinity Flow profiles untouched.
   */
  async cancelConnection(profileId: string): Promise<void> {
    appLogger.info('session_manager', `cancelConnection: Cancelling connection attempt for '${profileId}'`);
    const session = this.sessions.get(profileId);
    if (session) {
      try {
        if (session.isProcessAlive()) {
          if (session.status === 'browser_open') {
            await session.closeLoginBrowser().catch(() => {});
          }
        }
        await session.stop().catch(() => {});
      } catch (err) {
        appLogger.warn('session_manager', `cancelConnection cleanup notice for '${profileId}': ${(err as Error).message}`);
      }
    }

    // If profile was unverified / in-flight, delete it so incomplete records don't linger
    try {
      const config = ProfileConfigManager.read(profileId);
      if (config && (!session || session.status !== 'ready')) {
        await this.deleteProfile(profileId).catch(() => {});
      }
    } catch {
      /* ignore if not yet saved */
    }

    this.emit('profile:connection_progress', {
      profileId,
      stage: 'cancelled',
      message: 'Connection cancelled',
      progress: 0,
    });
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
    return this.withProfileLock(profileId, async () => {
      const config = ProfileConfigManager.read(profileId);

      // Reuse existing session object if possible
      let session = this.sessions.get(profileId);

      if (session && session.status !== 'stopped' && session.status !== 'error') {
        if (session.status === 'chrome_launched' || session.status === 'connecting') {
          appLogger.info('session_manager', 'Profile is currently starting or connecting, ignoring duplicate start call', { profileId, status: session.status });
          return;
        }
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

      // Check if Chrome is already active on the configured CDP port
      let isPortActive = false;
      try {
        await probeCdpPort(config.cdpPort);
        isPortActive = true;
      } catch {
        isPortActive = false;
      }

      if (!isPortActive) {
        // Ensure port is allocated for new launch
        const existingPort = this.portAllocator.getPort(profileId);
        if (!existingPort) {
          // Allocate the port stored in the profile config
          const available = await this.portAllocator.allocate(profileId, config.cdpPort);
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
      }

      if (!session) {
        session = new ProfileSession(config);
        this.sessions.set(profileId, session);
        this.attachSessionEvents(session);
      } else {
        session.updateConfig(config);
        session.setCdpPort(config.cdpPort);
      }

      if (isPortActive) {
        appLogger.info('session_manager', 'CDP port already active; attaching to running Chrome', { profileId, port: config.cdpPort });
        await session.connectToRunningBrowser();
        await session.verifyAuth();
        return;
      }

      appLogger.info('session_manager', 'Starting profile', { profileId, headless });

      // Non-blocking start; session events will update callers
      await session.start(headless);
    });
  }

  /**
   * Stops a running profile session.
   */
  async stopProfile(profileId: string): Promise<void> {
    return this.withProfileLock(profileId, async () => {
      const session = this.sessions.get(profileId);

      if (!session) {
        appLogger.warn('session_manager', 'stopProfile called on unknown profile', { profileId });
        return;
      }

      await session.stop();
      this.portAllocator.release(profileId);
      appLogger.info('session_manager', 'Profile stopped', { profileId });
    });
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
  /**
   * Automatically starts and verifies all configured profiles in background mode on app launch.
   * Performs safe, resource-bounded background authentication health checks with a concurrency
   * limit of at most 2 verifications at a time, ensuring profiles with valid Google cookies
   * become 'ready' (Connected) without opening visible Chrome windows or appearing in the macOS Dock.
   */
  /**
   * Verifies multiple profiles headlessly in the background with a max concurrency of 2.
   * If profileIds is not supplied, runs for all enabled profiles (e.g. startup auto-verification).
   *
   * Eligibility rules:
   *  - SKIP if already authentic and verified in the CURRENT runtime process (session.isVerifiedInCurrentProcess && session.status === 'ready')
   *  - SKIP if currently generating a job (session.status === 'busy')
   *  - SKIP if currently verifying (session.isVerifying)
   *  - For all eligible profiles: sets status to 'starting' (UI shows "Checking...") and queues headless verify.
   */
  async verifyProfilesBackground(
    profileIds?: string[]
  ): Promise<Record<string, { success: boolean; status: ProfileSessionStatus; detectedEmail?: string | null; error?: string }>> {
    const allConfigs = ProfileConfigManager.list();
    const targetConfigs = profileIds
      ? allConfigs.filter((c) => profileIds.includes(c.profileId))
      : allConfigs.filter((c) => c.enabled !== false);

    const results: Record<string, { success: boolean; status: ProfileSessionStatus; detectedEmail?: string | null; error?: string }> = {};

    if (targetConfigs.length === 0) {
      appLogger.info('session_manager', 'verifyProfilesBackground: No eligible profiles to verify');
      return results;
    }

    // Pre-initialize and determine eligibility
    const eligibleConfigs: ProfileConfig[] = [];
    for (const config of targetConfigs) {
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

      // Normalize stale transient statuses if Chrome process is not alive
      if (!session.isProcessAlive() && !session.isVerifying) {
        const transientStatuses: ProfileSessionStatus[] = ['starting', 'connecting', 'chrome_launched', 'waiting_for_cdp', 'creating_page', 'busy', 'reconnecting'];
        if (transientStatuses.includes(session.status)) {
          session.setStatus('stopped');
        }
      }

      // Check eligibility
      if (session.isVerifiedInCurrentProcess && session.status === 'ready') {
        appLogger.info('session_manager', `verifyProfilesBackground: Skipping '${config.profileId}' - already verified in current runtime`);
        results[config.profileId] = {
          success: true,
          status: 'ready',
          detectedEmail: session.getSnapshot().detectedEmail,
        };
        continue;
      }
      if (session.status === 'busy') {
        appLogger.info('session_manager', `verifyProfilesBackground: Skipping '${config.profileId}' - session is busy`);
        results[config.profileId] = {
          success: true,
          status: 'busy',
          detectedEmail: session.getSnapshot().detectedEmail,
        };
        continue;
      }
      if (session.isVerifying) {
        appLogger.info('session_manager', `verifyProfilesBackground: Skipping '${config.profileId}' - verification already in progress`);
        continue;
      }

      // Mark queued profiles as verifying so the UI immediately reflects "Checking..."
      session.isVerifying = true;
      session.emit('status_change', session.getSnapshot());
      eligibleConfigs.push(config);
    }

    if (eligibleConfigs.length === 0) {
      return results;
    }

    appLogger.info('session_manager', `verifyProfilesBackground: Queuing ${eligibleConfigs.length} profile(s) for background verification (max concurrency 2)...`);

    const MAX_CONCURRENT_VERIFICATIONS = 2;
    const queue = eligibleConfigs.map((config) => ({
      config,
      enqueuedAt: Date.now(),
    }));
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_VERIFICATIONS, queue.length) },
      async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const { config, enqueuedAt } = item;
          const waitMs = Date.now() - enqueuedAt;
          appLogger.info('session_manager', `verifyProfilesBackground: Profile '${config.profileId}' dequeued after ${waitMs} ms queue wait`);

          try {
            const res = await this.verifyAccount(config.profileId);
            results[config.profileId] = res;
          } catch (err) {
            results[config.profileId] = {
              success: false,
              status: 'error',
              error: (err as Error).message,
            };
          }
        }
      }
    );

    await Promise.all(workers);
    appLogger.info('session_manager', `verifyProfilesBackground: Completed verification for ${eligibleConfigs.length} profile(s)`);
    return results;
  }

  /**
   * Auto-starts background verification for all configured profiles on application launch.
   * Stale persisted 'ready' status does NOT skip verification: each profile is verified
   * in the current runtime process without opening visible Chrome.
   */
  async autoStartProfiles(): Promise<void> {
    const profiles = ProfileConfigManager.list();
    if (profiles.length === 0) {
      appLogger.info('session_manager', 'No configured profiles to auto-start');
      return;
    }

    await this.verifyProfilesBackground();
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
    return this.withProfileLock(profileId, async () => {
      const config = ProfileConfigManager.read(profileId);

      // Reuse or create a session object
      let session = this.sessions.get(profileId);
      if (!session) {
        // Ensure port is allocated
        const existingPort = this.portAllocator.getPort(profileId);
        if (!existingPort) {
          const available = await this.portAllocator.allocate(profileId, config.cdpPort);
          if (available !== config.cdpPort) {
            const updatedConfig = ProfileConfigManager.update(profileId, { cdpPort: available });
            Object.assign(config, updatedConfig);
          }
        }
        session = new ProfileSession(config);
        this.sessions.set(profileId, session);
        this.attachSessionEvents(session);
      } else {
        session.setCdpPort(config.cdpPort);
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
    });
  }

  /**
   * Opens or activates Google Flow in the dedicated browser.
   * If Chrome is already running, reconnects to it and brings Flow tab to front.
   */
  async openSignIn(profileId: string): Promise<ProfileSessionSnapshot> {
    return this.withProfileLock(profileId, async () => {
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
    });
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
  verifyAccount(profileId: string): Promise<{
    success: boolean;
    status: ProfileSessionStatus;
    detectedEmail: string | null;
    error?: string;
  }> {
    const existing = this.inFlightVerifications.get(profileId);
    if (existing) {
      appLogger.info('session_manager', `verifyAccount: Reusing in-flight verification promise for '${profileId}'`);
      return existing;
    }

    const verifyPromise = (async () => {
      try {
        return await this.withProfileLock(profileId, async () => {
          return await this._verifyAccountInternal(profileId);
        });
      } finally {
        this.inFlightVerifications.delete(profileId);
      }
    })();

    this.inFlightVerifications.set(profileId, verifyPromise);
    return verifyPromise;
  }

  private async _verifyAccountInternal(profileId: string): Promise<{
    success: boolean;
    status: ProfileSessionStatus;
    detectedEmail: string | null;
    error?: string;
  }> {
    let config: ProfileConfig;
    try {
      config = ProfileConfigManager.read(profileId);
    } catch {
      const existingSession = this.sessions.get(profileId);
      if (existingSession && (existingSession as any).config) {
        config = (existingSession as any).config;
      } else {
        throw new Error(`Profile config not found: ${profileId}`);
      }
    }

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
    } else {
      session.setCdpPort(config.cdpPort);
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

    if (!isPidAlive && !isPortActive) {
      // Background headless verification
      try {
        appLogger.info('session_manager', `verifyAccount: Running background headless verification for ${profileId}`);
        const authResult = await session.verifyAuthBackground();

        if (authResult.detectedEmail || authResult.locale) {
          this.persistDiscoveredMetadata(profileId, config, authResult);
        }

        this.emit('session:status', session.getSnapshot());
        if (authResult.state === 'authenticated') {
          session.isVerifiedInCurrentProcess = true;
          this.emit('session:ready', profileId);
          return {
            success: true,
            status: 'ready',
            detectedEmail: session.getSnapshot().detectedEmail,
          };
        } else if (authResult.state === 'login_required' || authResult.state === 'captcha') {
          this.emit('session:auth_required', profileId);
          return {
            success: false,
            status: 'auth_required',
            detectedEmail: session.getSnapshot().detectedEmail,
            error: authResult.state === 'login_required' ? 'User sign-in required. Click Reconnect to sign in.' : 'CAPTCHA challenge detected on Flow.',
          };
        } else {
          return {
            success: false,
            status: session.status,
            detectedEmail: session.getSnapshot().detectedEmail,
            error: 'Unable to verify Flow authentication status.',
          };
        }
      } catch (err) {
        appLogger.warn('session_manager', `verifyAccount: Background check error for ${profileId}: ${(err as Error).message}`);
        this.emit('session:status', session.getSnapshot());
        return {
          success: false,
          status: session.status,
          detectedEmail: session.getSnapshot().detectedEmail,
          error: (err as Error).message,
        };
      }
    }

    // 3. Connect to running browser & verify auth with defensive timeout
    try {
      const verifyPromise = session.verifyAuth();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Verification timed out after 30s. Please ensure Google Flow is active in Chrome and click Verify again.')),
          30000,
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
        this.persistDiscoveredMetadata(profileId, config, authResult);
      }

      this.emit('session:status', session.getSnapshot());
      if (authResult.state === 'authenticated') {
        session.isVerifiedInCurrentProcess = true;
        this.emit('session:ready', profileId);
        // If this was a login browser, auto-close it now so it cleanly exits and leaves macOS Dock
        if (session.status === 'browser_open' || session.isProcessAlive()) {
          await session.closeLoginBrowser().catch((err) => {
            appLogger.debug('session_manager', `Could not auto-close login window after auth: ${(err as Error).message}`);
          });
        }
      } else if (authResult.state === 'login_required' || authResult.state === 'captcha') {
        this.emit('session:auth_required', profileId);
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

  private persistDiscoveredMetadata(
    profileId: string,
    config: ProfileConfig,
    authResult: { detectedEmail?: string | null; locale?: string | null }
  ): void {
    if (!authResult.detectedEmail && !authResult.locale) return;

    let safeEmailToPersist: string | undefined = authResult.detectedEmail ?? undefined;
    if (safeEmailToPersist) {
      const diskProfiles = ProfileConfigManager.readAll();
      const otherProfiles = diskProfiles.filter((p) => p.profileId !== profileId);
      const hasConflict = otherProfiles.some(
        (p) =>
          (p.expectedEmail && p.expectedEmail.toLowerCase() === safeEmailToPersist!.toLowerCase()) ||
          (p.detectedEmail && p.detectedEmail.toLowerCase() === safeEmailToPersist!.toLowerCase())
      );
      if (hasConflict) {
        appLogger.warn(
          'session_manager',
          `Cross-profile contamination blocked: detected email '${safeEmailToPersist}' belongs to another profile. Reverting to local user data email for '${profileId}'.`
        );
        safeEmailToPersist =
          LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
            config.userDataDir,
            config.chromeProfileName || 'Default'
          ) || undefined;
      }
    }

    const patch: Record<string, any> = {
      ...(safeEmailToPersist ? { detectedEmail: safeEmailToPersist } : {}),
      ...(authResult.locale ? { flowUrlLocale: `/fx/${authResult.locale}/tools/flow` } : {}),
    };
    if (safeEmailToPersist && config.displayName && /^Flow Account( \d+)?$/i.test(config.displayName.trim())) {
      patch.displayName = safeEmailToPersist;
    }
    ProfileConfigManager.update(profileId, patch);
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
        if (!session.isProcessAlive() && !session.isVerifying) {
          const transientStatuses: ProfileSessionStatus[] = ['starting', 'connecting', 'chrome_launched', 'waiting_for_cdp', 'creating_page', 'busy', 'reconnecting'];
          if (transientStatuses.includes(session.status)) {
            session.setStatus('stopped');
          }
        }
        const snap = session.getSnapshot();
        // Defensive invariant: snapshot cdpPort must always reflect profile's persisted/allocated port
        snap.cdpPort = config.cdpPort;
        snapshots.push(snap);
      } else {
        const localEmail = LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
          config.userDataDir,
          config.chromeProfileName || 'Default'
        );
        const resolvedEmail = localEmail || config.detectedEmail || config.expectedEmail || null;

        // Synthesize a stopped snapshot from the persisted config
        snapshots.push({
          profileId: config.profileId,
          displayName: config.displayName,
          status: 'stopped',
          cdpPort: config.cdpPort,
          chromePath: config.chromePath,
          detectedEmail: resolvedEmail,
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
