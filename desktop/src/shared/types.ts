/**
 * Shared TypeScript type definitions for Infinity Flow Desktop Application.
 *
 * These types define the contract between the session engine, profile storage,
 * process supervisor, and (eventually) the Electron IPC layer.
 *
 * No implementation logic here. Pure type definitions only.
 */
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
export type ProfileSessionStatus = 'created' | 'starting' | 'browser_open' | 'chrome_launched' | 'connecting' | 'connected' | 'auth_required' | 'ready' | 'busy' | 'stopping' | 'stopped' | 'error';
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
    lastStatusChange: string;
    uptimeMs: number;
    connectionMode?: 'dedicated_flow_browser' | 'existing_chrome';
    connectionState?: 'connected_existing' | 'connected_dedicated' | 'profile_open_not_attachable' | 'profile_closed' | 'browser_open' | 'login_required' | 'authenticated' | 'error';
    tabCount?: number;
    flowTabUrl?: string | null;
    localProfileDirectory?: string;
    /** PID of the app-owned dedicated Chrome process (undefined if not running). */
    chromePid?: number;
}
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
/**
 * Information about an allocated CDP port.
 */
export interface AllocatedPort {
    port: number;
    profileId: string;
    allocatedAt: string;
}
export type FlowAuthState = 'authenticated' | 'login_required' | 'captcha' | 'loading' | 'unknown';
export interface FlowAuthCheckResult {
    state: FlowAuthState;
    url: string;
    detectedEmail: string | null;
    locale: string | null;
}
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    level: LogLevel;
    timestamp: string;
    profileId?: string;
    event: string;
    message: string;
    data?: Record<string, unknown>;
    errorStack?: string;
}
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
export type FlowAutomationStatus = 'idle' | 'navigating' | 'checking_auth' | 'discovering' | 'selecting_model' | 'selecting_ratio' | 'attaching_image' | 'downloading' | 'error';
/**
 * Processing order for mixed image and video generation projects.
 */
export type ProcessingOrder = 'images_first' | 'videos_first' | 'automatic';
/**
 * Valid lifecycle states of a single prompt slot.
 */
export type PromptSlotStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GenerationProvider = 'flow' | 'gemini' | 'auto';
export type GeminiAspectRatio = '16:9' | '9:16';
export type GeminiGenerationMode = 'gemini_text_to_video' | 'gemini_image_to_video' | 'gemini_bulk_text_to_video' | 'gemini_bulk_image_to_video' | 'gemini_single_image' | 'gemini_bulk_image';
/**
 * Represents the immutable result of a completed generation.
 */
export interface SlotMediaResult {
    assetId: string;
    mediaPath: string;
    thumbnailPath?: string;
    sourceImagePath?: string;
    originalMediaPath?: string;
    watermarkCleaned?: boolean;
    provider?: GenerationProvider;
    providerModel?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    durationFormatted?: string;
    resolution?: string;
    generationResolution?: string;
    downloadResolution?: string;
    durationControl?: 'available' | 'unavailable';
    actualDuration?: string;
    upscaledAssetPath?: string;
    jobStartTime?: string;
    generationClickTime?: string;
    completionTime?: string;
    totalElapsedTimeMs?: number;
    concurrencyLevel?: number;
    modelUsed: string;
    ratioUsed: string;
    quantityUsed?: string;
    completedAt: string;
    fileSizeBytes: number;
    mimeType?: string;
}
/**
 * Error detail stored on a failed prompt slot.
 */
