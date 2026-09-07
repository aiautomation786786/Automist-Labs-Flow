/**
 * ProfileWorker – Encapsulates a single Google Flow profile worker.
 *
 * HARD CONCURRENCY GUARANTEE:
 *  - Exactly ONE active job per profile worker at any given time.
 *  - Rejects second job assignment if currently busy.
 *  - Owns its ProfileSession and FlowAutomationSession exclusively.
 *  - Never shares browser, page, or context objects with another worker.
 */

import type { GenerationJobEntity } from '../../shared/types';
import { ProfileSession } from '../engine/ProfileSession';
import { FlowAutomationSession } from '../engine/FlowAutomationSession';
import { AppLogger } from '../utils/AppLogger';

export type WorkerState = 'idle' | 'busy' | 'error' | 'offline';

export class ProfileWorker {
  readonly profileId: string;
  readonly session: ProfileSession;
  readonly automation: FlowAutomationSession;
  private readonly log: AppLogger;

  private _currentJob: GenerationJobEntity | null = null;
  private _state: WorkerState = 'idle';
  private _lastError: string | null = null;

  constructor(profileSession: ProfileSession) {
    this.session = profileSession;
    this.profileId = profileSession.profileId;
    this.automation = profileSession.getAutomationSession();
    this.log = new AppLogger({ profileId: this.profileId, mirrorToStderr: false });

    this.log.info('worker', `ProfileWorker initialized for profile ${this.profileId}`);
  }

  /**
   * True if worker is actively executing a generation task.
   */
  get isBusy(): boolean {
    return this._currentJob !== null || this._state === 'busy';
  }

  /**
   * True if worker is online, connected, and ready to accept a task.
   */
  get isAvailable(): boolean {
    return !this.isBusy && this._state === 'idle' && this.session.isReady;
  }

  /**
   * Current active job assigned to this worker, or null.
   */
  get currentJob(): GenerationJobEntity | null {
    return this._currentJob;
  }

  /**
   * Current operational state of the worker.
   */
  get state(): WorkerState {
    return this._state;
  }

  /**
   * Last recorded error message, if any.
   */
  get lastError(): string | null {
    return this._lastError;
  }

  /**
   * Assigns a job to this worker.
   *
   * STRICT ENFORCEMENT:
   *  Throws if the worker is already busy.
   */
  assignJob(job: GenerationJobEntity): void {
    if (this.isBusy) {
      throw new Error(
        `Worker "${this.profileId}" is currently busy processing job "${this._currentJob?.jobId}". ` +
        `Cannot assign job "${job.jobId}". One-job-per-profile violation prevented.`
      );
    }

    this._currentJob = job;
    this._state = 'busy';
    this._lastError = null;

    this.log.info('worker', `Assigned job ${job.jobId} (Slot ${job.slotIndex}) to worker ${this.profileId}`);
  }

  /**
   * Releases this worker after a job finishes (successfully or failed).
   * Marks the worker idle and clears the active job reference.
   */
  release(): void {
    const previousJobId = this._currentJob?.jobId;
    this._currentJob = null;
    this._state = 'idle';

    this.log.info('worker', `Released worker ${this.profileId}`, { previousJobId });
  }

  /**
   * Marks the worker as in an error state.
   */
  markError(errorMessage: string): void {
    this._state = 'error';
    this._lastError = errorMessage;
    this._currentJob = null;

    this.log.warn('worker', `Worker ${this.profileId} marked error: ${errorMessage}`);
  }

  /**
   * Resets error state if worker has recovered.
   */
  resetError(): void {
    if (this._state === 'error') {
      this._state = 'idle';
      this._lastError = null;
    }
  }
}
