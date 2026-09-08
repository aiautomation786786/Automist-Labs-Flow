/**
 * JobStateMachine – Strict transition validator for the 13 generation job states.
 *
 * All state mutations for GenerationJobEntity must pass through validateTransition().
 * Rejects illegal or corrupt transitions with a descriptive error.
 */

import type { JobStatus } from './types';

/**
 * Map defining all valid next states for each given source state.
 */
const LEGAL_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  // Initial state before scheduling
  pending: ['queued', 'cancelled'],

  // In the scheduler queue waiting for a free worker
  queued: ['assigned', 'cancelled'],

  // Assigned to an available profile worker
  assigned: ['starting', 'cancelled', 'failed', 'retry_waiting', 'manual_action_required'],

  // Worker is preparing the browser / navigating
  starting: ['configuring', 'generating', 'completed', 'failed', 'retry_waiting', 'manual_action_required', 'cancelled'],

  // Worker is setting up model (Nano Banana 2) and ratio (16:9 / 9:16)
  configuring: ['generating', 'completed', 'failed', 'retry_waiting', 'manual_action_required', 'cancelled'],

  // Prompt submitted to Flow, generation in progress
  generating: ['waiting_for_result', 'downloading', 'completed', 'failed', 'retry_waiting', 'manual_action_required'],

  // Polling for new generated media elements
  waiting_for_result: ['downloading', 'completed', 'failed', 'retry_waiting', 'manual_action_required'],

  // Non-navigating background download in progress
  downloading: ['completed', 'failed', 'retry_waiting', 'manual_action_required'],

  // Terminal success state
  completed: [],

  // Terminal failure (retries exhausted or non-retryable)
  failed: ['retry_waiting', 'manual_action_required', 'failed'],

  // Waiting for retry timer before re-entering queue
  retry_waiting: ['queued', 'cancelled', 'failed'],

  // User or system cancelled
  cancelled: [],

  // Blocked on user action (CAPTCHA, Google OAuth, prompt blocked)
  manual_action_required: ['queued', 'cancelled', 'failed'],
};

/**
 * States considered transient / in-flight (used for startup crash recovery).
 */
const TRANSIENT_STATES: ReadonlySet<JobStatus> = new Set([
  'assigned',
  'starting',
  'configuring',
  'generating',
  'waiting_for_result',
  'downloading',
]);

/**
 * Terminal states from which no normal work is dispatched.
 */
const TERMINAL_STATES: ReadonlySet<JobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export class JobStateMachine {
  /**
   * Validates whether transitioning from `from` to `to` is legally permitted.
   * Throws an Error if the transition is invalid.
   */
  static validateTransition(from: JobStatus, to: JobStatus, jobId?: string): void {
    if (from === to) {
      return; // Idempotent no-op
    }

    const allowed = LEGAL_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      const jobDesc = jobId ? ` for job "${jobId}"` : '';
      throw new Error(
        `Illegal job state transition${jobDesc}: cannot transition from "${from}" to "${to}". ` +
        `Allowed transitions from "${from}": [${(allowed ?? []).join(', ')}]`
      );
    }
  }

  /**
   * Returns true if the transition from `from` to `to` is permitted.
   */
  static canTransition(from: JobStatus, to: JobStatus): boolean {
    if (from === to) return true;
    const allowed = LEGAL_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Returns true if the state is transient (interrupted if application crashed).
   */
  static isTransient(status: JobStatus): boolean {
    return TRANSIENT_STATES.has(status);
  }

  /**
   * Returns true if the state is terminal.
   */
  static isTerminal(status: JobStatus): boolean {
    return TERMINAL_STATES.has(status);
  }
}
