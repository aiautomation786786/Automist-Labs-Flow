/**
 * ProfileWorker – Encapsulates a single Google Flow profile worker.
 *
 * MULTI-SLOT CONCURRENCY ARCHITECTURE:
 *  - Each ProfileWorker can hold up to `maxConcurrentJobs` simultaneous active jobs.
 *  - Each job MUST have its own dedicated Flow Page (created via ProfileSession.createJobPage()).
 *    The execution services (ImageExecutionService, VideoExecutionService) each call
 *    createJobPage() independently, so concurrent jobs on the same profile operate on
 *    fully isolated Playwright Page objects with independent:
 *      - Prompt input fields
 *      - Model selector state
 *      - Generate button click lock
 *      - Media detection / network response listeners
 *      - Submission state (submitting / submitted)
 *  - `assignJob(job)` throws only when the worker is AT FULL CAPACITY (activeJobCount >= maxConcurrentJobs).
 *  - `release(jobId)` releases ONLY the specified job slot. Other concurrent slots continue running.
 *  - `release()` with no argument clears ALL active jobs (catastrophic recovery / test teardown only).
 *  - `isBusy` = true when the worker has at least one active job (backward-compatible).
 *  - `isAvailable` = true when activeJobCount < maxConcurrentJobs AND session is ready and healthy.
 *  - `isAtCapacity` = true when no additional jobs can be accepted.
 */

import type { GenerationJobEntity } from '../../shared/types';
import { ProfileSession } from '../engine/ProfileSession';
import { FlowAutomationSession } from '../engine/FlowAutomationSession';
import { AppLogger } from '../utils/AppLogger';
import { MAX_CONCURRENT_JOBS_PER_PROFILE } from './ConcurrencyConfig';

export type WorkerState = 'idle' | 'busy' | 'error' | 'offline';

export class ProfileWorker {
  readonly profileId: string;
  readonly session: ProfileSession;
  readonly automation: FlowAutomationSession;
  readonly maxConcurrentJobs: number;
  private readonly log: AppLogger;

  // Multi-slot job tracking: jobId → GenerationJobEntity
  private _activeJobs: Map<string, GenerationJobEntity> = new Map();
  private _isError: boolean = false;
  private _lastError: string | null = null;

  constructor(profileSession: ProfileSession, maxConcurrentJobs = MAX_CONCURRENT_JOBS_PER_PROFILE) {
    this.session = profileSession;
    this.profileId = profileSession.profileId;
    this.automation = profileSession.getAutomationSession();
    this.maxConcurrentJobs = Math.max(1, maxConcurrentJobs);
    this.log = new AppLogger({ profileId: this.profileId, mirrorToStderr: false });

    this.log.info('worker', `ProfileWorker initialized for profile ${this.profileId} (maxConcurrentJobs=${this.maxConcurrentJobs})`);
  }

  // ---------------------------------------------------------------------------
  // State Accessors
  // ---------------------------------------------------------------------------

  /**
   * True if worker has at least one active job.
   * Does NOT imply the worker is at full capacity — use `isAtCapacity` for that.
   */
  get isBusy(): boolean {
    return this._activeJobs.size > 0;
  }

  /**
   * True if worker is at or above its maximum concurrent job capacity.
   * When true, no additional jobs can be assigned.
   */
  get isAtCapacity(): boolean {
    return this._activeJobs.size >= this.maxConcurrentJobs;
  }

  /**
   * True if the worker can accept another job assignment.
   * Requires: below capacity, not in error state, and the underlying session is ready.
   */
  get isAvailable(): boolean {
    return (
      this._activeJobs.size < this.maxConcurrentJobs &&
      !this._isError &&
      this.session.isReady
    );
  }

  /**
   * Current number of active jobs assigned to this worker.
   */
  get activeJobCount(): number {
    return this._activeJobs.size;
  }

  /**
   * Remaining capacity slots (how many more jobs can be assigned right now).
   */
  get remainingCapacity(): number {
    return Math.max(0, this.maxConcurrentJobs - this._activeJobs.size);
  }

