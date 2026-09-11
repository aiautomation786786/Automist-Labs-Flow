import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RetryCoordinator } from '../main/retry/RetryCoordinator';
import { ErrorClassifier } from '../main/retry/ErrorClassifier';
import { RecoveryManager } from '../main/storage/RecoveryManager';
import { VideoFactoryPipelineManager } from '../main/pipeline/VideoFactoryPipelineManager';
import { VideoFactoryPipeline } from '../main/pipeline/VideoFactoryPipeline';
import { StoryRepository } from '../main/storage/StoryRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { TtsManager } from '../main/tts/TtsManager';
import { RenderManager } from '../main/render/RenderManager';
import { FinalRenderManager } from '../main/render/FinalRenderManager';
import type { StoryEntity } from '../shared/types';

describe('Phase 3: Complete ZBot Auto-Retry Safety Test Suite', () => {
  let tempDir: string;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-safety-test-'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tempDir;
    RetryCoordinator.getInstance().clearMemory();
    VideoFactoryPipelineManager.clearMemory();
  });

  afterEach(() => {
    RetryCoordinator.getInstance().clearMemory();
    VideoFactoryPipelineManager.clearMemory();
    if (prevLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = prevLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function createTestProject(name: string): Promise<string> {
    const project = await ProjectRepository.create({
      name,
      prompts: [
        { text: 'Prompt 0', type: 'image' },
        { text: 'Prompt 1', type: 'image' },
        { text: 'Prompt 2', type: 'image' },
      ],
    });
    AssetManager.ensureProjectDirectories(project.projectId);
    return project.projectId;
  }

  // ===========================================================================
  // Deterministic Scenarios A - G
  // ===========================================================================

  it('Scenario A: Max-retry exhaustion halts retries at limit and transitions to Failed', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'proj-scen-a';
    const opId = 'stage-exhaust';
    const policy = { maxAutoRetries: 4, maxIdenticalErrors: 10, baseDelayMs: 10, maxDelayMs: 100 };

    // Simulate 4 transient failures (attempts 1 to 4 should permit retry)
    for (let i = 1; i <= 4; i++) {
      // Use slightly different messages so identical-error bailout is not triggered
      const res = coordinator.recordError(projectId, opId, `Network timeout variant ${i}`, { policy });
      expect(res.shouldRetry).toBe(true);
      expect(res.retryState.attempt).toBe(i);
      expect(res.retryState.isAutoRetry).toBe(true);
    }

    // 5th failure hits max limit (5/5)
    const exhaustRes = coordinator.recordError(projectId, opId, 'Network timeout variant 5', { policy });
    expect(exhaustRes.shouldRetry).toBe(false);
    expect(exhaustRes.reason).toBe('RETRY_LIMIT_EXCEEDED');
    expect(exhaustRes.retryState.attempt).toBe(5);
    expect(exhaustRes.retryState.retryReason).toBe('RETRY_LIMIT_EXCEEDED');

    // Subsequent failure remains exhausted
    const nextRes = coordinator.recordError(projectId, opId, 'Network timeout variant 6', { policy });
    expect(nextRes.shouldRetry).toBe(false);
  });

  it('Scenario B: Identical-error bailout halts after 3 consecutive identical failures', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'proj-scen-b';
    const opId = 'stage-identical';
    const policy = { maxAutoRetries: 60, maxIdenticalErrors: 3, baseDelayMs: 10 };

    const identicalMsg = 'ECONNREFUSED 127.0.0.1:8080 connecting to server';

    // Attempt 1: should retry (identical = 1)
    const res1 = coordinator.recordError(projectId, opId, identicalMsg, { policy });
    expect(res1.shouldRetry).toBe(true);
    expect(res1.retryState.identicalErrorCount).toBe(1);

    // Attempt 2: should retry (identical = 2)
    const res2 = coordinator.recordError(projectId, opId, identicalMsg, { policy });
    expect(res2.shouldRetry).toBe(true);
    expect(res2.retryState.identicalErrorCount).toBe(2);

    // Attempt 3: BAILOUT! Exactly 3 consecutive identical failures
    const res3 = coordinator.recordError(projectId, opId, identicalMsg, { policy });
    expect(res3.shouldRetry).toBe(false);
    expect(res3.reason).toBe('IDENTICAL_ERROR_BAILOUT');
    expect(res3.retryState.identicalErrorCount).toBe(3);
    expect(res3.retryState.retryReason).toBe('IDENTICAL_ERROR_BAILOUT');

    // Confirm that it stopped well before maxAutoRetries (attempt was only 2 before bailout check)
    expect(res3.retryState.attempt).toBeLessThan(60);
  });

  it('Scenario C: User cancellation during retry delay aborts timer immediately', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'proj-scen-c';
    const opId = 'stage-cancel-delay';
    const abortController = new AbortController();

    let callbackExecuted = false;
    const retryPromise = coordinator.scheduleRetry(
      projectId,
      opId,
      'run-1',
      500, // 500ms delay
      async () => {
        callbackExecuted = true;
      },
      abortController.signal
    );

    // Cancel while timer is ticking (after 50ms)
    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();

    const success = await retryPromise;
    expect(success).toBe(false);
    expect(callbackExecuted).toBe(false);

    const state = coordinator.getRetryState(projectId, opId);
    expect(state?.cancelledByUser).toBe(true);

    // Wait past original 500ms to be 100% certain callback NEVER executed
    await new Promise((r) => setTimeout(r, 500));
    expect(callbackExecuted).toBe(false);
  });

  it('Scenario D: Pause while retry is pending blocks retry callback without cancelling', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'proj-scen-d';
    const opId = 'stage-pause';

    coordinator.pauseRetries(projectId);
    expect(coordinator.isPaused(projectId)).toBe(true);

    let callbackExecuted = false;
    const success = await coordinator.scheduleRetry(
      projectId,
      opId,
      'run-1',
      50,
      async () => {
        callbackExecuted = true;
      }
    );

    // Should return false because coordinator is paused
    expect(success).toBe(false);
    expect(callbackExecuted).toBe(false);

    // Pause must NOT convert state into cancelledByUser
    const state = coordinator.getRetryState(projectId, opId);
    expect(state?.cancelledByUser).toBe(false);

    // Resume retries allows subsequent scheduled retries to fire
    coordinator.resumeRetries(projectId);
    expect(coordinator.isPaused(projectId)).toBe(false);

    let resumedCallbackExecuted = false;
    const resumeSuccess = await coordinator.scheduleRetry(
      projectId,
      opId,
      'run-1',
      50,
      async () => {
        resumedCallbackExecuted = true;
      }
    );
    expect(resumeSuccess).toBe(true);
    expect(resumedCallbackExecuted).toBe(true);
  });

  it('Scenario E: Manual retry after failure / bailout strictly resets safety counters', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'proj-scen-e';
    const opId = 'stage-manual-reset';
    const policy = { maxAutoRetries: 5, maxIdenticalErrors: 3 };

    // Trigger identical error bailout
    for (let i = 0; i < 3; i++) {
      coordinator.recordError(projectId, opId, 'Persistent failure', { policy });
    }
    const bailedState = coordinator.getRetryState(projectId, opId);
    expect(bailedState?.retryReason).toBe('IDENTICAL_ERROR_BAILOUT');
    expect(bailedState?.identicalErrorCount).toBe(3);

    // User triggers MANUAL retry
    const resetState = coordinator.recordManualRetry(projectId, opId);
    expect(resetState.attempt).toBe(0);
    expect(resetState.identicalErrorCount).toBe(0);
    expect(resetState.isAutoRetry).toBe(false);
    expect(resetState.cancelledByUser).toBe(false);
    expect(resetState.retryReason).toBe('MANUAL_USER_REQUEST');

    // Subsequent failure starts fresh from attempt 1
    const nextError = coordinator.recordError(projectId, opId, 'Persistent failure', { policy });
    expect(nextError.shouldRetry).toBe(true);
    expect(nextError.retryState.attempt).toBe(1);
    expect(nextError.retryState.identicalErrorCount).toBe(1);
  });

  it('Scenario F: Out-of-order / stale retry callback is rejected via generationToken', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'proj-scen-f';
    const opId = 'stage-stale';

    let staleCallbackExecuted = false;
    const stalePromise = coordinator.scheduleRetry(
      projectId,
      opId,
      'run-1',
      100,
      async () => {
        staleCallbackExecuted = true;
      }
    );

    // In between, a manual retry occurs, invalidating token
    coordinator.recordManualRetry(projectId, opId);

    const staleResult = await stalePromise;
    expect(staleResult).toBe(false);
    expect(staleCallbackExecuted).toBe(false);
  });

  it('Scenario G: Restart recovery safety never restarts cancelled or retry-exhausted work', async () => {
    const projectId = await createTestProject('Crash Safety Project');

    // 1. Setup a job that was cancelled prior to interruption
    const cancelledJob = await JobRepository.createJob({
      projectId,
      promptId: 'prompt-1',
      promptType: 'image',
      provider: 'flow',
      slotIndex: 0,
      maxRetries: 5,
    });
    await JobRepository.updateJob(projectId, cancelledJob.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, cancelledJob.jobId, {
      status: 'assigned', // transient state at crash
      retryState: {
        attempt: 2,
        maxAttempts: 5,
        isAutoRetry: true,
        cancelledByUser: true,
        identicalErrorCount: 0,
        retryReason: 'CANCELLED_BY_USER',
      },
    });

    // 2. Setup a job that exhausted retries prior to interruption
    const exhaustedJob = await JobRepository.createJob({
      projectId,
      promptId: 'prompt-2',
      promptType: 'image',
      provider: 'flow',
      slotIndex: 1,
      maxRetries: 3,
    });
    await JobRepository.updateJob(projectId, exhaustedJob.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, exhaustedJob.jobId, {
      status: 'assigned', // transient state at crash
      retryCount: 3,
      retryState: {
        attempt: 3,
        maxAttempts: 3,
        isAutoRetry: true,
        cancelledByUser: false,
        identicalErrorCount: 1,
        retryReason: 'RETRY_LIMIT_EXCEEDED',
      },
    });

    // 3. Setup a pipeline with cancelled and exhausted stages
    const pipelineState = StoryRepository.initializePipelineState(projectId);
    pipelineState.status = 'running';
    pipelineState.stages.images.status = 'running';
    pipelineState.stages.images.retryState = {
      attempt: 3,
      maxAttempts: 3,
      isAutoRetry: true,
      cancelledByUser: false,
      identicalErrorCount: 3,
      retryReason: 'IDENTICAL_ERROR_BAILOUT',
    };
    await StoryRepository.savePipelineState(projectId, pipelineState);

    // Run Crash Recovery scan
    const report = await RecoveryManager.recoverAll();

    // Verify cancelled job is kept cancelled (NOT retry_waiting)
    const freshCancelled = await JobRepository.getJob(projectId, cancelledJob.jobId);
    expect(freshCancelled?.status).toBe('cancelled');

    // Verify exhausted job is marked manual_action_required (NOT retry_waiting)
    const freshExhausted = await JobRepository.getJob(projectId, exhaustedJob.jobId);
    expect(freshExhausted?.status).toBe('manual_action_required');

    // Verify pipeline with exhausted stage is marked failed (NOT paused for auto resume)
    const freshPipeline = await StoryRepository.getPipelineState(projectId);
    expect(freshPipeline?.status).toBe('failed');
    expect(freshPipeline?.stages.images.status).toBe('failed');
  });

  // ===========================================================================
  // Verification of Items 1 - 24
  // ===========================================================================

  it('Items 1 & 2: Exponential backoff increases within bounds [1000ms -> 10000ms]', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-backoff';
    const opId = 'op-backoff';
    const policy = {
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      backoffFactor: 1.5,
      maxAutoRetries: 60,
      maxIdenticalErrors: 50,
    };

    // Attempt 1 delay = 1000ms
    const r1 = coordinator.recordError(projectId, opId, 'Error 1', { policy });
    expect(r1.delayMs).toBe(1000);

    // Attempt 2 delay = 1000 * 1.5 = 1500ms
    const r2 = coordinator.recordError(projectId, opId, 'Error 2', { policy });
    expect(r2.delayMs).toBe(1500);

    // Attempt 3 delay = 1500 * 1.5 = 2250ms
    const r3 = coordinator.recordError(projectId, opId, 'Error 3', { policy });
    expect(r3.delayMs).toBe(2250);

    // Advance to many attempts: must never exceed 10000ms
    for (let i = 4; i <= 20; i++) {
      const rn = coordinator.recordError(projectId, opId, `Error ${i}`, { policy });
      expect(rn.delayMs).toBeLessThanOrEqual(10000);
    }
  });

  it('Item 3: Max retry attempt count strictly defaults to 60', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-default-60';
    const opId = 'op-60';

    const r1 = coordinator.recordError(projectId, opId, 'Timeout 1');
    expect(r1.retryState.maxAttempts).toBe(60);
  });

  it('Items 4 & 23: Error signature normalizes dynamic tokens (UUIDs, timestamps, paths)', () => {
    const sig1 = ErrorClassifier.computeSignature({
      provider: 'gemini',
      stage: 'voice',
      errorCode: 'ECONNRESET',
      message: 'Failed to write to D:\\tmp\\audio_123e4567-e89b-12d3-a456-426614174000_2026-09-11T07:23:46Z.mp3: connection reset',
    });

    const sig2 = ErrorClassifier.computeSignature({
      provider: 'gemini',
      stage: 'voice',
      errorCode: 'ECONNRESET',
      message: 'Failed to write to C:\\Users\\appdata\\audio_987fcdeb-51a2-43f7-9876-ba0987654321_2026-09-10T12:00:00Z.mp3: connection reset',
    });

    // Both messages have identical structure despite different timestamps, UUIDs, and paths
    expect(sig1).toBe(sig2);
  });

  it('Items 5 & 6: Non-identical transient errors reset identical counter and do not bailout', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-alternating';
    const opId = 'op-alt';
    const policy = { maxIdenticalErrors: 3, maxAutoRetries: 20 };

    coordinator.recordError(projectId, opId, 'Network error A', { policy });
    coordinator.recordError(projectId, opId, 'Network error A', { policy });
    expect(coordinator.getRetryState(projectId, opId)?.identicalErrorCount).toBe(2);

    // Third error is different
    coordinator.recordError(projectId, opId, 'Gateway timeout 504', { policy });
    expect(coordinator.getRetryState(projectId, opId)?.identicalErrorCount).toBe(1);

    // Another error A: identical counter starts fresh from 1
    const r4 = coordinator.recordError(projectId, opId, 'Network error A', { policy });
    expect(r4.shouldRetry).toBe(true);
    expect(coordinator.getRetryState(projectId, opId)?.identicalErrorCount).toBe(1);
  });

  it('Items 7, 8 & 9: cancelRetries immediately aborts active timers and marks cancelledByUser', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-cancel-all';
    const opId = 'op-cancel-1';

    let called = false;
    const p = coordinator.scheduleRetry(projectId, opId, 'run-1', 200, async () => {
      called = true;
    });

    coordinator.cancelRetries(projectId, opId);
    const res = await p;
    expect(res).toBe(false);
    expect(called).toBe(false);

    const state = coordinator.getRetryState(projectId, opId);
    expect(state?.cancelledByUser).toBe(true);
    expect(state?.retryReason).toBe('CANCELLED_BY_USER');
  });

  it('Items 10, 11 & 12: Pause and resume lifecycle works without marking cancelled', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-pause-resume';
    const opId = 'op-pause';

    coordinator.pauseRetries(projectId);
    const stateBefore = coordinator.getRetryState(projectId, opId);
    expect(stateBefore?.cancelledByUser).toBeFalsy();

    coordinator.resumeRetries(projectId);
    let executed = false;
    const ok = await coordinator.scheduleRetry(projectId, opId, 'run-1', 10, async () => {
      executed = true;
    });
    expect(ok).toBe(true);
    expect(executed).toBe(true);
  });

  it('Items 13-17: Manual retry resets counters and preserves upstream stage assets', async () => {
    const projectId = await createTestProject('Upstream Preservation');
    const pipelineState = StoryRepository.initializePipelineState(projectId);

    // Complete upstream stages
    pipelineState.stages.story.status = 'completed';
    pipelineState.stages.images.status = 'completed';
    pipelineState.stages.voice.status = 'failed';
    pipelineState.stages.voice.retryState = {
      attempt: 10,
      maxAttempts: 10,
      isAutoRetry: true,
      cancelledByUser: false,
      identicalErrorCount: 3,
      retryReason: 'RETRY_LIMIT_EXCEEDED',
    };
    await StoryRepository.savePipelineState(projectId, pipelineState);

    // Coordinator records manual retry
    const reset = RetryCoordinator.getInstance().recordManualRetry(projectId, 'voice');
    expect(reset.attempt).toBe(0);
    expect(reset.identicalErrorCount).toBe(0);
    expect(reset.cancelledByUser).toBe(false);
    expect(reset.isAutoRetry).toBe(false);

    // Upstream stage state on disk remains completed
    const current = await StoryRepository.getPipelineState(projectId);
    expect(current?.stages.story.status).toBe('completed');
    expect(current?.stages.images.status).toBe('completed');
  });

  it('Item 18: Stale callback with mismatched runId is ignored', async () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-stale-run';
    const opId = 'op-stale';

    let called = false;
    const p = coordinator.scheduleRetry(projectId, opId, 'old-run-id', 50, async () => {
      called = true;
    });

    // Pipeline starts a new run
    coordinator.recordManualRetry(projectId, opId);
    // New error recorded with fresh runId
    coordinator.recordError(projectId, opId, 'New failure', { runId: 'new-run-id' });

    const result = await p;
    expect(result).toBe(false);
    expect(called).toBe(false);
  });

  it('Items 19-22: Crash recovery never automatically restarts cancelled or retry-exhausted work', async () => {
    const projectId = await createTestProject('Recovery Invariants');

    // Interrupted job with retry exhausted
    const job = await JobRepository.createJob({
      projectId,
      promptId: 'prompt-exhaust',
      promptType: 'image',
      provider: 'flow',
      slotIndex: 0,
      maxRetries: 2,
    });
    await JobRepository.updateJob(projectId, job.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, job.jobId, {
      status: 'assigned',
      retryCount: 2,
      retryState: {
        attempt: 2,
        maxAttempts: 2,
        isAutoRetry: true,
        cancelledByUser: false,
        identicalErrorCount: 1,
        retryReason: 'RETRY_LIMIT_EXCEEDED',
      },
    });

    await RecoveryManager.recoverAll();

    const recoveredJob = await JobRepository.getJob(projectId, job.jobId);
    expect(recoveredJob?.status).toBe('manual_action_required');
    expect(recoveredJob?.status).not.toBe('retry_waiting');
  });

  it('Item 24: Non-retryable errors (auth, quota, safety) bail out immediately', () => {
    const coordinator = RetryCoordinator.getInstance();
    const projectId = 'p-non-retryable';

    // 401 unauthorized
    const authErr = { statusCode: 401, message: 'Unauthorized API key' };
    expect(ErrorClassifier.isRetryable(authErr)).toBe(false);
    const authRes = coordinator.recordError(projectId, 'auth-op', authErr);
    expect(authRes.shouldRetry).toBe(false);
    expect(authRes.reason).toBe('NON_RETRYABLE_ERROR');

    // Safety block
    const safetyErr = { message: 'Image rejected by safety block filter' };
    expect(ErrorClassifier.isRetryable(safetyErr)).toBe(false);
    const safetyRes = coordinator.recordError(projectId, 'safety-op', safetyErr);
    expect(safetyRes.shouldRetry).toBe(false);
    expect(safetyRes.reason).toBe('NON_RETRYABLE_ERROR');

    // Quota exhaustion
    const quotaErr = { message: 'Resource has been exhausted (quota limit reached)' };
    expect(ErrorClassifier.isRetryable(quotaErr)).toBe(false);
    const quotaRes = coordinator.recordError(projectId, 'quota-op', quotaErr);
    expect(quotaRes.shouldRetry).toBe(false);
    expect(quotaRes.reason).toBe('NON_RETRYABLE_ERROR');
  });
});
