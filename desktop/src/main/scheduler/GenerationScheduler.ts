/**
 * GenerationScheduler – Multi-worker FIFO task dispatcher and persistent job orchestrator.
 *
 * GUARANTEES:
 *  1. Event-Driven: Dispatches on worker-available and job-queued events. (No tight polling loops).
 *  2. Concurrency Control: Up to `maxConcurrentJobs` active jobs per profile worker.
 *     Each job runs on its own dedicated Flow Page (isolated tab). The dispatch loop
 *     continues assigning until all workers are at capacity OR the queue is empty.
 *  3. Idempotency: Verifies job eligibility, avoids duplicate assignments, and prevents overwriting
 *     valid completed slots.
 *  4. Deterministic Slot Integrity: Slot ordering is NEVER modified by completion time or priority.
 *  5. Processing Priority:
 *     - IMAGES_FIRST: Image jobs take precedence over video jobs.
 *     - VIDEOS_FIRST: Video jobs take precedence over image jobs.
 *     - AUTOMATIC: Deterministic queue order regardless of type.
 *  6. Controlled Retries: Retries transient errors up to maxRetries; moves unrecoverable/CAPTCHA errors
 *     to manual_action_required without looping.
 *  7. Dynamic Refill: When any job's slot is released (worker.release(jobId)), the worker:available
 *     event triggers an immediate dispatch pass to fill the freed slot.
 */

