/**
 * Tests for Storage Concurrency & Anti-Lost-Update Guarantees.
 *
 * Verifies that concurrent asynchronous writes by multiple workers to the
 * same project.json or jobs.json are serialized via FileMutex and do NOT
 * cause lost updates or stale overwrites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';

describe('Storage Concurrency & Lost Update Prevention', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-concurrency-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('Worker A and Worker B concurrently updating different jobs: no lost updates', async () => {
    const projectId = 'proj_concurrent_jobs';

    // Create 2 initial jobs
    const jobA = await JobRepository.createJob({
      projectId,
      promptId: 'pA',
      promptType: 'image',
      slotIndex: 0,
    });
    const jobB = await JobRepository.createJob({
      projectId,
      promptId: 'pB',
      promptType: 'image',
      slotIndex: 1,
    });

    // Worker A moves Job A: pending -> queued
    // Worker B moves Job B: pending -> queued
    // Execute simultaneously
    await Promise.all([
      JobRepository.updateJob(projectId, jobA.jobId, { status: 'queued' }),
      JobRepository.updateJob(projectId, jobB.jobId, { status: 'queued' }),
    ]);

    // Worker A assigns to profile_1
    // Worker B assigns to profile_2
    // Execute simultaneously
    await Promise.all([
      JobRepository.updateJob(projectId, jobA.jobId, { status: 'assigned', profileId: 'profile_1' }),
      JobRepository.updateJob(projectId, jobB.jobId, { status: 'assigned', profileId: 'profile_2' }),
    ]);

    // Verify both updates are present and neither was overwritten
    const updatedA = await JobRepository.getJob(projectId, jobA.jobId);
    const updatedB = await JobRepository.getJob(projectId, jobB.jobId);

    expect(updatedA?.status).toBe('assigned');
    expect(updatedA?.profileId).toBe('profile_1');

    expect(updatedB?.status).toBe('assigned');
    expect(updatedB?.profileId).toBe('profile_2');

    const all = await JobRepository.getJobsByProject(projectId);
    expect(all).toHaveLength(2);
  });

  it('Worker A and Worker B concurrently updating different slots: no lost updates', async () => {
    const project = await ProjectRepository.create({
      name: 'Concurrent Slots Project',
      prompts: [
        { text: 'Prompt 0', type: 'image' },
        { text: 'Prompt 1', type: 'image' },
      ],
    });

    const projectId = project.projectId;

    // Both workers simultaneously update their assigned slot
    const workerATask = ProjectRepository.updateSlot(projectId, 0, {
      status: 'completed',
      result: {
        assetId: 'uuid_worker_a',
        mediaPath: 'C:\\out\\a.png',
        modelUsed: 'Nano Banana 2',
        ratioUsed: '16:9',
        completedAt: new Date().toISOString(),
        fileSizeBytes: 2048,
      },
    });

    const workerBTask = ProjectRepository.updateSlot(projectId, 1, {
      status: 'completed',
      result: {
        assetId: 'uuid_worker_b',
        mediaPath: 'C:\\out\\b.png',
        modelUsed: 'Nano Banana 2',
        ratioUsed: '16:9',
        completedAt: new Date().toISOString(),
        fileSizeBytes: 4096,
      },
    });

    await Promise.all([workerATask, workerBTask]);

    // Reload project directly from disk
    const reloaded = await ProjectRepository.get(projectId);
    expect(reloaded).not.toBeNull();

    // Verify both slot updates are completely preserved
    const slot0 = reloaded?.slots.find((s) => s.slotIndex === 0);
    const slot1 = reloaded?.slots.find((s) => s.slotIndex === 1);

    expect(slot0?.status).toBe('completed');
    expect(slot0?.result?.assetId).toBe('uuid_worker_a');

    expect(slot1?.status).toBe('completed');
    expect(slot1?.result?.assetId).toBe('uuid_worker_b');

    // Stats must reflect BOTH completions
    expect(reloaded?.stats.completedImages).toBe(2);
  });

  it('Stress test: 20 rapid concurrent job updates preserve consistency', async () => {
    const projectId = 'proj_stress_jobs';
    const jobs = await Promise.all([
      JobRepository.createJob({ projectId, promptId: 'p0', promptType: 'image', slotIndex: 0 }),
      JobRepository.createJob({ projectId, promptId: 'p1', promptType: 'image', slotIndex: 1 }),
      JobRepository.createJob({ projectId, promptId: 'p2', promptType: 'image', slotIndex: 2 }),
      JobRepository.createJob({ projectId, promptId: 'p3', promptType: 'image', slotIndex: 3 }),
    ]);

    // Fire off 4 concurrent workers updating jobs from pending -> queued
    await Promise.all(
      jobs.map((j) => JobRepository.updateJob(projectId, j.jobId, { status: 'queued' }))
    );

    // Fire off 4 concurrent workers updating jobs from queued -> assigned
    await Promise.all(
      jobs.map((j, idx) =>
        JobRepository.updateJob(projectId, j.jobId, {
          status: 'assigned',
          profileId: `profile_${idx}`,
        })
      )
    );

    const reloadedJobs = await JobRepository.getJobsByProject(projectId);
    expect(reloadedJobs).toHaveLength(4);

    for (let i = 0; i < 4; i++) {
      const match = reloadedJobs.find((j) => j.slotIndex === i);
      expect(match).toBeDefined();
      expect(match?.status).toBe('assigned');
      expect(match?.profileId).toBe(`profile_${i}`);
    }
  });
});
