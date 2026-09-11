/**
 * RetryCoordinator – Centralized orchestrator for automatic retry safety,
 * bounded attempts, identical-error bailouts, and race-condition prevention.
 *
 * Requirements:
 *  - Hard maximum attempts: 60 (configurable).
 *  - Identical error bail-out: 3 consecutive identical error signatures.
 *  - Strict Manual vs. Automatic retry distinction.
 *  - User Stop/Cancel defeats pending and future automatic retries.
 *  - Bounded exponential backoff with cancellable timers.
 *  - Stale callback rejection via runId and generationToken.
 *  - Cooperative pause/resume integration.
 */

import { AppLogger } from '../utils/AppLogger';
import { ErrorClassifier } from './ErrorClassifier';
import type { RetryState, RetryPolicyConfig, RetryReason } from '../../shared/types';

const logger = new AppLogger({ mirrorToStderr: false });

export const DEFAULT_MAX_AUTO_RETRIES = 60;
export const MAX_IDENTICAL_ERRORS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 10000;
export const DEFAULT_BACKOFF_FACTOR = 1.5;

interface TrackedOperationRetry {
  projectId: string;
  operationId: string;
  attempt: number;
  maxAttempts: number;
  isAutoRetry: boolean;
  lastError?: string;
  lastErrorSignature?: string;
  identicalErrorCount: number;
  cancelledByUser: boolean;
  retryReason?: RetryReason | string;
  runId: string;
  generationToken: number;
  timerHandle?: NodeJS.Timeout | null;
  abortCleanup?: (() => void) | null;
  resolvePending?: ((value: boolean) => void) | null;
}

export interface EvaluateRetryResult {
  shouldRetry: boolean;
  reason: RetryReason | string;
  delayMs: number;
  retryState: RetryState;
}

export class RetryCoordinator {
  private static instance: RetryCoordinator | null = null;
  private operations = new Map<string, TrackedOperationRetry>();
  private projectPausedStates = new Map<string, boolean>();

  static getInstance(): RetryCoordinator {
    if (!this.instance) {
      this.instance = new RetryCoordinator();
    }
    return this.instance;
  }

  /**
   * Resets all in-memory retry tracking (for unit and integration tests).
   */
  static clearMemory(): void {
    if (this.instance) {
      for (const op of this.instance.operations.values()) {
        if (op.timerHandle) {
          clearTimeout(op.timerHandle);
        }
        if (op.abortCleanup) {
          op.abortCleanup();
        }
      }
      this.instance.operations.clear();
      this.instance.projectPausedStates.clear();
    }
    this.instance = null;
  }

  private getOpKey(projectId: string, operationId: string): string {
    return `${projectId}:${operationId}`;
  }

  /**
   * Gets or initializes an operation's tracked retry record.
   */
  private getOrCreate(
    projectId: string,
    operationId: string,
    runId = 'default',
    maxAttempts = DEFAULT_MAX_AUTO_RETRIES
  ): TrackedOperationRetry {
    const key = this.getOpKey(projectId, operationId);
    let op = this.operations.get(key);
    if (!op) {
      op = {
        projectId,
        operationId,
        attempt: 0,
        maxAttempts,
        isAutoRetry: false,
        identicalErrorCount: 0,
        cancelledByUser: false,
        runId,
        generationToken: 1,
      };
      this.operations.set(key, op);
    }
    return op;
  }

  /**
   * Returns a snapshot of the current RetryState.
   */
  getRetryState(projectId: string, operationId: string): RetryState | null {
    const key = this.getOpKey(projectId, operationId);
    const op = this.operations.get(key);
    if (!op) return null;
    return this.toSnapshot(op);
  }

  private toSnapshot(op: TrackedOperationRetry, delayMs?: number): RetryState {
    return {
      attempt: op.attempt,
      maxAttempts: op.maxAttempts,
      isAutoRetry: op.isAutoRetry,
      lastError: op.lastError,
      lastErrorSignature: op.lastErrorSignature,
      identicalErrorCount: op.identicalErrorCount,
      cancelledByUser: op.cancelledByUser,
      retryReason: op.retryReason,
      nextRetryTimestamp: delayMs ? Date.now() + delayMs : undefined,
      retryDelayMs: delayMs,
    };
  }

