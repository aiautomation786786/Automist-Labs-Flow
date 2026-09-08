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
import { ProfileSession, FLOW_BASE_URL, probeCdpPort } from './ProfileSession';
import { FlowAuthDetector } from './FlowAuthDetector';
import { ProfileConfigManager } from './ProfileConfig';
import { ChromePortAllocator } from './ChromePortAllocator';
import { WindowsChromeFinder } from './WindowsChromeFinder';
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

    session = new ProfileSession(config);
    this.sessions.set(profileId, session);
    this.attachSessionEvents(session);

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
  // Account & Authentication Actions (Phase 5.3)
  // ---------------------------------------------------------------------------

  /**
   * Opens a visible Chrome window for manual user sign-in.
   * If already running, navigates the page to the Flow base URL.
   */
  async openSignIn(profileId: string): Promise<ProfileSessionSnapshot> {
    const session = this.sessions.get(profileId);
    if (!session || session.status === 'stopped' || session.status === 'error') {
      await this.startProfile(profileId, false);
    }
    const activeSession = this.sessions.get(profileId);
    if (!activeSession) {
      throw new Error(`Failed to initialize session for profile ${profileId}`);
    }
    const page = activeSession.getPage();
    if (page) {
      try {
        const config = ProfileConfigManager.read(profileId);
        const url = config.flowUrlLocale
          ? `https://labs.google${config.flowUrlLocale}`
          : FLOW_BASE_URL;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      } catch {
        /* ignore navigation errors during sign-in open */
      }
    }
    return activeSession.getSnapshot();
  }

  /**
   * Probes the current Google Flow authentication state using FlowAuthDetector.
   * Updates detectedEmail and locale in profile.json if found.
   */
  async verifyAccount(profileId: string): Promise<{
    success: boolean;
    status: ProfileSessionStatus;
    detectedEmail: string | null;
    error?: string;
  }> {
    let session = this.sessions.get(profileId);
    if (!session || session.status === 'stopped' || session.status === 'error') {
      await this.startProfile(profileId, false);
      session = this.sessions.get(profileId);
    }

    if (!session) {
      return { success: false, status: 'error', detectedEmail: null, error: 'Session failed to start' };
    }

    const page = session.getPage();
    if (!page) {
      return { success: false, status: session.status, detectedEmail: null, error: 'Browser page unavailable' };
    }

    try {
      const config = ProfileConfigManager.read(profileId);
      const url = config.flowUrlLocale ? `https://labs.google${config.flowUrlLocale}` : FLOW_BASE_URL;
      const result = await FlowAuthDetector.navigateAndCheck(page, url, profileId);

      if (result.detectedEmail || result.locale) {
        ProfileConfigManager.update(profileId, {
          ...(result.detectedEmail ? { detectedEmail: result.detectedEmail } : {}),
          ...(result.locale ? { flowUrlLocale: `/fx/${result.locale}/tools/flow` } : {}),
        });
      }

      return {
        success: result.state === 'authenticated',
        status: session.status,
        detectedEmail: result.detectedEmail ?? session.getSnapshot().detectedEmail,
        error: result.state === 'login_required' ? 'User login required' : undefined,
      };
    } catch (err) {
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