export interface SlotErrorDetail {
    code: string;
    message: string;
    timestamp: string;
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
    /** Optional scene narration for video factory storytelling */
    narration?: string;
    /** Optional scene mood descriptor */
    mood?: string;
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
    /** Centralized retry state */
    retryState?: RetryState;
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
export type FailureClassification = 'credit_exhausted' | 'quota_exhausted' | 'auth_required' | 'safety_block' | 'flow_generation_error' | 'timeout' | 'browser_error' | 'unknown';
/**
 * Explicit lifecycle states of prompt submission to Google Flow.
 */
export type SubmissionState = 'none' | 'not_submitted' | 'queued' | 'assigned' | 'preparing' | 'ready_to_submit' | 'submitting' | 'submitted' | 'generating' | 'media_detected' | 'completed' | 'failed' | 'submission_unknown';
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
export type ProjectStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'deleting';
/**
 * Complete persistent entity representing a Google Flow creation project.
 * Stored at: %LOCALAPPDATA%\GoogleFlowApp\projects\{projectId}\project.json
 */
export interface ProjectEntity {
    projectId: string;
    name: string;
    campaignTag?: string;
    channelId?: string;
    channelName?: string;
    createdAt: string;
    updatedAt: string;
    status: ProjectStatus;
    settings: ProjectSettings;
    slots: PromptSlotEntity[];
    stats: ProjectStats;
}
/**
 * All 13 valid lifecycle states for a generation job.
 */
export type JobStatus = 'pending' | 'queued' | 'assigned' | 'starting' | 'configuring' | 'generating' | 'waiting_for_result' | 'downloading' | 'completed' | 'failed' | 'retry_waiting' | 'cancelled' | 'manual_action_required';
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
    retryState?: RetryState;
    attempts?: JobAttemptRecord[];
    metadata: Record<string, unknown>;
}
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
export type AppLogLevel = 'INFO' | 'WARN' | 'DEBUG' | 'ERROR';
export interface AppSettings {
    appDataDir: string;
    defaultImageRatio: SupportedAspectRatio;
    defaultProcessingOrder?: ProcessingOrder;
    maxRetries: number;
    logLevel: AppLogLevel;
    defaultImageDownloadQuality?: 'original' | '2k';
    defaultVideoDownloadQuality?: 'original' | '1080p';
    theme?: 'dark' | 'light' | 'system';
    imageConcurrency?: number;
    defaultImageModel?: string;
    defaultVideoModel?: string;
    defaultVideoDuration?: string;
    defaultVideoResolution?: string;
    musicDirectory?: string;
    musicVolume?: number;
    defaultTtsEngine?: 'edge-tts' | 'kokoro' | 'azure' | 'ai33' | 'famespeak';
    defaultVoiceId?: string;
    scriptAiModel?: string;
    scriptAiKey?: string;
    scriptAiKeys?: string[];
    geminiApiKey?: string;
    geminiApiKeys?: string[];
    azureSpeechKey?: string;
    azureSpeechRegion?: string;
    ai33Key?: string;
    famespeakKey?: string;
    [key: string]: unknown;
}
export type GeminiKeyStatus = 'healthy' | 'temporarily_unavailable' | 'quota_limited' | 'invalid';

export interface GeminiKeySummary {
    id: string;
    masked: string;
    status: GeminiKeyStatus;
    cooldownUntil?: number | null;
    lastUsedAt?: number | null;
    failureCount?: number;
}
export type VideoFactoryMode = 'full_video' | 'from_skill' | 'images_only' | 'audio_only';

export type MotionStylePro =
  | 'breathe'
  | 'zoom_in'
  | 'zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'pan_up'
  | 'pan_down'
  | 'cinematic_dolly'
  | 'drift'
  | 'parallax';

export type MotionStyleUltra =
  | 'crash_zoom'
  | 'bullet_time'
  | 'ken_burns'
  | 'whip_pan_left'
  | 'whip_pan_right'
  | 'snap_zoom'
  | 'dolly_zoom'
  | 'shake'
  | 'pulse';

export type MotionStyleSmart = 'auto' | 'ai_director';

export type MotionStyle = MotionStylePro | MotionStyleUltra | MotionStyleSmart | 'none';

export const CLIP_RENDER_VERSION = 1;
export type TransitionStyle = 'hard_cut' | 'cross_fade' | 'none';
export interface SceneEntity {
    sceneNumber: number;
    narration: string;
    imagePrompt: string;
    mood?: string;
    durationSeconds?: number;
    wordCount?: number;
    validationStatus?: 'valid' | 'warning' | 'error';
    validationErrors?: string[];
    notes?: string;
}
export interface StoryValidationIssue {
    field: 'title' | 'scenes' | 'scene' | 'sceneNumber' | 'narration' | 'imagePrompt' | 'general';
    sceneNumber?: number;
    message: string;
    severity: 'error' | 'warning';
}
export interface StoryValidationStats {
    sceneCount: number;
    validSceneCount: number;
    errorSceneCount: number;
    warningSceneCount: number;
    totalWords: number;
    estimatedDurationSeconds: number;
}
export interface StoryValidationResult {
    isValid: boolean;
    errors: StoryValidationIssue[];
    warnings: StoryValidationIssue[];
    totalWords: number;
    estimatedDurationSeconds: number;
    stats: StoryValidationStats;
}
export interface StoryEntity {
    title: string;
    scenes: SceneEntity[];
    thumbnailPrompt?: string;
    rawScript?: string;
    createdAt: string;
    updatedAt: string;
}
export type VideoFactoryStage =
  | 'story'
  | 'images'
  | 'voice'
  | 'thumbnail'
  | 'clips'
  | 'review'
  | 'subtitles'
  | 'rendering'
  | 'export';