  /**
   * Evaluates an error, updates internal state, and decides if an automatic retry is permitted.
   */
  recordError(
    projectId: string,
    operationId: string,
    error: any,
    options: {
      runId?: string;
      provider?: string;
      stage?: string;
      errorCode?: string;
      statusCode?: number;
      policy?: RetryPolicyConfig;
      signal?: AbortSignal;
    } = {}
  ): EvaluateRetryResult {
    const runId = options.runId || 'default';
    const policy = options.policy || {};
    const maxAttempts = policy.maxAutoRetries ?? DEFAULT_MAX_AUTO_RETRIES;
    const maxIdentical = policy.maxIdenticalErrors ?? MAX_IDENTICAL_ERRORS;
    const baseDelay = policy.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const maxDelay = policy.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const backoffFactor = policy.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;

    const op = this.getOrCreate(projectId, operationId, runId, maxAttempts);
    op.runId = runId;

    const errMsg = String(error?.message || error || 'Unknown error');
    op.lastError = errMsg;

    // 1. Check user cancellation (Stop / Cancel)
    if (op.cancelledByUser || options.signal?.aborted || ErrorClassifier.isCancellation(error)) {
      op.cancelledByUser = true;
      op.retryReason = 'CANCELLED_BY_USER';
      logger.info('retry', `Retry rejected for [${projectId}:${operationId}]: cancelled by user.`);
      return {
        shouldRetry: false,
        reason: 'CANCELLED_BY_USER',
        delayMs: 0,
        retryState: this.toSnapshot(op),
      };
    }

    // 2. Check if error is inherently non-retryable
    if (!ErrorClassifier.isRetryable(error)) {
      const reason = ErrorClassifier.classifyReason(error);
      op.retryReason = reason;
      logger.warn('retry', `Retry rejected for [${projectId}:${operationId}]: non-retryable error (${reason}): ${errMsg}`);
      return {
        shouldRetry: false,
        reason,
        delayMs: 0,
        retryState: this.toSnapshot(op),
      };
    }

    // 3. Compute deterministic error signature
    const signature = ErrorClassifier.computeSignature({
      provider: options.provider,
      stage: options.stage || operationId,
      errorCode: options.errorCode || error?.code,
      statusCode: options.statusCode || error?.status || error?.statusCode,
      message: errMsg,
    });

    if (op.lastErrorSignature === signature) {
      op.identicalErrorCount++;
    } else {
      op.lastErrorSignature = signature;
      op.identicalErrorCount = 1;
    }

    // 4. Identical error bailout check (e.g. 3 consecutive identical failures)
    if (op.identicalErrorCount >= maxIdentical) {
      op.retryReason = 'IDENTICAL_ERROR_BAILOUT';
      logger.error('retry', `Identical error threshold (${maxIdentical}) reached for [${projectId}:${operationId}] with signature ${signature}. Bailing out to prevent infinite loop.`);
      return {
        shouldRetry: false,
        reason: 'IDENTICAL_ERROR_BAILOUT',
        delayMs: 0,
        retryState: this.toSnapshot(op),
      };
    }

    // 5. Maximum automatic retry limit check (e.g. 60 attempts)
    op.attempt++;
    if (op.attempt > op.maxAttempts) {
      op.retryReason = 'RETRY_LIMIT_EXCEEDED';
      logger.error('retry', `Maximum auto-retry limit (${op.maxAttempts}) reached for [${projectId}:${operationId}]. Stopping retries.`);
      return {
        shouldRetry: false,
        reason: 'RETRY_LIMIT_EXCEEDED',
        delayMs: 0,
        retryState: this.toSnapshot(op),
      };
    }

    // 6. Calculate bounded backoff delay
    const delay = Math.min(maxDelay, Math.round(baseDelay * Math.pow(backoffFactor, Math.max(0, op.attempt - 1))));
    const classifiedReason = ErrorClassifier.classifyReason(error);
    op.retryReason = classifiedReason;
    op.isAutoRetry = true;

    logger.info('retry', `Scheduling auto-retry attempt ${op.attempt}/${op.maxAttempts} for [${projectId}:${operationId}] in ${delay}ms (identical: ${op.identicalErrorCount}/${maxIdentical}, reason: ${classifiedReason})`);

    return {
      shouldRetry: true,
      reason: classifiedReason,
      delayMs: delay,
      retryState: this.toSnapshot(op, delay),
    };
  }