  /**
   * Backward-compatible accessor: returns the first active job, or null.
   * In multi-job scenarios prefer iterating over `activeJobs`.
   */
  get currentJob(): GenerationJobEntity | null {
    const first = this._activeJobs.values().next();
    return first.done ? null : (first.value ?? null);
  }

  /**
   * All active jobs currently assigned to this worker.
   */
  get activeJobs(): GenerationJobEntity[] {
    return Array.from(this._activeJobs.values());
  }

  /**
   * Current operational state of the worker.
   *
   * 'idle'  — no active jobs, healthy.
   * 'busy'  — one or more active jobs (may still have remaining capacity).
   * 'error' — last job caused an unrecoverable error; call resetError() to recover.
   * 'offline' — not used in current implementation (future: session disconnect).
   */
  get state(): WorkerState {
    if (this._isError) return 'error';
    if (this._activeJobs.size > 0) return 'busy';
    return 'idle';
  }

  /**
   * Last recorded error message, if any.
   */
  get lastError(): string | null {
    return this._lastError;
  }

  // ---------------------------------------------------------------------------
  // Job Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Assigns a job to this worker, consuming one capacity slot.
   *
   * CAPACITY ENFORCEMENT:
   *  Throws if the worker is already at full capacity (activeJobCount >= maxConcurrentJobs).
   *  Each assigned job is expected to call createJobPage() to obtain its own isolated Flow tab.
   */
  assignJob(job: GenerationJobEntity): void {
    if (this._activeJobs.size >= this.maxConcurrentJobs) {
      throw new Error(
        `Worker "${this.profileId}" is at full capacity ` +
        `(${this._activeJobs.size}/${this.maxConcurrentJobs} slots occupied). ` +
        `Cannot assign job "${job.jobId}". ` +
        `Wait for an active job to release its slot via release(jobId).`
      );
    }

    this._activeJobs.set(job.jobId, job);
    this._isError = false;
    this._lastError = null;

    this.log.info('worker', `Assigned job ${job.jobId} (Slot ${job.slotIndex}) to worker ${this.profileId}`, {
      activeCount: this._activeJobs.size,
      maxConcurrentJobs: this.maxConcurrentJobs,
    });
  }

  /**
   * Releases a specific job slot after completion (success or failure).
   *
   * TARGETED RELEASE (recommended):
   *   worker.release(jobId) — releases only the specified job's slot.
   *   Other concurrent jobs on this worker continue uninterrupted.
   *
   * FULL RELEASE (emergency / test teardown only):
   *   worker.release() — clears ALL active job slots.
   */
  release(jobId?: string): void {
    if (jobId) {
      const had = this._activeJobs.delete(jobId);
      if (had) {
        this.log.info('worker', `Released job slot ${jobId} from worker ${this.profileId}`, {
          remainingActive: this._activeJobs.size,
          maxConcurrentJobs: this.maxConcurrentJobs,
        });
      }
    } else {
      const count = this._activeJobs.size;
      this._activeJobs.clear();
      this.log.info('worker', `Full release of worker ${this.profileId} (cleared ${count} active slots)`);
    }
  }

  /**
   * Marks the worker as in an error state, clearing all active jobs.
   */
  markError(errorMessage: string): void {
    this._isError = true;
    this._lastError = errorMessage;
    this._activeJobs.clear();

    this.log.warn('worker', `Worker ${this.profileId} marked error: ${errorMessage}`);
  }

  /**
   * Resets error state if worker has recovered (e.g. after session reconnect).
   */
  resetError(): void {
    if (this._isError) {
      this._isError = false;
      this._lastError = null;
    }
  }

  /**
   * Returns true if this worker is currently running the specified job.
   * Use this for duplicate-submission protection when a job may be retried.
   */
  isBusyWithJob(jobId: string): boolean {
    return this._activeJobs.has(jobId);
  }
}
