import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';
import { ProfileWorker } from '../main/scheduler/ProfileWorker';
import { ProfileSession } from '../main/engine/ProfileSession';
import { PromptParser } from '../shared/PromptParser';
import type { ProfileSessionSnapshot } from '../shared/types';

describe('Final Product-Level Review: End-to-End User Journeys', () => {
  let createdProjectIds: string[] = [];
  let workerPool: WorkerPool;
  let scheduler: GenerationScheduler;

  const mockSession1: ProfileSessionSnapshot = {
    profileId: 'prof_alpha',
    displayName: 'AI Automation',
    email: 'alpha@flow.com',
    status: 'ready',
    mode: 'dedicated_data_dir',
    cdpPort: 9222,
    pid: 1001,
  };

  const mockSession2: ProfileSessionSnapshot = {
    profileId: 'prof_beta',
    displayName: 'Heidi Mason',
    email: 'beta@flow.com',
    status: 'ready',
    mode: 'dedicated_data_dir',
    cdpPort: 9223,
    pid: 1002,
  };

  beforeEach(async () => {
    createdProjectIds = [];
    workerPool = new WorkerPool();
    scheduler = new GenerationScheduler(workerPool, { isDryRun: true });
  });

  afterEach(async () => {
    await scheduler.stop();
    workerPool.clear();

    for (const pid of createdProjectIds) {
      try {
        await ProjectRepository.delete(pid);
      } catch {
        // ignore
      }
    }
  });

  it('Journey 1: Single Image Generation (Nano Banana 2, 16:9, 2K Upscaled, x1)', async () => {
    const prompt = 'A golden retriever resting on a soft rug in front of a fireplace';
    const project = await ProjectRepository.create({
      name: 'Single Image Review',
      generationMode: 'single_image',
      imageRatio: '16:9',
      imageDownloadQuality: '2k',
      selectedProfileIds: ['prof_alpha'],
      prompts: [{ text: prompt, type: 'image' }],
    });
    createdProjectIds.push(project.projectId);

    expect(project.slots.length).toBe(1);
    expect(project.slots[0]!.slotIndex).toBe(0);
    expect(project.slots[0]!.type).toBe('image');
    expect(project.slots[0]!.promptText).toBe(prompt);
    expect(project.settings.generationMode).toBe('single_image');
    expect(project.settings.imageRatio).toBe('16:9');
    expect(project.settings.imageDownloadQuality).toBe('2k');
    expect((project.settings as any).videoDownloadQuality).not.toBe('4k');
    expect((project.settings as any).imageDownloadQuality).not.toBe('4k');

    const reloaded = await ProjectRepository.get(project.projectId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.name).toBe('Single Image Review');
    expect(reloaded!.slots[0]!.promptText).toBe(prompt);
  });

  it('Journey 2: Single Video Generation (Veo 3.1 Quality, Native Duration, 1080p, x1)', async () => {
    const prompt = 'A cinematic drone push-in toward a lighthouse on misty rocky cliffs';
    const project = await ProjectRepository.create({
      name: 'Single Video Veo Quality Review',
      generationMode: 'single_video',
      videoRatio: '16:9',
      videoModel: 'Veo 3.1 - Quality',
      videoResolution: '720p',
      videoDownloadQuality: '1080p',
      selectedProfileIds: ['prof_alpha'],
      prompts: [{ text: prompt, type: 'video' }],
    });
    createdProjectIds.push(project.projectId);

    expect(project.slots.length).toBe(1);
    expect(project.slots[0]!.slotIndex).toBe(0);
    expect(project.slots[0]!.type).toBe('video');
    expect(project.settings.videoModel).toBe('Veo 3.1 - Quality');
    expect(project.settings.videoDownloadQuality).toBe('1080p');
    expect(project.settings.videoDuration).toBeUndefined();
    expect((project.settings as any).videoDownloadQuality).not.toBe('4k');

    const reloaded = await ProjectRepository.get(project.projectId);
    expect(reloaded!.settings.videoModel).toBe('Veo 3.1 - Quality');
  });

  it('Journey 3: Single Video Generation (Omni 1.1 Flash, 6s duration, 720p, 1080p export)', async () => {
    const prompt = 'A neon holographic hummingbird hovering in a futuristic cyberpunk city';
    const project = await ProjectRepository.create({
      name: 'Single Video Omni Review',
      generationMode: 'single_video',
      videoRatio: '16:9',
      videoModel: 'Omni 1.1 Flash',
      videoResolution: '720p',
      videoDuration: '6s',
      videoDownloadQuality: '1080p',
      selectedProfileIds: ['prof_beta'],
      prompts: [{ text: prompt, type: 'video' }],
    });
    createdProjectIds.push(project.projectId);

    expect(project.settings.videoModel).toBe('Omni 1.1 Flash');
    expect(project.settings.videoDuration).toBe('6s');
    expect(project.settings.videoResolution).toBe('720p');
    expect(project.settings.videoDownloadQuality).toBe('1080p');
  });

  it('Journey 4: Bulk Video Generation (Multiline parsing, permanent slots 0..3, multi-account)', async () => {
    const rawBulk = "Slot 0: Futuristic cityscape at dusk with flying vehicles\nSlot 1: Cyberpunk alleyway with neon signs reflecting in puddles\n\nSlot 2: High-speed monorail gliding smoothly\nSlot 3: Rooftop garden overlooking a metropolis";

    const parsed = PromptParser.parseRawText(rawBulk, 'video');
    expect(parsed.length).toBe(4);
    expect(parsed[0]!.text).toContain('Slot 0');
    expect(parsed[1]!.text).toContain('Slot 1');
    expect(parsed[2]!.text).toContain('Slot 2');
    expect(parsed[3]!.text).toContain('Slot 3');

    const project = await ProjectRepository.create({
      name: 'Bulk Video Review',
      generationMode: 'bulk_video',
      videoRatio: '16:9',
      videoModel: 'Veo 3.1 - Fast',
      videoDownloadQuality: 'original',
      selectedProfileIds: ['prof_alpha', 'prof_beta'],
      prompts: parsed.map((p) => ({ text: p.text, type: p.type })),
    });
    createdProjectIds.push(project.projectId);

    expect(project.slots.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(project.slots[i]!.slotIndex).toBe(i);
      expect(project.slots[i]!.type).toBe('video');
    }
    expect(project.settings.selectedProfileIds).toEqual(['prof_alpha', 'prof_beta']);

    const sessionAlpha = new ProfileSession({
      profileId: 'prof_alpha',
      displayName: 'AI Automation',
      userDataDir: 'C:\\fake\\a',
      chromeProfileName: 'Default',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9222,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flowUrlLocale: null,
      detectedEmail: null,
      notes: '',
    });
    const sessionBeta = new ProfileSession({
      profileId: 'prof_beta',
      displayName: 'Heidi Mason',
      userDataDir: 'C:\\fake\\b',
      chromeProfileName: 'Default',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9223,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flowUrlLocale: null,
      detectedEmail: null,
      notes: '',
    });
    const workerAlpha = new ProfileWorker(sessionAlpha);
    const workerBeta = new ProfileWorker(sessionBeta);
    Object.defineProperty(workerAlpha, 'isAvailable', { get: () => true, configurable: true });
    Object.defineProperty(workerBeta, 'isAvailable', { get: () => true, configurable: true });

    workerPool.registerWorker(workerAlpha);
    workerPool.registerWorker(workerBeta);

    const available = workerPool.getAvailableWorker(['prof_beta']);
    expect(available).not.toBeNull();
    expect(available!.profileId).toBe('prof_beta');
  });

  it('Journey 5: Workspace Out-Of-Order Completion & Slot Invariant Preservation', async () => {
    const project = await ProjectRepository.create({
      name: 'Slot Invariant Review',
      generationMode: 'bulk_video',
      prompts: [
        { text: 'Prompt 0', type: 'video' },
        { text: 'Prompt 1', type: 'video' },
        { text: 'Prompt 2', type: 'video' },
        { text: 'Prompt 3', type: 'video' },
      ],
    });
    createdProjectIds.push(project.projectId);

    await ProjectRepository.updateSlot(project.projectId, 2, { status: 'completed' });
    await ProjectRepository.updateSlot(project.projectId, 0, { status: 'completed' });
    await ProjectRepository.updateSlot(project.projectId, 3, { status: 'completed' });
    await ProjectRepository.updateSlot(project.projectId, 1, { status: 'completed' });

    const reloaded = await ProjectRepository.get(project.projectId);
    expect(reloaded).not.toBeNull();

    const indexes = reloaded!.slots.map((s) => s.slotIndex);
    expect(indexes).toEqual([0, 1, 2, 3]);
    expect(reloaded!.slots[0]!.promptText).toBe('Prompt 0');
    expect(reloaded!.slots[1]!.promptText).toBe('Prompt 1');
    expect(reloaded!.slots[2]!.promptText).toBe('Prompt 2');
    expect(reloaded!.slots[3]!.promptText).toBe('Prompt 3');
  });

  it('Journey 6: Surgical Slot Retry Re-Enqueues Only Failed Slot Without Duplicating', async () => {
    const project = await ProjectRepository.create({
      name: 'Retry Test Project',
      generationMode: 'bulk_image',
      prompts: [
        { text: 'Image 0 - Success', type: 'image' },
        { text: 'Image 1 - Failed', type: 'image' },
      ],
    });
    createdProjectIds.push(project.projectId);

    await ProjectRepository.updateSlot(project.projectId, 0, { status: 'completed' });
    await ProjectRepository.updateSlot(project.projectId, 1, {
      status: 'failed',
      error: { code: 'FAIL', message: 'Test error', timestamp: new Date().toISOString(), retryCount: 1 },
    });

    const retriedJob = await scheduler.retrySlot(project.projectId, 1);
    expect(retriedJob).not.toBeNull();
    expect(retriedJob!.slotIndex).toBe(1);
    expect(retriedJob!.status).toBe('queued');

    const updatedProj = await ProjectRepository.get(project.projectId);
    expect(updatedProj!.slots[0]!.status).toBe('completed');
    expect(updatedProj!.slots[1]!.status).toBe('queued');
    expect(updatedProj!.slots.length).toBe(2);
  });
});