  /**
   * Schedules an automatic retry with cancellable timer, signal abort protection,
   * generation token validation, and pause guards.
   */
  async scheduleRetry(
    projectId: string,
    operationId: string,
    runId: string,
    delayMs: number,
    callback: () => Promise<void>,
    signal?: AbortSignal
  ): Promise<boolean> {
    const op = this.getOrCreate(projectId, operationId, runId);
    op.generationToken++;
    const token = op.generationToken;

    // Clear any previous timer
    if (op.timerHandle) {
      clearTimeout(op.timerHandle);
      op.timerHandle = null;
    }
    if (op.abortCleanup) {
      op.abortCleanup();
      op.abortCleanup = null;
    }

    if (op.cancelledByUser || signal?.aborted) {
      logger.info('retry', `Aborting retry schedule for [${projectId}:${operationId}]: cancelled.`);
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (op.timerHandle) {
          clearTimeout(op.timerHandle);
          op.timerHandle = null;
        }
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        op.abortCleanup = null;
        op.resolvePending = null;
      };

      op.resolvePending = (val: boolean) => {
        cleanup();
        resolve(val);
      };

      const onAbort = () => {
        logger.info('retry', `Pending retry delay for [${projectId}:${operationId}] aborted by signal.`);
        cleanup();
        op.cancelledByUser = true;
        resolve(false);
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = cleanup;
      }

      op.timerHandle = setTimeout(async () => {
        cleanup();

        // 1. Race condition guard: verify cancellation
        if (op.cancelledByUser || signal?.aborted) {
          logger.info('retry', `Discarding retry execution for [${projectId}:${operationId}]: cancelled before invocation.`);
          return resolve(false);
        }

        // 2. Race condition guard: verify token and runId (stale callback prevention)
        if (op.generationToken !== token || op.runId !== runId) {
          logger.warn('retry', `Discarding stale retry callback for [${projectId}:${operationId}] (token: ${token} vs active: ${op.generationToken}).`);
          return resolve(false);
        }

        // 3. Pause guard: if project is paused, do not execute
        if (this.projectPausedStates.get(projectId)) {
          logger.info('retry', `Discarding retry invocation for [${projectId}:${operationId}]: project is currently paused.`);
          return resolve(false);
        }

        try {
          await callback();
          resolve(true);
        } catch (execErr) {
          logger.warn('retry', `Error executing retried operation for [${projectId}:${operationId}]: ${(execErr as Error).message}`);
          resolve(false);
        }
      }, Math.max(0, delayMs));
    });
  }

  /**
   * Resets retry state for a manual user retry.
   * Clears failure counters and timers while preserving completed upstream work.
   */
  recordManualRetry(
    projectId: string,
    operationId: string,
    runId = 'manual'
  ): RetryState {
    const op = this.getOrCreate(projectId, operationId, runId);
    op.generationToken++;

    if (op.timerHandle) {
      clearTimeout(op.timerHandle);
      op.timerHandle = null;
    }
    if (op.abortCleanup) {
      op.abortCleanup();
      op.abortCleanup = null;
    }
    if (op.resolvePending) {
      op.resolvePending(false);
      op.resolvePending = null;
    }

    op.attempt = 0;
    op.identicalErrorCount = 0;
    op.lastError = undefined;
    op.lastErrorSignature = undefined;
    op.cancelledByUser = false;
    op.isAutoRetry = false;
    op.retryReason = 'MANUAL_USER_REQUEST';
    op.runId = runId;

    logger.info('retry', `Manual retry initiated for [${projectId}:${operationId}]. Reset retry safety counters.`);
    return this.toSnapshot(op);
  }

  /**
   * Records a successful operation, clearing failure counters.
   */
  recordSuccess(projectId: string, operationId: string): void {
    const op = this.getOrCreate(projectId, operationId);
    if (op.timerHandle) {
      clearTimeout(op.timerHandle);
      op.timerHandle = null;
    }
    if (op.abortCleanup) {
      op.abortCleanup();
      op.abortCleanup = null;
    }
    if (op.resolvePending) {
      op.resolvePending(false);
      op.resolvePending = null;
    }
    op.attempt = 0;
    op.identicalErrorCount = 0;
    op.lastError = undefined;
    op.lastErrorSignature = undefined;
    op.isAutoRetry = false;
    op.retryReason = undefined;
  }

  /**
   * Immediately defeats pending retries and forbids future auto-retries for a project or operation.
   */
  cancelRetries(projectId: string, operationId?: string): void {
    for (const [key, op] of this.operations.entries()) {
      if (op.projectId === projectId && (!operationId || op.operationId === operationId)) {
        op.cancelledByUser = true;
        op.generationToken++;
        op.retryReason = 'CANCELLED_BY_USER';
        if (op.timerHandle) {
          clearTimeout(op.timerHandle);
          op.timerHandle = null;
        }
        if (op.abortCleanup) {
          op.abortCleanup();
          op.abortCleanup = null;
        }
        if (op.resolvePending) {
          op.resolvePending(false);
          op.resolvePending = null;
        }
        logger.info('retry', `Cancelled all retries for [${key}]`);
      }
    }
  }

  /**
   * Pauses automatic retry dispatches for a project without marking it cancelled.
   */
  pauseRetries(projectId: string): void {
    this.projectPausedStates.set(projectId, true);
    logger.info('retry', `Paused auto-retries for project ${projectId}`);
  }

  /**
   * Resumes automatic retry dispatches for a project.
   */
  resumeRetries(projectId: string): void {
    this.projectPausedStates.set(projectId, false);
    logger.info('retry', `Resumed auto-retries for project ${projectId}`);
  }

  /**
   * Checks if an operation has been cancelled by the user.
   */
  isCancelled(projectId: string, operationId?: string): boolean {
    if (!operationId) {
      for (const op of this.operations.values()) {
        if (op.projectId === projectId && op.cancelledByUser) return true;
      }
      return false;
    }
    const key = this.getOpKey(projectId, operationId);
    const op = this.operations.get(key);
    return op ? op.cancelledByUser : false;
  }

  /**
   * Checks if retries are paused for a project.
   */
  isPaused(projectId: string): boolean {
    return this.projectPausedStates.get(projectId) === true;
  }

  /**
   * Clears all in-memory operations and timers (for tests and teardown).
   */
  clearMemory(): void {
    for (const op of this.operations.values()) {
      if (op.timerHandle) {
        clearTimeout(op.timerHandle);
        op.timerHandle = null;
      }
      if (op.abortCleanup) {
        op.abortCleanup();
        op.abortCleanup = null;
      }
      if (op.resolvePending) {
        op.resolvePending(false);
        op.resolvePending = null;
      }
    }
    this.operations.clear();
    this.projectPausedStates.clear();
  }
}