export type VideoFactoryStageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export type PipelineOverallStatus =
  | 'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RetryReason =
  | 'TRANSIENT_NETWORK'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PROVIDER_DOWNGRADE'
  | 'RECOVERED_RETRY'
  | 'MANUAL_USER_REQUEST'
  | 'AUTO_RETRY'
  | 'RETRY_LIMIT_EXCEEDED'
  | 'IDENTICAL_ERROR_BAILOUT'
  | 'CANCELLED_BY_USER'
  | 'NON_RETRYABLE_ERROR';

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  isAutoRetry: boolean;
  lastError?: string;
  lastErrorSignature?: string;
  identicalErrorCount: number;
  cancelledByUser: boolean;
  retryReason?: RetryReason | string;
  nextRetryTimestamp?: number;
  retryDelayMs?: number;
}

export interface RetryPolicyConfig {
  maxAutoRetries?: number;
  maxIdenticalErrors?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export interface StageState {
  stage: VideoFactoryStage;
  status: VideoFactoryStageStatus;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  error?: string;
  progress: number;
  outputs?: Record<string, unknown>;
  version: number;
  lastUpdatedAt: string;
  retryState?: RetryState;
}

export interface VideoFactoryPipelineState {
  projectId: string;
  mode: VideoFactoryMode;
  status: PipelineOverallStatus;
  currentStage: VideoFactoryStage | null;
  overallProgress: number;
  stages: Record<VideoFactoryStage, StageState>;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  runId: string;
  error?: string;
}

export interface PipelineProgressEvent {
  projectId: string;
  runId: string;
  status: PipelineOverallStatus;
  currentStage: VideoFactoryStage | null;
  stageStatus?: VideoFactoryStageStatus;
  stageProgress?: number;
  overallProgress: number;
  stageMessage?: string;
  error?: string;
  timestamp: string;
  stages?: Record<VideoFactoryStage, StageState>;
}

export type FinalOutputResolution = 'source' | '1080p' | '4k';

export interface SubtitleConfig {
    enabled?: boolean;
    preset?: string;
    position?: 'bottom' | 'center' | 'top';
    fontFamily?: string;
    fontSize?: number;
    textColor?: string;
    backgroundColor?: string;
    boxColor?: string;
    boxEnabled?: boolean;
    outlineWidth?: number;
    shadowDepth?: number;
    animation?: 'none' | 'karaoke' | 'fade' | 'pop';
    whatToShow?: 'all' | 'dialogue_only' | 'narration_only';
}

export interface VideoFactoryConfig {
    mode: VideoFactoryMode;
    story: StoryEntity;
    aspectRatio: SupportedAspectRatio;
    outputResolution?: FinalOutputResolution;
    subtitlesEnabled: boolean;
    subtitleStyle?: string;
    subtitleConfig?: SubtitleConfig;
    motionEnabled: boolean;
    motionStyle: MotionStyle;
    transitionStyle: TransitionStyle;
    crossfadeDuration?: number;
    voiceEngine: string;
    voiceId: string;
    channelId?: string;
    channelName?: string;
    musicEnabled?: boolean;
    musicPath?: string;
    musicVolume?: number;
    duckingEnabled?: boolean;
    shortsThumbnailOverlay?: boolean;
    stage: 'draft' | 'script_ready' | 'assets_queued' | 'rendering_pending' | VideoFactoryStage;
}
export type TtsProviderId = 'edge-tts' | 'kokoro' | 'azure' | 'ai33' | 'famespeak';
export type TtsEngineBadge = 'LOCAL' | 'FREE' | 'API KEY';
export interface TtsEngineMetadata {
    id: TtsProviderId;
    name: string;
    badge: TtsEngineBadge;
    audioExtension: 'mp3' | 'wav';
    supportsWordTimings: boolean;
    isAvailable: boolean;
    unavailableReason?: string;
    requiresConfig?: boolean;
}
export interface VoiceInfo {
    id: string;
    name: string;
    provider: TtsProviderId;
    locale: string;
    gender: 'male' | 'female' | 'neutral';
    description?: string;
    isAvailable: boolean;
    unavailableReason?: string;
    tier?: 'free' | 'premium';
    audioUrl?: string;
}
export interface WordTiming {
    word: string;
    startMs: number;
    durationMs: number;
}
export interface TtsSceneAudioResult {
    sceneNumber: number;
    narration: string;
    audioFile: string;
    absolutePath: string;
    durationSeconds: number;
    fileSizeBytes: number;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
    wordTimings?: WordTiming[];
    providerUsed?: TtsProviderId;
    voiceUsed?: string;
    fallbackOccurred?: boolean;
    primaryProvider?: TtsProviderId;
}
export interface TtsAudioManifest {
    projectId: string;
    provider: TtsProviderId;
    voiceId: string;
    totalScenes: number;
    totalDurationSeconds: number;
    generatedAt: string;
    scenes: TtsSceneAudioResult[];
    fallbackOccurred?: boolean;
    actualProvider?: TtsProviderId;
    masterAudioFile?: string;
    masterAudioPath?: string;
}
export type RenderSceneStatus = 'queued' | 'rendering' | 'validating' | 'completed' | 'failed' | 'cancelled';
export interface RenderProgressEvent {
    projectId: string;
    sceneNumber: number;
    totalScenes: number;
    status: RenderSceneStatus;
    progressPercent: number;
    error?: string;
}
export interface RenderSceneResult {
    sceneNumber: number;
    videoFile: string;
    subtitleFile?: string;
    absoluteVideoPath: string;
    durationSeconds: number;
    fileSizeBytes: number;
    status: 'completed' | 'failed' | 'cancelled';
    error?: string;
    clipMotionKey?: string;
    appliedMotionStyle?: MotionStyle;
    renderVersion?: number;
    attempt?: number;
    fallbackApplied?: boolean;
}
export interface RenderManifest {
    projectId: string;
    motionStyle: MotionStyle;
    transitionStyle: TransitionStyle;
    subtitleStyle?: string;
    subtitlesEnabled: boolean;
    aspectRatio: SupportedAspectRatio;
    totalScenes: number;
    renderedScenes: number;
    totalDurationSeconds: number;
    renderedAt: string;
    clipRenderVersion?: number;
    clipMotionKeys?: Record<number, string>;
    scenes: RenderSceneResult[];
}
export type FinalRenderStatus = 'queued' | 'preparing' | 'assembling' | 'mixing_audio' | 'muxing' | 'validating' | 'generating_thumbnail' | 'completed' | 'failed' | 'cancelled';
export interface FinalAssemblyOptions {
    outputResolution?: FinalOutputResolution;
    aspectRatio?: SupportedAspectRatio;
    musicPath?: string;
    musicEnabled?: boolean;
    musicVolume?: number;
    duckingEnabled?: boolean;
    transitionStyle?: TransitionStyle;
    crossfadeDuration?: number;
    shortsThumbnailOverlay?: boolean;
    thumbnailOverlayPath?: string;
    thumbnailOverlayDurationSeconds?: number;
}
export interface FinalRenderProgressEvent {
    projectId: string;
    status: FinalRenderStatus;
    progressPercent: number;
    stageMessage?: string;
    error?: string;
}
export interface FinalRenderManifest {
    projectId: string;
    status: 'completed' | 'failed' | 'cancelled';
    videoFile: string;
    absoluteVideoPath: string;
    thumbnailFile?: string;
    absoluteThumbnailPath?: string;
    posterFile?: string;
    absolutePosterPath?: string;
    durationSeconds: number;
    fileSizeBytes: number;
    width: number;
    height: number;
    fps: number;
    videoCodec: string;
    audioCodec: string;
    musicTrack?: {
        originalFilename: string;
        projectAudioPath: string;
        volume: number;
        duckingEnabled: boolean;
        looped: boolean;
        trimmed: boolean;
    };
    transitionStyle: TransitionStyle;
    totalScenes: number;
    renderedAt: string;
    error?: string;
}
export interface ExportManifest {
    projectId: string;
    exportedAt: string;
    finalVideoFile?: string;
    finalAudioFile?: string;
    channelId?: string;
    channelDelivered?: boolean;
    destinationType?: 'shorts' | 'longs' | 'general';
    collisionHandled?: boolean;
    deliveredVideoPath?: string;
}
export interface ChannelRulebook {
    narrationStyle?: string;
    visualStyle?: string;
    titleStyle?: string;
    contentRestrictions?: string;
    tone?: string;
    promptGuidelines?: string;
    topicGuidelines?: string;
    targetAudience?: string;
    contentPillars?: string[];
    avoidKeywords?: string[];
    voiceStyle?: string;
    rawMarkdown?: string;
    [key: string]: unknown;
}
export interface ChannelStats {
    totalProjects: number;
    deliveredVideos: number;
    lastDeliveredAt?: string;
}
export interface ChannelEntity {
    id: string;
    name: string;
    description?: string;
    outputDir?: string;
    shortsOutputDir?: string;
    longsOutputDir?: string;
    rulebook?: ChannelRulebook;
    defaultAspectRatio?: SupportedAspectRatio;
    defaultVoiceId?: string;
    defaultVoiceProvider?: TtsProviderId;
    defaultMotionStyle?: MotionStyle;
    defaultSubtitleStyle?: string;
    defaultTransitionStyle?: TransitionStyle;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    stats: ChannelStats;
}
export interface CreateChannelParams {
    name: string;
    description?: string;
    outputDir?: string;
    shortsOutputDir?: string;
    longsOutputDir?: string;
    rulebook?: ChannelRulebook;
    defaultAspectRatio?: SupportedAspectRatio;
    defaultVoiceId?: string;
    defaultVoiceProvider?: TtsProviderId;
    defaultMotionStyle?: MotionStyle;
    defaultSubtitleStyle?: string;
    defaultTransitionStyle?: TransitionStyle;
    enabled?: boolean;
}
export type DeliveryStatus = 'delivered' | 'failed';
export interface DeliveryHistoryRecord {
    id: string;
    projectId: string;
    projectName: string;
    channelId: string;
    channelName: string;
    sourceVideoPath: string;
    deliveredVideoPath: string;
    deliveredThumbnailPath?: string;
    deliveredPosterPath?: string;
    aspectRatio: SupportedAspectRatio;
    durationSeconds: number;
    fileSizeBytes: number;
    videoCodec: string;
    audioCodec: string;
    status: DeliveryStatus;
    deliveredAt: string;
    error?: string;
    orientation?: 'shorts' | 'longs' | 'horizontal' | 'vertical' | 'custom';
    collisionHandled?: boolean;
    runId?: string;
}
export interface ChannelHistoryQuery {
    channelId?: string;
    status?: DeliveryStatus;
    searchQuery?: string;
    limit?: number;
    offset?: number;
}
export interface ChannelHistoryResult {
    records: DeliveryHistoryRecord[];
    total: number;
    limit: number;
    offset: number;
}
export interface SkillEntity {
    id: string;
    name: string;
    description: string;
    systemInstructions: string;
    writingStyle?: string;
    structureRequirements?: string;
    sceneRequirements?: string;
    promptGuidance?: string;
    channelCompatibility?: string[];
    rawMarkdown?: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
}
export interface CreateSkillParams {
    name: string;
    description: string;
    systemInstructions: string;
    writingStyle?: string;
    structureRequirements?: string;
    sceneRequirements?: string;
    promptGuidance?: string;
    channelCompatibility?: string[];
    rawMarkdown?: string;
    enabled?: boolean;
}
export interface UpdateSkillParams extends Partial<CreateSkillParams> {
}
export type ScriptAiProviderId = 'gemini-openai' | 'mock-ai';
export interface ScriptAiConfig {
    provider: ScriptAiProviderId;
    model: string;
    apiKey?: string;
    apiKeys?: string[];
    timeoutMs?: number;
    maxRetries?: number;
}
export interface ScriptAiGenerateParams {
    topic: string;
    channelId?: string;
    skillId?: string;
    targetSceneCount?: number;
    targetDurationSeconds?: number;
    userInstructions?: string;
    tone?: string;
    aspectRatio?: SupportedAspectRatio;
}
export interface ScriptAiProgressEvent {
    stage: 'preparing' | 'generating' | 'validating' | 'completed' | 'failed';
    round: number;
    totalRounds?: number;
    charsReceived: number;
    tailSnippet?: string;
    message?: string;
}
export interface ScriptAiResult {
    success: boolean;
    story?: StoryEntity;
    validation?: StoryValidationResult;
    rawOutput?: string;
    stats?: {
        provider: string;
        model: string;
        rounds: number;
        charsReceived: number;
        durationMs: number;
        keyRotations: number;
        isMock?: boolean;
    };
    savedScriptPath?: string;
    error?: string;
}
export interface SeparateFilesInput {
    narrationText: string;
    promptsText?: string;
    thumbnailText?: string;
    title?: string;
}
export interface SystemMetrics {
    cpuPercent: number;
    freeMemMb: number;
    totalMemMb: number;
    memPercent: number;
    pingMs: number;
    timestamp: string;
}
export interface RefineSceneParams {
    target: 'narration' | 'imagePrompt' | 'both';
    scene: SceneEntity;
    userInstructions?: string;
    channelId?: string;
    skillId?: string;
    storyContext?: {
        title: string;
        allScenesSummary?: string;
    };
}
export interface RefineSceneResult {
    success: boolean;
    refinedScene?: SceneEntity;
    error?: string;
}
export interface AnalyzeAlignParams {
    rawScript: string;
}
export interface AnalyzeAlignResult {
    success: boolean;
    lineRanges?: Array<{
        sceneNumber: number;
        narrationLines?: [number, number];
        imagePromptLines?: [number, number];
    }>;
    story?: StoryEntity;
    error?: string;
}
export interface VideoFactoryDraft {
    activeMode: VideoFactoryMode;
    step: number;
    title: string;
    rawScript: string;
    scenes: SceneEntity[];
    aspectRatio: SupportedAspectRatio;
    outputResolution?: FinalOutputResolution;
    subtitlesEnabled: boolean;
    subtitleStyle?: string;
    subtitleConfig?: SubtitleConfig;
    motionEnabled: boolean;
    motionStyle: MotionStyle;
    transitionStyle: TransitionStyle;
    crossfadeDuration?: number;
    voiceEngine: string;
    voiceId: string;
    channelId?: string;
    channelName?: string;
    musicEnabled?: boolean;
    musicPath?: string;
    musicVolume?: number;
    duckingEnabled?: boolean;
    skillId?: string;
    lastSaved: string;
}
export interface ScriptParseResult {
    title?: string;
    scenes: SceneEntity[];
    thumbnailPrompt?: string;
    warnings: string[];
    layoutDetected: string;
}
export interface CreateProjectParams {
    name: string;
    campaignTag?: string;
    channelId?: string;
    channelName?: string;
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
    prompts: Array<{
        text: string;
        type: 'image' | 'video';
        sourceImagePath?: string;
        provider?: GenerationProvider;
    }>;
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
    listProjects: () => Promise<ProjectEntity[]>;
    getProject: (projectId: string) => Promise<ProjectEntity | null>;
    createProject: (params: CreateProjectParams) => Promise<ProjectEntity>;
    updateProject: (projectId: string, patch: Partial<Omit<ProjectEntity, 'projectId' | 'createdAt' | 'slots'>>) => Promise<ProjectEntity>;
    deleteProject: (projectId: string) => Promise<void>;
    deleteProjects?: (projectIds: string[]) => Promise<{
        success: boolean;
        deletedCount: number;
    }>;
    retrySlot?: (projectId: string, slotIndex: number) => Promise<void>;
    revealAsset?: (mediaPath: string) => Promise<boolean>;
    selectImageFile?: () => Promise<string | null>;
    selectMultipleImageFiles?: () => Promise<string[]>;
    selectZipFile?: () => Promise<string | null>;
    extractImageZip?: (zipPath: string) => Promise<{
        files: Array<{
            path: string;
            name: string;
        }>;
        tempDir: string;
    }>;
    exportProjectZip?: (projectId: string, slotIndices?: number[]) => Promise<{
        zipPath: string;
    }>;
    downloadSelected?: (params: {
        projectId: string;
        slotIndices: number[];
        destinationDir: string;
    }) => Promise<{
        count: number;
        destinationDir: string;
    }>;
    selectDirectory?: () => Promise<string | null>;
    startProjectGeneration: (projectId: string) => Promise<GenerationJobEntity[]>;
    cancelJob: (projectId: string, jobId: string) => Promise<void>;
    getProjectJobs: (projectId: string) => Promise<GenerationJobEntity[]>;
    getCapacityMetrics?: () => Promise<SchedulerCapacityMetrics>;
    listProfiles: () => Promise<ProfileSessionSnapshot[]>;
    createProfile: (params: {
        displayName: string;
        expectedEmail?: string;
        notes?: string;
    }) => Promise<ProfileConfig>;
    startProfile: (profileId: string) => Promise<ProfileSessionSnapshot | null>;
    stopProfile: (profileId: string) => Promise<void>;
    deleteProfile: (profileId: string) => Promise<void>;
    openChrome: (profileId: string) => Promise<{
        success: boolean;
        message: string;
    }>;
    openSignIn: (profileId: string) => Promise<{
        success: boolean;
        message: string;
    }>;
    openFlow?: (profileId: string) => Promise<{
        success: boolean;
        message: string;
        snapshot?: ProfileSessionSnapshot;
    }>;
    /**
     * Launches the dedicated Chrome window for manual login.
     * Returns as soon as the OS process is confirmed running (PID alive).
     * Does NOT wait for CDP, Playwright connection, or auth detection.
     * The Chrome window stays open for the user to sign in manually.
     */
    launchLoginBrowser: (profileId: string) => Promise<{
        success: boolean;
        pid: number;
        cdpPort: number;
        userDataDir: string;
        message: string;
    }>;
    verifyAccount: (profileId: string) => Promise<{
        success: boolean;
        status: ProfileSessionStatus;
        detectedEmail: string | null;
        error?: string;
    }>;
    testConnection: (profileId: string) => Promise<{
        success: boolean;
        port: number;
        responsive: boolean;
        status: ProfileSessionStatus;
    }>;
    detectLocalChromeProfiles?: () => Promise<Array<DiscoveredLocalProfile & {
        isOpen: boolean;
        isAttachable: boolean;
        cdpPort?: number;
    }>>;
    detectProfileState?: (target: string | {
        userDataDir?: string;
        profileDirectory?: string;
        email?: string;
        displayName?: string;
        preferredCdpPort?: number;
    }) => Promise<ExistingProfileDetectionResult>;
    createExistingProfile?: (params: {
        displayName: string;
        localProfileDirectory: string;
        localUserDataDir?: string;
        expectedEmail?: string;
        notes?: string;
        preferredCdpPort?: number;
    }) => Promise<ProfileConfig>;
    getAppInfo: () => Promise<{
        appDataDir: string;
        version: string;
        platform: string;
    }>;
    getSettings: () => Promise<AppSettings>;
    updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    getFactoryDraft?: () => Promise<VideoFactoryDraft>;
    saveFactoryDraft?: (draft: Partial<VideoFactoryDraft>) => Promise<VideoFactoryDraft>;
    parseScript?: (rawText: string) => Promise<ScriptParseResult>;
    createFactoryProject?: (config: VideoFactoryConfig) => Promise<{
        projectId: string;
        project: ProjectEntity;
    }>;
    getProjectStory?: (projectId: string) => Promise<StoryEntity | null>;
    validateStory?: (story: Partial<StoryEntity>) => Promise<StoryValidationResult>;
    updateProjectStory?: (projectId: string, story: StoryEntity) => Promise<{
        success: boolean;
        story: StoryEntity;
    }>;
    getTtsEngines?: () => Promise<TtsEngineMetadata[]>;
    listVoices?: (provider?: TtsProviderId) => Promise<VoiceInfo[]>;
    previewVoice?: (provider: TtsProviderId, voiceId: string, sampleText?: string) => Promise<{
        success: boolean;
        audioDataUri?: string;
        durationSeconds?: number;
        error?: string;
    }>;
    synthesizeProjectVoice?: (projectId: string, voiceId?: string, provider?: TtsProviderId) => Promise<TtsAudioManifest>;
    combineAudio?: (projectId: string, outputFilename?: string) => Promise<{ masterAudioPath: string; durationSeconds: number }>;
    testTtsConnection?: (provider: TtsProviderId) => Promise<{ success: boolean; message: string }>;
    getAudioManifest?: (projectId: string) => Promise<TtsAudioManifest | null>;
    renderScene?: (projectId: string, sceneNumber: number, options?: {
        motionStyle?: MotionStyle;
        subtitleStyle?: string;
        subtitlesEnabled?: boolean;
    }) => Promise<RenderSceneResult>;
    renderProjectClips?: (projectId: string, options?: {
        motionStyle?: MotionStyle;
        subtitleStyle?: string;
        subtitlesEnabled?: boolean;
        transitionStyle?: TransitionStyle;
    }) => Promise<RenderManifest>;
    cancelProjectRender?: (projectId: string) => Promise<{
        success: boolean;
    }>;
    getRenderManifest?: (projectId: string) => Promise<RenderManifest | null>;
    testTransition?: (params: {
        sceneAVideoPath: string;
        sceneBVideoPath: string;
        outputPath: string;
        transitionStyle: TransitionStyle;
        duration?: number;
    }) => Promise<{
        success: boolean;
        outputPath: string;
        duration: number;
    }>;
    assembleFinalVideo?: (projectId: string, options?: FinalAssemblyOptions) => Promise<FinalRenderManifest>;
    cancelFinalRender?: (projectId: string) => Promise<{
        success: boolean;
    }>;
    getFinalRenderManifest?: (projectId: string) => Promise<FinalRenderManifest | null>;
    selectMusicFile?: () => Promise<string | null>;
    listChannels?: () => Promise<ChannelEntity[]>;
    getChannel?: (channelId: string) => Promise<ChannelEntity | null>;
    createChannel?: (params: CreateChannelParams) => Promise<ChannelEntity>;
    updateChannel?: (channelId: string, patch: Partial<Omit<ChannelEntity, 'id' | 'createdAt' | 'stats'>>) => Promise<ChannelEntity>;
    deleteChannel?: (channelId: string) => Promise<{
        success: boolean;
        unassignedProjects: number;
    }>;
    assignProjectToChannel?: (projectId: string, channelId?: string) => Promise<ProjectEntity>;
    deliverProjectToChannel?: (projectId: string, channelId?: string) => Promise<DeliveryHistoryRecord>;
    getChannelHistory?: (query?: ChannelHistoryQuery) => Promise<ChannelHistoryResult>;
    retryDelivery?: (deliveryId: string) => Promise<DeliveryHistoryRecord>;
    selectOutputDir?: () => Promise<string | null>;
    listSkills?: () => Promise<SkillEntity[]>;
    getSkill?: (skillId: string) => Promise<SkillEntity | null>;
    createSkill?: (params: CreateSkillParams) => Promise<SkillEntity>;
    updateSkill?: (skillId: string, patch: UpdateSkillParams) => Promise<SkillEntity>;
    deleteSkill?: (skillId: string) => Promise<boolean | {
        success: boolean;
    }>;
    importSkill?: (fileContent: string | ArrayBuffer | Uint8Array, fileName?: string) => Promise<SkillEntity>;
    generateScriptAi?: (params: ScriptAiGenerateParams) => Promise<ScriptAiResult>;
    refineSceneAi?: (params: RefineSceneParams) => Promise<RefineSceneResult>;
    reReadScriptAi?: (params: AnalyzeAlignParams) => Promise<AnalyzeAlignResult>;
    testScriptAiConnection?: () => Promise<{
        success: boolean;
        error?: string;
        model?: string;
        isMock?: boolean;
    }>;
    listGeminiKeys?: () => Promise<GeminiKeySummary[]>;
    addGeminiKey?: (key: string) => Promise<{ success: boolean; keys: GeminiKeySummary[]; error?: string }>;
    removeGeminiKey?: (id: string) => Promise<{ success: boolean; keys: GeminiKeySummary[] }>;
    revealGeminiKey?: (id: string) => Promise<{ success: boolean; fullKey?: string; error?: string }>;
    onJobProgress: (callback: (event: JobProgressEvent) => void) => () => void;
    onSlotUpdated: (callback: (event: SlotUpdatedEvent) => void) => () => void;
    onJobCompleted: (callback: (job: GenerationJobEntity) => void) => () => void;
    onJobFailed: (callback: (job: GenerationJobEntity) => void) => () => void;
    onWorkerStatus: (callback: (data: {
        profileId: string;
        status: string;
        activeJobId?: string;
    }) => void) => () => void;
    onRenderProgress?: (callback: (event: RenderProgressEvent) => void) => () => void;
    onFinalRenderProgress?: (callback: (event: FinalRenderProgressEvent) => void) => () => void;
    onScriptAiProgress?: (callback: (event: ScriptAiProgressEvent) => void) => () => void;
    startPipeline?: (projectId: string, mode?: VideoFactoryMode) => Promise<VideoFactoryPipelineState>;
    pausePipeline?: (projectId: string) => Promise<VideoFactoryPipelineState>;
    resumePipeline?: (projectId: string) => Promise<VideoFactoryPipelineState>;
    cancelPipeline?: (projectId: string) => Promise<VideoFactoryPipelineState>;
    retryPipelineStage?: (projectId: string, stage: VideoFactoryStage) => Promise<VideoFactoryPipelineState>;
    getPipelineState?: (projectId: string) => Promise<VideoFactoryPipelineState | null>;
    onPipelineProgress?: (callback: (event: PipelineProgressEvent) => void) => () => void;
    getSystemMetrics?: () => Promise<SystemMetrics>;
    parseSeparateFiles?: (input: SeparateFilesInput) => Promise<ScriptParseResult>;
    selectScriptFile?: () => Promise<{ filePath: string; fileName: string; content: string } | null>;
}
export interface DiscoveredLocalProfile {
    profileDirectory: string;
    profileDisplayName: string;
    accountEmail: string | null;
    accountDisplayName: string | null;
    fullPath: string;
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
