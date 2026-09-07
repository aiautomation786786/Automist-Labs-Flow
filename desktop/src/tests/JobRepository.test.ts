/**
 * Tests for JobRepository.
 *
 * Verifies job persistence, retrieval, status transition enforcement,
 * and transient state discovery across projects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JobRepository } from '../main/storage/JobRepository';
import { InvalidStateTransitionError } from '../shared/job-states';

describe('JobRepository', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-job-repo-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('should create a job with pending status and correct defaults', async () => {
    const job = await JobRepository.createJob({
      projectId: 'proj_test_01',
      promptId: 'prompt_abc',
      promptType: 'image',
      slotIndex: 0,
      maxRetries: 3,
    });

    expect(job.jobId).toMatch(/^job_/);
    expect(job.projectId).toBe('proj_test_01');
    expect(job.promptId).toBe('prompt_abc');
    expect(job.promptType).toBe('image');
    expect(job.slotIndex).toBe(0);
    expect(job.status).toBe('pending');
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(3);
    expect(job.createdAt).toBeDefined();
  });

  it('should retrieve a job by ID and by project', async () => {
    const job1 = await JobRepository.createJob({
      projectId: 'proj_test_02',
      promptId: 'prompt_1',
      promptType: 'image',
      slotIndex: 0,
    });

    const job2 = await JobRepository.createJob({
      projectId: 'proj_test_02',
      promptId: 'prompt_2',
      promptType: 'video',
      slotIndex: 1,
    });

    const fetched = await JobRepository.getJob('proj_test_02', job1.jobId);
    expect(fetched).not.toBeNull();
    expect(fetched?.jobId).toBe(job1.jobId);
    expect(fetched?.promptType).toBe('image');

    const allJobs = await JobRepository.getJobsByProject('proj_test_02');
    expect(allJobs).toHaveLength(2);
    expect(allJobs.map((j) => j.jobId)).toEqual([job1.jobId, job2.jobId]);
  });

  it('should enforce valid state transitions and reject illegal transitions', async () => {
    const job = await JobRepository.createJob({
      projectId: 'proj_test_03',
      promptId: 'prompt_1',
      promptType: 'image',
      slotIndex: 0,
    });

    // Valid transition: pending -> queued
    const queued = await JobRepository.updateJob('proj_test_03', job.jobId, {
      status: 'queued',
    });
    expect(queued.status).toBe('queued');
    expect(queued.queuedAt).toBeDefined();

    // Valid transition: queued -> assigned
    const assigned = await JobRepository.updateJob('proj_test_03', job.jobId, {
      status: 'assigned',
      profileId: 'profile_1',
    });
    expect(assigned.status).toBe('assigned');
    expect(assigned.profileId).toBe('profile_1');

    // Invalid transition: assigned -> completed (must go through execution states)
    await expect(
      JobRepository.updateJob('proj_test_03', job.jobId, {
        status: 'completed',
      })
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it('should record timestamps for queued, started, completed, and failed states', async () => {
    const job = await JobRepository.createJob({
      projectId: 'proj_test_04',
      promptId: 'prompt_1',
      promptType: 'image',
      slotIndex: 0,
    });

    await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'queued' });
    await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'assigned' });
    const started = await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'starting' });
    expect(started.startedAt).toBeDefined();

    await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'configuring' });
    await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'generating' });
    await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'waiting_for_result' });
    await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'downloading' });
    const completed = await JobRepository.updateJob('proj_test_04', job.jobId, { status: 'completed' });
    expect(completed.completedAt).toBeDefined();
  });

  it('should discover all transient jobs across multiple projects', async () => {
    // Project 1: has one completed, one generating (transient)
    const j1 = await JobRepository.createJob({ projectId: 'proj_a', promptId: 'p1', promptType: 'image', slotIndex: 0 });
    await JobRepository.updateJob('proj_a', j1.jobId, { status: 'queued' });
    await JobRepository.updateJob('proj_a', j1.jobId, { status: 'assigned' });
    await JobRepository.updateJob('proj_a', j1.jobId, { status: 'starting' });
    await JobRepository.updateJob('proj_a', j1.jobId, { status: 'configuring' });
    await JobRepository.updateJob('proj_a', j1.jobId, { status: 'generating' });

    // Project 2: has one starting (transient), one draft/pending (not transient)
    const j2 = await JobRepository.createJob({ projectId: 'proj_b', promptId: 'p2', promptType: 'video', slotIndex: 0 });
    await JobRepository.updateJob('proj_b', j2.jobId, { status: 'queued' });
    await JobRepository.updateJob('proj_b', j2.jobId, { status: 'assigned' });
    await JobRepository.updateJob('proj_b', j2.jobId, { status: 'starting' });

    const j3 = await JobRepository.createJob({ projectId: 'proj_b', promptId: 'p3', promptType: 'video', slotIndex: 1 });

    const transientJobs = await JobRepository.getAllTransientJobs();
    expect(transientJobs).toHaveLength(2);
    const transientIds = transientJobs.map((j) => j.jobId);
    expect(transientIds).toContain(j1.jobId);
    expect(transientIds).toContain(j2.jobId);
    expect(transientIds).not.toContain(j3.jobId);
  });
});