import type {
  GenerationJobEntity,
  ProcessingOrder,
  ProjectEntity,
  SchedulerCapacityMetrics,
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
  private hasPendingDispatch = false;
  private isStopped = false;
  private inFlightJobIds: Set<string> = new Set();

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
          sourceImagePath: slot.sourceImagePath,
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

    this.inFlightJobIds.delete(jobId);
    const cancelledJob = await JobRepository.updateJob(projectId, jobId, { status: 'cancelled' });
    await ProjectRepository.updateSlot(projectId, job.slotIndex, { status: 'cancelled' });

    generationEventBus.emitTyped('job:cancelled', cancelledJob);
    logger.info('scheduler', `Cancelled job ${jobId}`);
  }

  /**
   * Returns live scheduler capacity metrics across all profiles and active jobs.
   */
  async getCapacityMetrics(): Promise<SchedulerCapacityMetrics> {
    const pending = await this.getPendingJobsCount();
    return this.workerPool.getCapacityMetrics(pending);
  }

  /**
   * Calculates total queued jobs awaiting execution across all active projects.
   */
  async getPendingJobsCount(): Promise<number> {
    try {
      const projects = await ProjectRepository.getAll();
      let pending = 0;
      for (const project of projects) {
        if (project.status === 'queued' || project.status === 'running') {
          const allJobs = await JobRepository.getJobsByProject(project.projectId);
          pending += allJobs.filter(
            (j) => j.status === 'queued' && !this.inFlightJobIds.has(j.jobId)
          ).length;
        }
      }
      return pending;
    } catch {
      return 0;
    }
  }

  /**
   * Safely cancels all queued or in-flight jobs for a project before deletion.
   */
  async cancelProject(projectId: string): Promise<void> {
    try {
      const jobs = await JobRepository.getJobsByProject(projectId).catch(() => []);
      for (const job of jobs) {
        if (job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'failed') {
          await this.cancelJob(projectId, job.jobId).catch(() => {});
        }
      }
      logger.info('scheduler', `Cancelled all pending/active jobs for project ${projectId}`);
    } catch (err) {
      logger.warn('scheduler', `Error cancelling project ${projectId}: ${(err as Error).message}`);
    }
  }

  /**
   * Safely retries a failed or cancelled prompt slot in a project without duplicating jobs.
   */
  async retrySlot(projectId: string, slotIndex: number): Promise<GenerationJobEntity> {
    const project = await ProjectRepository.get(projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" not found.`);
    }

    const slot = project.slots.find((s) => s.slotIndex === slotIndex);
    if (!slot) {
      throw new Error(`Slot ${slotIndex} not found in project "${projectId}".`);
    }

    if (slot.status === 'completed') {
      throw new Error(`Cannot retry already completed slot ${slotIndex}.`);
    }

    if (slot.status === 'running') {
      throw new Error(`Slot ${slotIndex} is already running.`);
    }

    // Create a new job for this slot
    const job = await JobRepository.createJob({
      projectId,
      promptId: slot.promptId,
      promptType: slot.type,
      slotIndex: slot.slotIndex,
      sourceImagePath: slot.sourceImagePath,
      maxRetries: project.settings.maxRetries,
    });

    const queuedJob = await JobRepository.updateJob(projectId, job.jobId, { status: 'queued' });

    await ProjectRepository.updateSlot(projectId, slot.slotIndex, {
      status: 'queued',
      activeJobId: job.jobId,
      error: undefined,
    });

    await ProjectRepository.update(projectId, { status: 'running' });

    generationEventBus.emitTyped('job:queued', queuedJob);
    generationEventBus.emitTyped('slot:updated', {
      projectId,
      slotIndex: slot.slotIndex,
      promptId: slot.promptId,
      status: 'queued',
      timestamp: new Date().toISOString(),
    });

    logger.info('scheduler', `Retrying slot ${slotIndex} in project ${projectId}`);
    this.triggerDispatch();

    return queuedJob;
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
    if (this.isStopped) return;
    if (this.isDispatching) {
      this.hasPendingDispatch = true;
      return;
    }

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
        this.hasPendingDispatch = false;

        // Step 1: Collect and assign all eligible jobs across all available execution contexts in burst
        const assignments = await this.collectAndAssignEligibleJobs();
        if (assignments.length === 0) {
          break;
        }

        // Step 2: Concurrently persist assignments and launch jobs asynchronously
        await Promise.all(
          assignments.map(async ({ worker, job, project }) => {
            try {
              const assignedJob = await JobRepository.updateJob(job.projectId, job.jobId, {
                status: 'assigned',
                profileId: worker.profileId,
              });

              await ProjectRepository.updateSlot(job.projectId, job.slotIndex, {
                status: 'running',
                assignedProfileId: worker.profileId,
              });

              if (project.status !== 'running') {
                project.status = 'running';
                await ProjectRepository.update(job.projectId, { status: 'running' }).catch(() => {});
              }

              generationEventBus.emitTyped('job:assigned', assignedJob, worker.profileId);
              generationEventBus.emitTyped('worker:busy', worker.profileId, job.jobId);

              // Step 3: Execute job asynchronously without awaiting long-running browser generation
              this.executeJobOnWorker(worker, assignedJob)
                .catch((err) => {
                  logger.error('scheduler', `Unhandled error executing job ${job.jobId}`, err as Error);
                })
                .finally(() => {
                  this.inFlightJobIds.delete(job.jobId);
                });
            } catch (err) {
              logger.error('scheduler', `Error persisting assigned job ${job.jobId}`, err as Error);
              this.inFlightJobIds.delete(job.jobId);
              worker.release(job.jobId);
            }
          })
        );
      }
    } finally {
      this.isDispatching = false;
      if (this.hasPendingDispatch && !this.isStopped) {
        this.hasPendingDispatch = false;
        this.triggerDispatch();
      }
    }
  }

  /**
   * Scans active projects and assigns queued jobs to available workers up to maximum safe capacity.
   */
  private async collectAndAssignEligibleJobs(): Promise<
    Array<{ job: GenerationJobEntity; project: ProjectEntity; worker: ProfileWorker }>
  > {
    const projects = await ProjectRepository.getAll();
    const assignments: Array<{ job: GenerationJobEntity; project: ProjectEntity; worker: ProfileWorker }> = [];

    for (const project of projects) {
      if (project.status !== 'queued' && project.status !== 'running') {
        continue;
      }

      const allJobs = await JobRepository.getJobsByProject(project.projectId);
      const queuedJobs = allJobs.filter(
        (j) => j.status === 'queued' && !this.inFlightJobIds.has(j.jobId)
      );

      if (queuedJobs.length === 0) continue;

      const sortedJobs = this.sortAllJobsByProcessingOrder(queuedJobs, project.settings.processingOrder);

      for (const job of sortedJobs) {
        const slot = project.slots.find((s) => s.slotIndex === job.slotIndex);
        if (!slot || slot.status === 'completed') continue;

        const worker = this.workerPool.getAvailableWorker(project.settings.selectedProfileIds);
        if (!worker) {
          // All eligible workers are at full capacity
          break;
        }

        // Assign immediately in memory and track in-flight to prevent race conditions
        worker.assignJob(job);
        this.inFlightJobIds.add(job.jobId);
        assignments.push({ job, project, worker });
      }
    }

    return assignments;
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
   * Sorts all queued jobs according to the project's processing order.
   */
  private sortAllJobsByProcessingOrder(
    jobs: GenerationJobEntity[],
    order: ProcessingOrder
  ): GenerationJobEntity[] {
    if (jobs.length <= 1) return [...jobs];

    if (order === 'images_first') {
      const images = jobs.filter((j) => j.promptType === 'image').sort((a, b) => a.slotIndex - b.slotIndex);
      const videos = jobs.filter((j) => j.promptType === 'video').sort((a, b) => a.slotIndex - b.slotIndex);
      return [...images, ...videos];
    }

    if (order === 'videos_first') {
      const videos = jobs.filter((j) => j.promptType === 'video').sort((a, b) => a.slotIndex - b.slotIndex);
      const images = jobs.filter((j) => j.promptType === 'image').sort((a, b) => a.slotIndex - b.slotIndex);
      return [...videos, ...images];
    }

    return [...jobs].sort((a, b) => a.slotIndex - b.slotIndex);
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
