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
   * Optional expected Google account email provided by the user as an onboarding hint.
   * e.g. "myaccount@gmail.com".
   */
  expectedEmail: string | null;

  /**
   * Optional notes field for users to describe this profile.
   */
  notes: string;

  /**
   * Browser connection mode:
   *  - 'dedicated_flow_browser': application-managed profile directory (%LOCALAPPDATA%\AutomistLabs\FlowProfiles\...)
   *  - 'existing_chrome': connects to an existing local Chrome profile (e.g. "AI Automation" in Chrome's User Data)
   */
  connectionMode?: 'dedicated_flow_browser' | 'existing_chrome';

  /** For existing_chrome mode: the local Chrome profile subfolder (e.g. 'Default', 'Profile 1') */
  localProfileDirectory?: string;

  /** For existing_chrome mode: the root Chrome user data dir (e.g. '%LOCALAPPDATA%\Google\Chrome\User Data') */
  localUserDataDir?: string;

  /** Preferred CDP port for existing profile attachment (defaults to 9222) */
  preferredCdpPort?: number;
}

// ---------------------------------------------------------------------------
// Existing Profile State & Detection
// ---------------------------------------------------------------------------

export type ExistingProfileState = 'not_open' | 'open_and_attachable' | 'open_not_attachable';

export interface ExistingProfileDetectionResult {
  state: ExistingProfileState;
  profileDirectory: string;
  userDataDir: string;
  profileDisplayName?: string;
  accountEmail?: string;
  pids: number[];
  cdpPort?: number;
  details: string;
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
  | 'starting'         // Chrome is being spawned (launchLoginBrowser path).
  | 'browser_open'     // Chrome process confirmed running (PID alive). CDP not yet probed. Login window visible.
  | 'chrome_launched'  // Chrome process is up; waiting for CDP (full start path).
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
  expectedEmail?: string | null;
  flowUrl: string | null;
  errorMessage: string | null;
  lastStatusChange: string; // ISO 8601
  uptimeMs: number;         // Milliseconds since Chrome was launched.
  connectionMode?: 'dedicated_flow_browser' | 'existing_chrome';
  connectionState?:
    | 'connected_existing'
    | 'connected_dedicated'
    | 'profile_open_not_attachable'
    | 'profile_closed'
    | 'browser_open'       // Chrome process confirmed alive; login window visible
    | 'login_required'
    | 'authenticated'
    | 'error';
  tabCount?: number;
  flowTabUrl?: string | null;
  localProfileDirectory?: string;
  /** PID of the app-owned dedicated Chrome process (undefined if not running). */
  chromePid?: number;
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
 * Structured result of project creation control discovery.
 */
export interface ProjectCreationDiscoveryResult {
  found: boolean;
  locator?: any;
  strategy?: string;
  selectorStrategy?: string;
  selector?: string;
  confidence?: 'high' | 'medium' | 'low';
  elementDescription?: string;
  accessibleName?: string;
  text?: string;
  tagName?: string;
  reason?: string;
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
  /** Video UUIDs extracted from video sources or redirect URLs */
  videoUuids?: string[];
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
  /** Actual detected MIME type from response or file magic bytes */
  mimeType?: string;
  /** True if the downloaded binary is confirmed to be a valid supported image */
  isValidImage?: boolean;
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
  | 'attaching_image'
  | 'downloading'
  | 'error';

// ---------------------------------------------------------------------------
// Phase 3: Project, Prompt Slot, and Job Entity Models
// ---------------------------------------------------------------------------

/**
 * Processing order for mixed image and video generation projects.
 */
export type ProcessingOrder = 'images_first' | 'videos_first' | 'automatic';

/**
 * Valid lifecycle states of a single prompt slot.
 */
export type PromptSlotStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Provider & Gemini Types
// ---------------------------------------------------------------------------

export type GenerationProvider = 'flow' | 'gemini';

export type GeminiAspectRatio = '16:9' | '9:16';

export type GeminiGenerationMode =
  | 'gemini_text_to_video'
  | 'gemini_image_to_video'
  | 'gemini_bulk_text_to_video'
  | 'gemini_bulk_image_to_video';

/**
 * Represents the immutable result of a completed generation.
 */
export interface SlotMediaResult {
  assetId: string;
  mediaPath: string;           // Absolute path to local image / video
  thumbnailPath?: string;      // Local thumbnail path
  sourceImagePath?: string;    // Optional path to source image used for Image-to-Video
  provider?: GenerationProvider;// 'flow' | 'gemini' (defaults to 'flow')
  width?: number;
  height?: number;
  durationSeconds?: number;
  durationFormatted?: string;  // e.g. "4.0s"
  resolution?: string;         // e.g. "720p"
  generationResolution?: string; // e.g. "360p", "720p"
  downloadResolution?: string;   // e.g. "1080p", "2K"
  durationControl?: 'available' | 'unavailable';
  actualDuration?: string;     // e.g. "6.02s"
  upscaledAssetPath?: string;  // e.g. path to 1080p / 2K export
  jobStartTime?: string;       // ISO 8601
  generationClickTime?: string;// ISO 8601
  completionTime?: string;     // ISO 8601
  totalElapsedTimeMs?: number; // Total ms elapsed
  concurrencyLevel?: number;   // Concurrently active jobs during execution
  modelUsed: string;           // e.g. "Nano Banana 2", "Gemini Omni"
  ratioUsed: string;           // e.g. "16:9", "9:16"
  quantityUsed?: string;        // e.g. "x1"
  completedAt: string;         // ISO 8601
  fileSizeBytes: number;
  mimeType?: string;           // e.g. "image/png", "image/webp", "image/jpeg", "video/mp4"
}

/**
 * Error detail stored on a failed prompt slot.
 */
export interface SlotErrorDetail {
  code: string;
  message: string;
  timestamp: string;          // ISO 8601
  retryCount: number;
  profileId?: string;
}

/**
 * An individual prompt slot in a project.
 * IMMUTABLE IDENTITY: slotIndex, promptId, and type must NEVER change once created.
 */
export interface PromptSlotEntity {
  /** Deterministic zero-based index in the grid. Never reorders. */
  slotIndex: number;
  /** Unique permanent ID (e.g. "slot_abc123") */
  promptId: string;
  /** Project ID this slot belongs to */
  projectId: string;
  /** Content generation type */
  type: 'image' | 'video';
  /** Generation provider: 'flow' or 'gemini' (defaults to 'flow') */
  provider?: GenerationProvider;
  /** The prompt text to be entered into Google Flow or Gemini */
  promptText: string;
  /** Optional source image path for Image-to-Video generation */
  sourceImagePath?: string;
  /** Current slot lifecycle status */
  status: PromptSlotStatus;
  /** Currently executing job ID if running */
  activeJobId?: string;
  /** Currently assigned profile ID if running */
  assignedProfileId?: string;
  /** Media result when completed */
  result?: SlotMediaResult;
  /** Error detail if failed */
  error?: SlotErrorDetail;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
}

/**
 * Configuration options for a generation project.
 */
export interface ProjectSettings {
  provider?: GenerationProvider;
  imageRatio: SupportedAspectRatio;
  videoRatio: string;
  geminiAspectRatio?: GeminiAspectRatio;
  processingOrder: ProcessingOrder;
  autoRetry: boolean;
  maxRetries: number;
  imageDownloadQuality?: 'original' | '2k';
  videoDownloadQuality?: 'original' | '1080p';
  generationMode?: 'single_image' | 'single_video' | 'bulk_image' | 'bulk_video' | 'image_to_video' | 'bulk_image_to_video' | 'custom' | GeminiGenerationMode;
  imageModel?: string;
  videoModel?: string;
  videoResolution?: string;
  videoDuration?: string;
  selectedProfileIds?: string[];
}

/**
 * Summary statistics of a project.
 */
export interface ProjectStats {
  totalImages: number;
  totalVideos: number;
  completedImages: number;
  completedVideos: number;
  failedCount: number;
}

/**
 * Structured classification of generation and runtime failures.
 * Distinguishes genuine credit/quota issues from generic timeouts, safety blocks, or network drops.
 */
export type FailureClassification =
  | 'credit_exhausted'
  | 'quota_exhausted'
  | 'auth_required'
  | 'safety_block'
  | 'flow_generation_error'
  | 'timeout'
  | 'browser_error'
  | 'unknown';

/**
 * Explicit lifecycle states of prompt submission to Google Flow.
 */
export type SubmissionState =
  | 'none'
  | 'not_submitted'
  | 'queued'
  | 'assigned'
  | 'preparing'
  | 'ready_to_submit'
  | 'submitting'
  | 'submitted'
  | 'generating'
  | 'media_detected'
  | 'completed'
  | 'failed'
  | 'submission_unknown';

/**
 * Record of an individual execution attempt for a job on a specific profile.
 */
export interface JobAttemptRecord {
  profileId: string;
  attemptNumber: number;
  startedAt: string;
  endedAt?: string;
  submissionState: SubmissionState;
  outcome: 'completed' | 'failed' | 'retrying' | 'failed_over' | 'timeout' | 'unknown';
  errorClassification?: FailureClassification;
  errorMessage?: string;
}

/**
 * Record of in-memory profile quarantine due to credit/quota exhaustion.
 */
export interface QuarantineRecord {
  profileId: string;
  reason: 'credit_exhausted' | 'quota_exhausted';
  quarantinedAt: number;
  quarantineUntil: number;
  detail?: string;
}

/**
 * Status of an entire project.
 */
export type ProjectStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'deleting';

/**
 * Complete persistent entity representing a Google Flow creation project.
 * Stored at: %LOCALAPPDATA%\GoogleFlowApp\projects\{projectId}\project.json
 */
export interface ProjectEntity {
  projectId: string;
  name: string;
  campaignTag?: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  settings: ProjectSettings;
  slots: PromptSlotEntity[];
  stats: ProjectStats;
}

// ---------------------------------------------------------------------------
// Phase 3: Job State Machine & Job Entity
// ---------------------------------------------------------------------------

/**
 * All 13 valid lifecycle states for a generation job.
 */
export type JobStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'starting'
  | 'configuring'
  | 'generating'
  | 'waiting_for_result'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'retry_waiting'
  | 'cancelled'
  | 'manual_action_required';

/**
 * Persistent entity representing a single execution task for a prompt slot.
 * Stored at: %LOCALAPPDATA%\GoogleFlowApp\projects\{projectId}\jobs.json
 */
export interface GenerationJobEntity {
  jobId: string;
  projectId: string;
  promptId: string;
  promptType: 'image' | 'video';
  provider?: GenerationProvider;
  slotIndex: number;
  status: JobStatus;
  profileId?: string;
  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  outputPath?: string;
  thumbnailPath?: string;
  sourceImagePath?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  submissionState?: SubmissionState;
  attempts?: JobAttemptRecord[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Phase 3: Event Payloads (Serializable only — zero Playwright/browser handles)
// ---------------------------------------------------------------------------

export interface JobProgressEvent {
  jobId: string;
  projectId: string;
  promptId: string;
  slotIndex: number;
  profileId?: string;
  status: JobStatus;
  stepDescription: string;
  timestamp: string;
  progressPercent?: number;
  stage?: 'starting' | 'configuring' | 'generating' | 'downloading' | 'completed' | 'failed';
  elapsedSeconds?: number;
  estimatedDurationSeconds?: number;
}

export interface SlotUpdatedEvent {
  projectId: string;
  slotIndex: number;
  promptId: string;
  status: PromptSlotStatus;
  result?: SlotMediaResult;
  error?: SlotErrorDetail;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Phase 4: Application Settings & IPC Bridge Contracts
// ---------------------------------------------------------------------------

export interface AppSettings {
  appDataDir: string;
  defaultImageRatio: SupportedAspectRatio;
  defaultProcessingOrder: ProcessingOrder;
  maxRetries: number;
  logLevel: 'INFO' | 'WARN' | 'DEBUG' | 'ERROR';
  defaultImageDownloadQuality?: 'original' | '2k';
  defaultVideoDownloadQuality?: 'original' | '1080p';
}

export interface CreateProjectParams {
  name: string;
  campaignTag?: string;
  provider?: GenerationProvider;
  imageRatio?: SupportedAspectRatio;
  videoRatio?: string;
  geminiAspectRatio?: GeminiAspectRatio;
  processingOrder?: ProcessingOrder;
  autoRetry?: boolean;
  maxRetries?: number;
  imageDownloadQuality?: 'original' | '2k';
  videoDownloadQuality?: 'original' | '1080p';
  generationMode?: 'single_image' | 'single_video' | 'bulk_image' | 'bulk_video' | 'image_to_video' | 'bulk_image_to_video' | 'custom' | GeminiGenerationMode;
  imageModel?: string;
  videoModel?: string;
  videoResolution?: string;
  videoDuration?: string;
  selectedProfileIds?: string[];
  prompts: Array<{ text: string; type: 'image' | 'video'; sourceImagePath?: string; provider?: GenerationProvider }>;
}

export interface SchedulerCapacityMetrics {
  totalProfiles: number;
  readyProfiles: number;
  busyProfiles: number;
  errorProfiles: number;
  totalCapacity: number;
  activeJobs: number;
  availableCapacity: number;
  pendingJobs: number;
}

export interface FlowApi {
  // Projects
  listProjects: () => Promise<ProjectEntity[]>;
  getProject: (projectId: string) => Promise<ProjectEntity | null>;
  createProject: (params: CreateProjectParams) => Promise<ProjectEntity>;
  updateProject: (
    projectId: string,
    patch: Partial<Omit<ProjectEntity, 'projectId' | 'createdAt' | 'slots'>>
  ) => Promise<ProjectEntity>;
  deleteProject: (projectId: string) => Promise<void>;
  deleteProjects?: (projectIds: string[]) => Promise<{ success: boolean; deletedCount: number }>;
  retrySlot?: (projectId: string, slotIndex: number) => Promise<void>;
  revealAsset?: (mediaPath: string) => Promise<boolean>;
  selectImageFile?: () => Promise<string | null>;
  selectMultipleImageFiles?: () => Promise<string[]>;
  selectZipFile?: () => Promise<string | null>;
  extractImageZip?: (zipPath: string) => Promise<{ files: Array<{ path: string; name: string }>; tempDir: string }>;
  exportProjectZip?: (projectId: string, slotIndices?: number[]) => Promise<{ zipPath: string }>;
  downloadSelected?: (params: { projectId: string; slotIndices: number[]; destinationDir: string }) => Promise<{ count: number; destinationDir: string }>;
  selectDirectory?: () => Promise<string | null>;

  // Generation
  startProjectGeneration: (projectId: string) => Promise<GenerationJobEntity[]>;
  cancelJob: (projectId: string, jobId: string) => Promise<void>;
  getProjectJobs: (projectId: string) => Promise<GenerationJobEntity[]>;
  getCapacityMetrics?: () => Promise<SchedulerCapacityMetrics>;

  // Profiles
  listProfiles: () => Promise<ProfileSessionSnapshot[]>;
  createProfile: (params: { displayName: string; expectedEmail?: string; notes?: string }) => Promise<ProfileConfig>;
  startProfile: (profileId: string) => Promise<ProfileSessionSnapshot | null>;
  stopProfile: (profileId: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  openChrome: (profileId: string) => Promise<{ success: boolean; message: string }>;
  openSignIn: (profileId: string) => Promise<{ success: boolean; message: string }>;
  openFlow?: (profileId: string) => Promise<{ success: boolean; message: string; snapshot?: ProfileSessionSnapshot }>;
  /**
   * Launches the dedicated Chrome window for manual login.
   * Returns as soon as the OS process is confirmed running (PID alive).
   * Does NOT wait for CDP, Playwright connection, or auth detection.
   * The Chrome window stays open for the user to sign in manually.
   */
  launchLoginBrowser: (profileId: string) => Promise<{ success: boolean; pid: number; cdpPort: number; userDataDir: string; message: string }>;
  verifyAccount: (profileId: string) => Promise<{ success: boolean; status: ProfileSessionStatus; detectedEmail: string | null; error?: string }>;
  testConnection: (profileId: string) => Promise<{ success: boolean; port: number; responsive: boolean; status: ProfileSessionStatus }>;
  detectLocalChromeProfiles?: () => Promise<Array<DiscoveredLocalProfile & { isOpen: boolean; isAttachable: boolean; cdpPort?: number }>>;
  detectProfileState?: (target: string | { userDataDir?: string; profileDirectory?: string; email?: string; displayName?: string; preferredCdpPort?: number }) => Promise<ExistingProfileDetectionResult>;
  createExistingProfile?: (params: { displayName: string; localProfileDirectory: string; localUserDataDir?: string; expectedEmail?: string; notes?: string; preferredCdpPort?: number }) => Promise<ProfileConfig>;

  // Settings & System
  getAppInfo: () => Promise<{ appDataDir: string; version: string; platform: string }>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;

  // Events
  onJobProgress: (callback: (event: JobProgressEvent) => void) => () => void;
  onSlotUpdated: (callback: (event: SlotUpdatedEvent) => void) => () => void;
  onJobCompleted: (callback: (job: GenerationJobEntity) => void) => () => void;
  onJobFailed: (callback: (job: GenerationJobEntity) => void) => () => void;
  onWorkerStatus: (callback: (data: { profileId: string; status: string; activeJobId?: string }) => void) => () => void;
}

// ---------------------------------------------------------------------------
// Local Chrome Profile Discovery (Phase 5.2)
// ---------------------------------------------------------------------------

export interface DiscoveredLocalProfile {
  profileDirectory: string;         // e.g. "Default", "Profile 1", "Profile 2"
  profileDisplayName: string;       // e.g. "Your Chrome", "Heidi Mason"
  accountEmail: string | null;      // e.g. "aiautomation786786@gmail.com"
  accountDisplayName: string | null;// e.g. "Ai Automation"
  fullPath: string;                 // Path to profile directory inside User Data
}

export type ProfileMatchStatus = 'exact_match' | 'multiple_matches' | 'not_found';

export interface ProfileMatchResult {
  status: ProfileMatchStatus;
  match: DiscoveredLocalProfile | null;
  candidates: DiscoveredLocalProfile[];
  matchingMethod?: 'email' | 'display_name';
  error?: string;
}

export interface ProfileInUseResult {
  inUse: boolean;
  pids: number[];
  cdpPort?: number;
  details?: string;
}

declare global {
  interface Window {
    flowApi?: FlowApi;
  }
}

