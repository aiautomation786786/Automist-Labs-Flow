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

// ---------------------------------------------------------------------------
// Phase 2: Flow Automation & UI Discovery Types
// ---------------------------------------------------------------------------

/**
 * Basic representation of an active or stored Google Flow project.
 */
export interface FlowProjectInfo {
  /** Unique project ID extracted from the URL, e.g. "9a8b7c6d-..." */
  id: string;
  /** Full project URL, e.g. "https://labs.google/fx/en/tools/flow/project/9a8b7c6d-..." */
  url: string;
  /** Name of the project (if discernible) */
  name?: string;
  /** ISO timestamp when last accessed/verified */
  lastAccessed?: string;
}

/**
 * Criteria for ensuring project context.
 */
export interface FlowProjectContext {
  /** Exact project ID requested. If provided, strictly prevents reusing a different project. */
  projectId?: string;
  /** Full target project URL */
  projectUrl?: string;
  /** Friendly project name for creating a new project if none exists */
  name?: string;
  /** If true, explicitly creates a new project instead of reusing any open project */
  forceNew?: boolean;
}

/**
 * Interactive element descriptor extracted during DOM discovery.
 */
export interface InteractiveElementInfo {
  tag: string;
  text: string;
  visible: boolean;
  role?: string | null;
  ariaLabel?: string | null;
  dataTestId?: string | null;
  href?: string | null;
}

/**
 * Structured result from discovering controls on the Flow page.
 */
export interface FlowUIDiscoveryResult {
  /** The URL where discovery was performed */
  url: string;
  /** Whether the page currently represents a project canvas */
  isProjectPage: boolean;
  /** Project ID if on a project page */
  projectId: string | null;
  /** Prompt input descriptor (e.g. contenteditable or textarea) */
  promptInputFound: boolean;
  promptInputType: 'contenteditable' | 'textarea' | 'none';
  /** Model selector button/control descriptor */
  modelSelectorFound: boolean;
  currentModelText: string | null;
  /** Ratio selector control descriptor */
  ratioSelectorFound: boolean;
  currentRatioText: string | null;
  /** Generate button control descriptor */
  generateButtonFound: boolean;
  generateButtonDisabled: boolean;
  generateButtonText: string | null;
  /** Interactive elements discovered on the page */
  buttonCount: number;
  inputCount: number;
  interactiveButtons: InteractiveElementInfo[];
}

/**
 * Structured result of active model selection (e.g. Nano Banana 2).
 */
export interface ModelSelectionResult {
  /** Model requested to be active */
  modelRequested: string;
  /** Model detected before selection was attempted */
  modelDetectedBefore: string | null;
  /** Whether clicking the dropdown was required/attempted */
  selectionAttempted: boolean;
  /** Model text detected after selection */
  modelDetectedAfter: string | null;
  /** True only if modelDetectedAfter strictly matches or contains modelRequested */
  verified: boolean;
  /** Error message if selection or verification failed */
  error?: string;
}

/**
 * Valid aspect ratios for Google Flow image generation.
 */
export type SupportedAspectRatio = '16:9' | '9:16';

/**
 * Structured result of aspect ratio selection.
 */
export interface RatioSelectionResult {
  requestedRatio: SupportedAspectRatio;
  detectedBefore: string | null;
  selected: boolean;
  detectedAfter: string | null;
  verified: boolean;
  error?: string;
}

/**
 * Result of detecting generated media on the Flow canvas.
 */
export interface MediaDetectionResult {
  /** Unique UUIDs extracted from TRPC redirect URLs (e.g. /media.getMediaUrlRedirect?name=...) */
  imageUuids: string[];
  /** Full TRPC media redirect URLs discovered */
  mediaUrls: string[];
  /** Whether any video elements or video players were detected */
  hasVideo: boolean;
  /** Video sources or posters discovered */
  videoSources: string[];
}

/**
 * Result of non-navigating media download.
 */
export interface MediaDownloadResult {
  /** Target file paths where downloaded files were saved */
  downloadedFiles: string[];
  /** Total bytes saved */
  bytesDownloaded: number;
  /** Destination directory or file path */
  destinationPath: string;
  /** Time elapsed in milliseconds */
  durationMs: number;
}

/**
 * Lifecycle status of a FlowAutomationSession.
 */
export type FlowAutomationStatus =
  | 'idle'
  | 'navigating'
  | 'checking_auth'
  | 'discovering'
  | 'selecting_model'
  | 'selecting_ratio'
  | 'downloading'
  | 'error';
