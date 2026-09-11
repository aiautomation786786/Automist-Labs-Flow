/**
 * VideoFactoryPipelineManager – Central registry and lifecycle manager for VideoFactoryPipeline runs.
 *
 * GUARANTEES:
 *  1. Idempotency: Project-level run lock strictly prevents parallel duplicate pipeline runs.
 *  2. Concurrency Safety: Serialized via FileMutex and Map-based execution tracking.
 *  3. Resource Governance: Passes GenerationScheduler reference down to pipelines without bypassing WorkerPool.
 */

import type {
  VideoFactoryStage,
  VideoFactoryPipelineState,
  VideoFactoryMode,
} from '../../shared/types';
import { VideoFactoryPipeline } from './VideoFactoryPipeline';
import { StoryRepository } from '../storage/StoryRepository';
import type { GenerationScheduler } from '../scheduler/GenerationScheduler';
import { RetryCoordinator } from '../retry/RetryCoordinator';
import { fileMutex } from '../storage/FileMutex';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class VideoFactoryPipelineManager {
  private static activePipelines = new Map<string, VideoFactoryPipeline>();
  private static activeRunPromises = new Map<string, Promise<VideoFactoryPipelineState>>();
  private static scheduler?: GenerationScheduler;

  static setScheduler(s: GenerationScheduler): void {
    this.scheduler = s;
  }

  static getScheduler(): GenerationScheduler | undefined {
    return this.scheduler;
  }

  /**
   * Starts or resumes a pipeline run for a project.
   * Enforces idempotency: multiple simultaneous start calls return the same in-flight promise.
   */
  static async startPipeline(
    projectId: string,
    mode: VideoFactoryMode = 'full_video'
  ): Promise<VideoFactoryPipelineState> {
    return await fileMutex.runExclusive(`pipeline_lock:${projectId}`, async () => {
      const existingPromise = this.activeRunPromises.get(projectId);
      if (existingPromise) {
        logger.warn('pipeline_mgr', `Pipeline already running for project ${projectId}. Returning existing run promise.`);
        return existingPromise;
      }

      // Check if project has persisted state with mode
      const persisted = await StoryRepository.getPipelineState(projectId);
      const effectiveMode = persisted?.mode || mode;

      const pipeline = new VideoFactoryPipeline(projectId, effectiveMode, this.scheduler);
      this.activePipelines.set(projectId, pipeline);

      const runPromise = pipeline.run().finally(() => {
        this.activeRunPromises.delete(projectId);
        this.activePipelines.delete(projectId);
      });

      this.activeRunPromises.set(projectId, runPromise);
      return runPromise;
    });
  }

  /**
   * Pauses an active pipeline gracefully at the next safe checkpoint.
   */
  static async pausePipeline(projectId: string): Promise<VideoFactoryPipelineState> {
    RetryCoordinator.getInstance().pauseRetries(projectId);
    const pipeline = this.activePipelines.get(projectId);
    if (pipeline) {
      pipeline.requestPause();
    } else {
      // If not in active memory, update persisted state to paused
      const state = await StoryRepository.getPipelineState(projectId);
      if (state && state.status === 'running') {
        state.status = 'paused';
        await StoryRepository.savePipelineState(projectId, state);
      }
    }

    const state = await StoryRepository.getPipelineState(projectId);
    if (!state) {
      throw new Error(`Pipeline state not found for project ${projectId}`);
    }
    return state;
  }

  /**
   * Resumes a paused or failed pipeline run.
   */
  static async resumePipeline(projectId: string): Promise<VideoFactoryPipelineState> {
    RetryCoordinator.getInstance().resumeRetries(projectId);
    const state = await StoryRepository.getPipelineState(projectId);
    if (!state) {
      throw new Error(`Pipeline state not found for project ${projectId}`);
    }

    if (state.status === 'running' && this.activeRunPromises.has(projectId)) {
      return this.activeRunPromises.get(projectId)!;
    }

    state.status = 'resuming';
    await StoryRepository.savePipelineState(projectId, state);

    return await this.startPipeline(projectId, state.mode);
  }

  /**
   * Cancels an active pipeline run.
   */
  static async cancelPipeline(projectId: string): Promise<VideoFactoryPipelineState> {
    RetryCoordinator.getInstance().cancelRetries(projectId);
    const pipeline = this.activePipelines.get(projectId);
    if (pipeline) {
      pipeline.cancel();
    } else {
      const state = await StoryRepository.getPipelineState(projectId);
      if (state) {
        state.status = 'cancelled';
        await StoryRepository.savePipelineState(projectId, state);
      }
    }

    const state = await StoryRepository.getPipelineState(projectId);
    if (!state) {
      throw new Error(`Pipeline state not found for project ${projectId}`);
    }
    return state;
  }

  /**
   * Retries a specific failed stage, invalidating only downstream stages.
   */
  static async retryStage(
    projectId: string,
    stage: VideoFactoryStage
  ): Promise<VideoFactoryPipelineState> {
    return await fileMutex.runExclusive(`pipeline_lock:${projectId}`, async () => {
      const activePipeline = this.activePipelines.get(projectId);
      if (activePipeline) {
        return await activePipeline.retryStage(stage);
      }

      const persisted = await StoryRepository.getPipelineState(projectId);
      if (!persisted) {
        throw new Error(`Pipeline state not found for project ${projectId}`);
      }

      const pipeline = new VideoFactoryPipeline(projectId, persisted.mode, this.scheduler);
      this.activePipelines.set(projectId, pipeline);

      const runPromise = pipeline.retryStage(stage).finally(() => {
        this.activeRunPromises.delete(projectId);
        this.activePipelines.delete(projectId);
      });

      this.activeRunPromises.set(projectId, runPromise);
      return runPromise;
    });
  }

  /**
   * Retrieves current pipeline state from disk.
   */
  static async getPipelineState(projectId: string): Promise<VideoFactoryPipelineState | null> {
    const active = this.activePipelines.get(projectId);
    if (active) {
      return active.getState();
    }
    return await StoryRepository.getPipelineState(projectId);
  }

  /**
   * Checks if a pipeline is currently executing.
   */
  static isRunning(projectId: string): boolean {
    return this.activeRunPromises.has(projectId);
  }

  /**
   * Clears active in-memory pipelines (for testing).
   */
  static clearMemory(): void {
    this.activePipelines.clear();
    this.activeRunPromises.clear();
    RetryCoordinator.clearMemory();
  }
}
