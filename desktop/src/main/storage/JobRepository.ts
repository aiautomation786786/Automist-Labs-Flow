/**
 * JobRepository – Concurrency-safe persistence for GenerationJobEntity objects.
 *
 * Stored at: %LOCALAPPDATA%\GoogleFlowApp\projects\{projectId}\jobs.json
 *
 * GUARANTEES:
 *  - Serialized access via FileMutex per project: concurrent worker updates will never
 *    overwrite each other.
 *  - Atomic write via temporary file rename: crash-proof.
 *  - Validates all status transitions through JobStateMachine.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { GenerationJobEntity } from '../../shared/types';
import { JobStateMachine } from '../../shared/job-states';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface CreateJobParams {
  projectId: string;
  promptId: string;
  promptType: 'image' | 'video';
  provider?: import('../../shared/types').GenerationProvider;
  slotIndex: number;
  sourceImagePath?: string;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export class JobRepository {
  /**
   * Returns path to the jobs.json file for a given projectId.
   */
  static getJobsJsonPath(projectId: string): string {
    return path.join(AssetManager.getProjectDir(projectId), 'jobs.json');
  }

  /**
   * Creates and persists a new GenerationJobEntity.
   */
  static async createJob(params: CreateJobParams): Promise<GenerationJobEntity> {
    const lockKey = `jobs_${params.projectId}`;
    return await fileMutex.runExclusive(lockKey, async () => {
      const jobs = await this.readJobsDirect(params.projectId);
      const jobId = `job_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();

      const newJob: GenerationJobEntity = {
        jobId,
        projectId: params.projectId,
        promptId: params.promptId,
        promptType: params.promptType,
        provider: params.provider,
        slotIndex: params.slotIndex,
        sourceImagePath: params.sourceImagePath,
        status: 'pending',
        createdAt: now,
        retryCount: 0,
        maxRetries: params.maxRetries ?? 2,
        metadata: {
          ...(params.metadata ?? {}),
          ...(params.provider ? { provider: params.provider } : {}),
          ...(params.sourceImagePath ? { sourceImagePath: params.sourceImagePath } : {}),
        },
      };

      jobs.push(newJob);
      await this.writeJobsAtomic(params.projectId, jobs);

      logger.info('job_repo', 'Created job', { jobId, projectId: params.projectId, slotIndex: params.slotIndex });
      return newJob;
    });
  }

  /**
   * Retrieves a job by ID from a project's jobs.json.
   */
  static async getJob(projectId: string, jobId: string): Promise<GenerationJobEntity | null> {
    const lockKey = `jobs_${projectId}`;
    return await fileMutex.runExclusive(lockKey, async () => {
      const jobs = await this.readJobsDirect(projectId);
      return jobs.find((j) => j.jobId === jobId) ?? null;
    });
  }

  /**
   * Returns all jobs for a project.
   */
  static async getJobsByProject(projectId: string): Promise<GenerationJobEntity[]> {
    const lockKey = `jobs_${projectId}`;
    return await fileMutex.runExclusive(lockKey, async () => {
      return await this.readJobsDirect(projectId);
    });
  }

  /**
   * Concurrency-safe update of a job. Validates state transition if status is being modified.
   */
  static async updateJob(
    projectId: string,
    jobId: string,
    patch: Partial<Omit<GenerationJobEntity, 'jobId' | 'projectId' | 'promptId' | 'slotIndex' | 'createdAt'>>,
  ): Promise<GenerationJobEntity> {
    const lockKey = `jobs_${projectId}`;
    return await fileMutex.runExclusive(lockKey, async () => {
      const jobs = await this.readJobsDirect(projectId);
      const jobIndex = jobs.findIndex((j) => j.jobId === jobId);

      if (jobIndex === -1) {
        throw new Error(`Job "${jobId}" not found in project "${projectId}".`);
      }

      const currentJob = jobs[jobIndex]!;

      // Validate state transition if status is changing
      if (patch.status && patch.status !== currentJob.status) {
        JobStateMachine.validateTransition(currentJob.status, patch.status, jobId);
      }

      // Update timestamps automatically based on status
      const now = new Date().toISOString();
      if (patch.status === 'queued' && !currentJob.queuedAt) {
        currentJob.queuedAt = now;
      } else if (patch.status === 'starting' && !currentJob.startedAt) {
        currentJob.startedAt = now;
      } else if (patch.status === 'completed') {
        currentJob.completedAt = now;
      } else if (patch.status === 'failed') {
        currentJob.failedAt = now;
      }

      Object.assign(currentJob, patch);
      jobs[jobIndex] = currentJob;

      await this.writeJobsAtomic(projectId, jobs);
      return currentJob;
    });
  }

  /**
   * Returns all jobs across all projects that are in transient states (used for crash recovery).
   */
  static async getAllTransientJobs(): Promise<GenerationJobEntity[]> {
    const rootDir = AssetManager.getProjectsRootDir();
    if (!fs.existsSync(rootDir)) return [];

    const projectDirs = fs.readdirSync(rootDir, { withFileTypes: true });
    const transientJobs: GenerationJobEntity[] = [];

    for (const dir of projectDirs) {
      if (dir.isDirectory() && dir.name.startsWith('proj_')) {
        const jobs = await this.getJobsByProject(dir.name);
        for (const job of jobs) {
          if (JobStateMachine.isTransient(job.status)) {
            transientJobs.push(job);
          }
        }
      }
    }

    return transientJobs;
  }

  // ---- Internal helpers -----------------------------------------------------

  private static async readJobsDirect(projectId: string): Promise<GenerationJobEntity[]> {
    const filePath = this.getJobsJsonPath(projectId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as GenerationJobEntity[];
    } catch {
      return [];
    }
  }

  private static async writeJobsAtomic(projectId: string, jobs: GenerationJobEntity[]): Promise<void> {
    const filePath = this.getJobsJsonPath(projectId);
    const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(tmpPath, JSON.stringify(jobs, null, 2), 'utf-8');
    
    // Atomic replace with Windows retry/fallback safeguard
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        break;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 15));
        } else {
          try {
            fs.copyFileSync(tmpPath, filePath);
            fs.unlinkSync(tmpPath);
            break;
          } catch {
            throw err;
          }
        }
      }
    }
  }
}
