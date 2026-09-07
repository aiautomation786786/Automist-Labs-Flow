/**
 * Shared TypeScript type definitions for Google Flow Desktop Application – Phase 1.
 *
 * These types define the contract between the session engine, profile storage,
 * process supervisor, and (eventually) the Electron IPC layer.
 *
 * No implementation logic here. Pure type definitions only.
 */

// ---------------------------------------------------------------------------
// Profile Configuration (persisted to profile.json)
// ---------------------------------------------------------------------------

/**
 * The persistent configuration for one Google Flow worker profile.
 * Stored in: %LOCALAPPDATA%\GoogleFlowApp\profiles\{profileId}\profile.json
 */
export interface ProfileConfig {
  /** Unique stable identifier (e.g. "profile_abc12345"). Never changes after creation. */
  profileId: string;

  /** Human-readable display name chosen by the user (e.g. "Marketing Account"). */
  displayName: string;

  /**
   * Absolute path to the Chrome user-data directory for this profile.
   * e.g. "C:\Users\User\AppData\Local\GoogleFlowApp\profiles\profile_abc12345\chrome-user-data"
   */
  userDataDir: string;

  /**
   * Chrome profile sub-folder name inside userDataDir.
   * Always "Default" for fresh application-managed profiles.
   */
  chromeProfileName: string;

  /**
   * Resolved absolute path to chrome.exe as discovered at profile creation time.
   * May be overridden by the user in Settings.
   */
  chromePath: string;

  /** CDP debugging port assigned to this profile. */
  cdpPort: number;

  /** Whether this profile is enabled and eligible for scheduling. */
  enabled: boolean;

  /** ISO 8601 creation timestamp. */
  createdAt: string;

  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;

  /**
   * The Google Flow URL locale override for this account.
   * e.g. "/fx/en/tools/flow" or "/fx/fr/tools/flow".
   * Detected during first authentication; null if not yet determined.
   */
  flowUrlLocale: string | null;

  /**
   * The detected Google account email for this profile.
   * Populated after first successful authentication detection.
   * Never used for programmatic login; informational only.
   */
  detectedEmail: string | null;

  /**
   * Optional notes field for users to describe this profile.
   */
  notes: string;
}

// ---------------------------------------------------------------------------
// Session State Machine
// ---------------------------------------------------------------------------

/**
 * All possible lifecycle states of a ProfileSession.
 *
 * State transition diagram:
 *
 *   [created]
 *       │
 *       └──(launch)──► [starting]
 *                           │
 *               ┌───────────┴───────────┐
 *               │                       │
 *         (chrome OK)             (chrome fails)
 *               │                       │
 *       [chrome_launched]          [error]
 *               │
 *          (CDP probes)
 *               │
 *       [connecting]
 *               │
 *       ┌───────┴───────┐
 *       │               │
 *  (connected)      (connect fails)
 *       │               │
 * [connected]       [error]
 *       │
 *  (auth check)
 *       │
 *  ┌────┴────────────────┐
 *  │                     │
 * (needs login)     (flow ready)
 *  │                     │
 *  [auth_required]    [ready]
 *  │                     │
 *  └──(user signs in)──► │
 *                         │
 *                    ┌────┴────┐
 *                    │        │
 *               (job starts) (stop)
 *                    │        │
 *                [busy]   [stopping]
 *                    │        │
 *               (job done) [stopped]
 *                    │
 *                  [ready]
 */
export type ProfileSessionStatus =
  | 'created'          // Profile exists; Chrome not yet launched.
  | 'starting'         // Chrome is being spawned.
  | 'chrome_launched'  // Chrome process is up; waiting for CDP.
  | 'connecting'       // Playwright is attempting CDP connection.
  | 'connected'        // CDP connected; checking Flow auth state.
  | 'auth_required'    // Flow detected a Google login wall. User must sign in.
  | 'ready'            // Flow is authenticated and idle. Accepts automation jobs.
  | 'busy'             // A job is currently executing on this session.
  | 'stopping'         // Graceful shutdown initiated.
  | 'stopped'          // Chrome has exited; session is terminated.
  | 'error';           // Unrecoverable error. Reason available in errorMessage.

/**
 * Snapshot of an active ProfileSession, suitable for sending over IPC.
 */
export interface ProfileSessionSnapshot {
  profileId: string;
  displayName: string;
  status: ProfileSessionStatus;
  cdpPort: number;
  chromePath: string;
  detectedEmail: string | null;
  flowUrl: string | null;
  errorMessage: string | null;
  lastStatusChange: string; // ISO 8601
  uptimeMs: number;         // Milliseconds since Chrome was launched.
}

// ---------------------------------------------------------------------------
// Chrome Discovery
// ---------------------------------------------------------------------------

/**
 * A candidate Chrome installation found during filesystem/registry scanning.
 */
export interface ChromeCandidate {
  /** Absolute path to chrome.exe. */
  path: string;
  /** Source where this candidate was discovered. */
  source: 'registry' | 'program_files' | 'program_files_x86' | 'localappdata' | 'user_specified';
  /** True if the file exists and is executable. */
  verified: boolean;
}

/**
 * Result of the Chrome finder scan.
 */
export interface ChromeDiscoveryResult {
  /** The best candidate to use (first verified). */
  recommended: ChromeCandidate | null;
  /** All candidates found (verified or not). */
  all: ChromeCandidate[];
}

// ---------------------------------------------------------------------------
// Port Allocation
// ---------------------------------------------------------------------------

/**
 * Information about an allocated CDP port.
 */
export interface AllocatedPort {
  port: number;
  profileId: string;
  allocatedAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Flow Authentication Detection
// ---------------------------------------------------------------------------

export type FlowAuthState =
  | 'authenticated'   // Google Flow is loaded and the user is signed in.
  | 'login_required'  // Redirected to accounts.google.com.
  | 'captcha'         // CAPTCHA or bot challenge detected.
  | 'loading'         // Page is loading; state not yet determinable.
  | 'unknown';        // Could not determine auth state.

export interface FlowAuthCheckResult {
  state: FlowAuthState;
  url: string;
  detectedEmail: string | null;
  locale: string | null; // "en", "fr", etc., extracted from URL.
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  timestamp: string;   // ISO 8601
  profileId?: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
  errorStack?: string;
}

// ---------------------------------------------------------------------------
// Session Manager Events
// ---------------------------------------------------------------------------

/**
 * Events emitted by ProfileSessionManager.
 * In Phase 1, these are Node.js EventEmitter events.
 * In Phase 5+, they will also be forwarded over Electron IPC.
 */
export interface SessionManagerEvents {
  /** Emitted whenever a session's status changes. */
  'session:status': (snapshot: ProfileSessionSnapshot) => void;
  /** Emitted when a session transitions to auth_required. */
  'session:auth_required': (profileId: string) => void;
  /** Emitted when a session is ready for automation. */
  'session:ready': (profileId: string) => void;
  /** Emitted when a session encounters an unrecoverable error. */
  'session:error': (profileId: string, errorMessage: string) => void;
  /** Emitted when Chrome crashes unexpectedly. */
  'session:crash': (profileId: string) => void;
}
