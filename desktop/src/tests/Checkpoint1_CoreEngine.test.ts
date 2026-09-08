import { describe, it, expect } from 'vitest';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { VideoExecutionService } from '../main/execution/VideoExecutionService';
import { ProfileSession } from '../main/engine/ProfileSession';
import type { ProfileConfig } from '../shared/types';

function createMockProfileConfig(id: string): ProfileConfig {
  return {
    profileId: id,
    displayName: `Worker Profile ${id}`,
    userDataDir: `C:\\fake\\user_data\\${id}`,
    chromeProfileName: 'Default',
    chromePath: 'C:\\fake\\chrome.exe',
    cdpPort: 9222,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flowUrlLocale: null,
    detectedEmail: null,
    notes: '',
  };
}

function createMockWorker(profileId: string, isAvailable = true): ProfileWorker {
  const session = new ProfileSession(createMockProfileConfig(profileId));
  const worker = new ProfileWorker(session);
  Object.defineProperty(worker, 'isAvailable', {
    get: () => isAvailable,
    configurable: true,
  });
  return worker;
}

describe('Checkpoint 1: Core Engine Integration & Multi-Account Scheduler', () => {
  describe('WorkerPool allowedProfileIds filtering', () => {
    it('returns any available worker when no allowedProfileIds is provided', () => {
      const pool = new WorkerPool();
      const workerA = createMockWorker('profile_A', true);
      const workerB = createMockWorker('profile_B', true);
      pool.registerWorker(workerA);
      pool.registerWorker(workerB);

      const picked = pool.getAvailableWorker();
      expect(picked).not.toBeNull();
      expect(['profile_A', 'profile_B']).toContain(picked!.profileId);
    });

    it('strictly filters available worker by allowedProfileIds', () => {
      const pool = new WorkerPool();
      const workerA = createMockWorker('profile_A', true);
      const workerB = createMockWorker('profile_B', true);
      pool.registerWorker(workerA);
      pool.registerWorker(workerB);

      // Only allow profile_B
      const pickedB = pool.getAvailableWorker(['profile_B']);
      expect(pickedB).not.toBeNull();
      expect(pickedB!.profileId).toBe('profile_B');

      // Only allow profile_A
      const pickedA = pool.getAvailableWorker(['profile_A']);
      expect(pickedA).not.toBeNull();
      expect(pickedA!.profileId).toBe('profile_A');

      // Allow non-existent profile
      const pickedNone = pool.getAvailableWorker(['profile_nonexistent']);
      expect(pickedNone).toBeNull();
    });

    it('returns null if allowed worker is busy', () => {
      const pool = new WorkerPool();
      const workerA = createMockWorker('profile_A', false); // busy
      const workerB = createMockWorker('profile_B', true);  // available
      pool.registerWorker(workerA);
      pool.registerWorker(workerB);

      // Only profile_A is allowed, but it is busy
      const picked = pool.getAvailableWorker(['profile_A']);
      expect(picked).toBeNull();
    });
  });

  describe('ProjectRepository generationMode and videoModel persistence without 4K', () => {
    it('persists generationMode, videoModel, and selectedProfileIds cleanly without 4K', async () => {
      const project = await ProjectRepository.create({
        name: 'Checkpoint 1 Test Project',
        generationMode: 'single_video',
        videoModel: 'Veo 3.1 - Quality',
        videoResolution: '720p',
        videoDownloadQuality: '1080p',
        selectedProfileIds: ['profile_71b66ea2'],
        prompts: [{ text: 'A small red apple on table', type: 'video' }],
      });

      expect(project.settings.generationMode).toBe('single_video');
      expect(project.settings.videoModel).toBe('Veo 3.1 - Quality');
      expect(project.settings.videoResolution).toBe('720p');
      expect(project.settings.videoDownloadQuality).toBe('1080p');
      expect(project.settings.selectedProfileIds).toEqual(['profile_71b66ea2']);
      expect((project.settings as any).videoDownloadQuality).not.toBe('4k');

      // Verify persistent on-disk read
      const reloaded = await ProjectRepository.get(project.projectId);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.settings.generationMode).toBe('single_video');
      expect(reloaded!.settings.videoModel).toBe('Veo 3.1 - Quality');
      expect(reloaded!.settings.selectedProfileIds).toEqual(['profile_71b66ea2']);
    });
  });

  describe('GenerationScheduler retrySlot safety', () => {
    it('safely re-queues a failed slot and creates a new queued job without touching completed slots', async () => {
      const pool = new WorkerPool();
      const scheduler = new GenerationScheduler(pool, { mockMode: true });

      const project = await ProjectRepository.create({
        name: 'Retry Test Project',
        prompts: [
          { text: 'Prompt 1', type: 'image' },
          { text: 'Prompt 2', type: 'image' },
        ],
      });

      // Mark slot 0 completed, slot 1 failed
      await ProjectRepository.updateSlot(project.projectId, 0, {
        status: 'completed',
        result: {
          assetId: 'asset_0',
          mediaPath: 'path/to/media.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 1024,
        },
      });

      await ProjectRepository.updateSlot(project.projectId, 1, {
        status: 'failed',
        error: { code: 'NETWORK_TIMEOUT', message: 'Download timed out', timestamp: new Date().toISOString(), retryCount: 1 },
      });

      // Attempting to retry completed slot 0 should throw
      await expect(scheduler.retrySlot(project.projectId, 0)).rejects.toThrow('Cannot retry already completed slot 0');

      // Retrying failed slot 1 succeeds
      const newJob = await scheduler.retrySlot(project.projectId, 1);
      expect(newJob.status).toBe('queued');
      expect(newJob.slotIndex).toBe(1);

      // Verify slot 1 is now queued and error cleared
      const updatedProj = await ProjectRepository.get(project.projectId);
      const slot1 = updatedProj!.slots.find((s) => s.slotIndex === 1);
      expect(slot1!.status).toBe('queued');
      expect(slot1!.error).toBeUndefined();

      // Slot 0 remains untouched and completed
      const slot0 = updatedProj!.slots.find((s) => s.slotIndex === 0);
      expect(slot0!.status).toBe('completed');

      scheduler.stop();
    });
  });

  describe('VideoExecutionService dynamic model handling in mock execution', () => {
    it('completes slot with requested dynamic video model (Veo 3.1 - Quality)', async () => {
      const project = await ProjectRepository.create({
        name: 'Veo Quality Video Project',
        videoModel: 'Veo 3.1 - Quality',
        videoResolution: '720p',
        videoDownloadQuality: '1080p',
        prompts: [{ text: 'Studio cinematic shot', type: 'video' }],
      });

      const worker = createMockWorker('profile_test');
      const job = await JobRepository.createJob({
        projectId: project.projectId,
        promptId: project.slots[0]!.promptId,
        promptType: 'video',
        slotIndex: 0,
        maxRetries: 2,
      });

      await JobRepository.updateJob(project.projectId, job.jobId, { status: 'queued' });
      const assignedJob = await JobRepository.updateJob(project.projectId, job.jobId, {
        status: 'assigned',
        profileId: worker.profileId,
      });

      await VideoExecutionService.execute(worker, assignedJob, { mockMode: true });

      const reloadedProj = await ProjectRepository.get(project.projectId);
      const slot = reloadedProj!.slots[0]!;
      expect(slot.status).toBe('completed');
      expect(slot.result?.modelUsed).toBe('Veo 3.1 - Quality');
      expect(slot.result?.downloadResolution).toBe('1080p');
      expect(slot.result?.resolution).toBe('720p');
    });
  });
});
