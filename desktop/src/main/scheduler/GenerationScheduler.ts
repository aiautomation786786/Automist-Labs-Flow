/**
 * GenerationScheduler – Multi-worker FIFO task dispatcher and persistent job orchestrator.
 *
 * GUARANTEES:
 *  1. Event-Driven: Dispatches on worker-available and job-queued events. (No tight polling loops).
 *  2. Concurrency Control: Exactly one active job per profile worker.
 *  3. Idempotency: Verifies job eligibility, avoids duplicate assignments, and prevents overwriting
 *     valid completed slots.
 *  4. Deterministic Slot Integrity: Slot ordering is NEVER modified by completion time or priority.
 *  5. Processing Priority:
 *     - IMAGES_FIRST: Image jobs take precedence over video jobs.
 *     - VIDEOS_FIRST: Video jobs take precedence over image jobs.
 *     - AUTOMATIC: Deterministic queue order regardless of type.
 *  6. Controlled Retries: Retries transient errors up to maxRetries; moves unrecoverable/CAPTCHA errors
 *     to manual_action_required without looping.
 */

import type {
  GenerationJobEntity,
  ProcessingOrder,
  ProjectEntity,
} from '../../shared/types';
import { JobRepository } from '../storage/JobRepository';
import { ProjectRepository } from '../storage/ProjectRepository';
import { WorkerPool } from './WorkerPool';
import { ProfileWorker } from './ProfileWorker';
import { ImageExecutionService, type ExecutionOptions } from '../execution/ImageExecutionService';
import { VideoExecutionService } from '../execution/VideoExecutionService';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

/** Non-retryable error substrings that require manual intervention */
const MANUAL_ACTION_KEYWORDS = [
  'authentication',
  'login_required',
  'captcha',
  'challenge',
  'nano banana 2',
  'model verification failed',
  'aspect ratio verification failed',
  'quota',
];

export class GenerationScheduler {
  private readonly workerPool: WorkerPool;
  private readonly executionOptions: ExecutionOptions;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private isDispatching = false;
  private isStopped = false;

  constructor(workerPool: WorkerPool, executionOptions: ExecutionOptions = {}) {
    this.workerPool = workerPool;
    this.executionOptions = executionOptions;

    this.setupEventListeners();
    this.startReconciliationLoop();

    logger.info('scheduler', 'GenerationScheduler initialized');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Enqueues all draft or retryable slots in a project for generation.
   */
  async enqueueProject(projectId: string): Promise<GenerationJobEntity[]> {
    const project = await ProjectRepository.get(projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" not found.`);
    }

    await ProjectRepository.update(projectId, { status: 'queued' });

    const createdJobs: GenerationJobEntity[] = [];

    for (const slot of project.slots) {
      // Only enqueue slots that are draft, failed, or cancelled
      if (slot.status === 'draft' || slot.status === 'failed' || slot.status === 'cancelled') {
        const job = await JobRepository.createJob({
          projectId,
          promptId: slot.promptId,
          promptType: slot.type,
          slotIndex: slot.slotIndex,
          maxRetries: project.settings.maxRetries,
        });

        // Transition from pending to queued
        const queuedJob = await JobRepository.updateJob(projectId, job.jobId, { status: 'queued' });

        await ProjectRepository.updateSlot(projectId, slot.slotIndex, {
          status: 'queued',
          activeJobId: job.jobId,
        });

        createdJobs.push(queuedJob);
        generationEventBus.emitTyped('job:queued', queuedJob);
      }
    }

    logger.info('scheduler', `Enqueued ${createdJobs.length} jobs for project ${projectId}`);

    // Trigger immediate event-driven dispatch
    this.triggerDispatch();

    return createdJobs;
  }

  /**
   * Cancels a specific job if queued or in-flight.
   */
  async cancelJob(projectId: string, jobId: string): Promise<void> {
    const job = await JobRepository.getJob(projectId, jobId);
    if (!job) return;

    if (job.status === 'completed') {
      logger.warn('scheduler', `Cannot cancel already completed job ${jobId}`);
      return;
    }

    const cancelledJob = await JobRepository.updateJob(projectId, jobId, { status: 'cancelled' });
    await ProjectRepository.updateSlot(projectId, job.slotIndex, { status: 'cancelled' });

    generationEventBus.emitTyped('job:cancelled', cancelledJob);
    logger.info('scheduler', `Cancelled job ${jobId}`);
  }

  /**
   * Stops the scheduler and clears background safety timers.
   */
  stop(): void {
    this.isStopped = true;
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    logger.info('scheduler', 'GenerationScheduler stopped');
  }

  // ---------------------------------------------------------------------------
  // Core Dispatch Engine
  // ---------------------------------------------------------------------------

  /**
   * Triggers an evaluation of the queue to assign jobs to available workers.
   */
  triggerDispatch(): void {
    if (this.isStopped || this.isDispatching) return;

    // Run asynchronously to avoid blocking the event caller
    setImmediate(() => {
      this.dispatchLoop().catch((err) => {
        logger.error('scheduler', 'Error in dispatch loop', err as Error);
      });
    });
  }

  private async dispatchLoop(): Promise<void> {
    if (this.isDispatching || this.isStopped) return;
    this.isDispatching = true;

    try {
      while (!this.isStopped) {
        // Step 1: Find next available worker
        const worker = this.workerPool.getAvailableWorker();
        if (!worker) {
          // No free workers available; wait for next worker:available event
          break;
        }

        // Step 2: Find next eligible job across active projects
        const jobMatch = await this.findNextEligibleJob();
        if (!jobMatch) {
          // No queued jobs ready for dispatch
          break;
        }

        const { job, project } = jobMatch;

        // Step 3: Idempotency check: verify job is still queued and slot not completed
        const slot = project.slots.find((s) => s.slotIndex === job.slotIndex);
        if (!slot || slot.status === 'completed' || job.status !== 'queued') {
          logger.warn('scheduler', `Skipping non-eligible job ${job.jobId} (Slot ${job.slotIndex})`);
          continue;
        }

        // Step 4: Assign worker
        worker.assignJob(job);

        const assignedJob = await JobRepository.updateJob(job.projectId, job.jobId, {
          status: 'assigned',
          profileId: worker.profileId,
        });

        await ProjectRepository.updateSlot(job.projectId, job.slotIndex, {
          status: 'running',
          assignedProfileId: worker.profileId,
        });

        await ProjectRepository.update(job.projectId, { status: 'running' });

        generationEventBus.emitTyped('job:assigned', assignedJob, worker.profileId);
        generationEventBus.emitTyped('worker:busy', worker.profileId, job.jobId);

        // Step 5: Execute job asynchronously on the worker
        this.executeJobOnWorker(worker, assignedJob).catch((err) => {
          logger.error('scheduler', `Unhandled error executing job ${job.jobId}`, err as Error);
        });
      }
    } finally {
      this.isDispatching = false;
    }
  }

  /**
   * Executes the job on the designated worker and handles errors & retries.
   */
  private async executeJobOnWorker(worker: ProfileWorker, job: GenerationJobEntity): Promise<void> {
    try {
      if (job.promptType === 'image') {
        await ImageExecutionService.execute(worker, job, {
          ...this.executionOptions,
          concurrencyLevel: Math.max(1, this.workerPool.busyCount),
        });
      } else {
        await VideoExecutionService.execute(worker, job, {
          ...this.executionOptions,
          concurrencyLevel: Math.max(1, this.workerPool.busyCount),
        });
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      await this.handleJobFailure(job, errorMsg);
    }
  }

  /**
   * Evaluates a job failure, applying the retry or manual-action policy.
   */
  private async handleJobFailure(job: GenerationJobEntity, errorMessage: string): Promise<void> {
    const isManualAction = MANUAL_ACTION_KEYWORDS.some((kw) =>
      errorMessage.toLowerCase().includes(kw.toLowerCase())
    );

    const isRetryable = !isManualAction && job.retryCount < job.maxRetries;

    if (isRetryable) {
      const newRetryCount = job.retryCount + 1;
      logger.info('scheduler', `Scheduling retry for job ${job.jobId} (Attempt ${newRetryCount}/${job.maxRetries})`);

      await JobRepository.updateJob(job.projectId, job.jobId, {
        status: 'retry_waiting',
        retryCount: newRetryCount,
        errorMessage,
      });

      generationEventBus.emitTyped('job:retrying', job, newRetryCount);

      // Backoff delay before re-queuing (e.g., 3s)
      setTimeout(async () => {
        if (this.isStopped) return;
        try {
          const reQueued = await JobRepository.updateJob(job.projectId, job.jobId, { status: 'queued' });
          generationEventBus.emitTyped('job:queued', reQueued);
          this.triggerDispatch();
        } catch (e) {
          logger.warn('scheduler', `Failed to re-queue retry job ${job.jobId}`, {
            error: (e as Error).message,
          });
        }
      }, 3000);
    } else if (isManualAction) {
      logger.warn('scheduler', `Job ${job.jobId} requires manual intervention: ${errorMessage}`);
      await JobRepository.updateJob(job.projectId, job.jobId, {
        status: 'manual_action_required',
        errorMessage,
      });
    } else {
      logger.error('scheduler', `Job ${job.jobId} permanently failed. Retries exhausted.`);
      await JobRepository.updateJob(job.projectId, job.jobId, {
        status: 'failed',
        errorMessage,
      });
    }
  }

  /**
   * Scans active projects and finds the next queued job matching the project's ProcessingOrder.
   */
  private async findNextEligibleJob(): Promise<{ job: GenerationJobEntity; project: ProjectEntity } | null> {
    const projects = await ProjectRepository.getAll();

    for (const project of projects) {
      if (project.status !== 'queued' && project.status !== 'running') {
        continue;
      }

      const allJobs = await JobRepository.getJobsByProject(project.projectId);
      const queuedJobs = allJobs.filter((j) => j.status === 'queued');

      if (queuedJobs.length === 0) continue;

      const selectedJob = this.sortJobsByProcessingOrder(queuedJobs, project.settings.processingOrder);
      if (selectedJob) {
        return { job: selectedJob, project };
      }
    }

    return null;
  }

  /**
   * Sorts queued jobs according to the project's processing order:
   *  - images_first: picks image jobs first
   *  - videos_first: picks video jobs first
   *  - automatic: picks earliest queued job
   */
  private sortJobsByProcessingOrder(
    jobs: GenerationJobEntity[],
    order: ProcessingOrder
  ): GenerationJobEntity | null {
    if (jobs.length === 0) return null;

    if (order === 'images_first') {
      const imageJob = jobs.find((j) => j.promptType === 'image');
      if (imageJob) return imageJob;
      return jobs[0]!;
    }

    if (order === 'videos_first') {
      const videoJob = jobs.find((j) => j.promptType === 'video');
      if (videoJob) return videoJob;
      return jobs[0]!;
    }

    // automatic / FIFO
    return jobs[0]!;
  }

  // ---------------------------------------------------------------------------
  // Event & Safety Loop
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    // Whenever a worker becomes available, check if jobs are waiting
    generationEventBus.onTyped('worker:available', () => {
      this.triggerDispatch();
    });

    // Whenever a new job is queued, check if a worker is free
    generationEventBus.onTyped('job:queued', () => {
      this.triggerDispatch();
    });
  }

  /**
   * Periodic safety net (runs every 5s) to reconcile queue state without high CPU usage.
   */
  private startReconciliationLoop(): void {
    this.reconciliationTimer = setInterval(() => {
      if (!this.isStopped && !this.isDispatching) {
        this.triggerDispatch();
      }
    }, 5000);
  }
}
