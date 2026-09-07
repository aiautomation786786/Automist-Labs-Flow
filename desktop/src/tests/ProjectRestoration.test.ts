import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { AssetManager } from '../main/storage/AssetManager';
import * as fs from 'fs';
import * as path from 'path';

describe('Project Restoration & Cold-Start Persistence', () => {
  let projectId: string;

  beforeEach(async () => {
    // 1. Create a project with multiple slots
    const project = await ProjectRepository.create({
      name: 'Cold Start Restoration Campaign',
      campaignTag: 'SciFi_2026',
      imageRatio: '9:16',
      videoRatio: '16:9',
      processingOrder: 'images_first',
      autoRetry: true,
      maxRetries: 3,
      prompts: [
        { text: 'A futuristic floating city at sunset', type: 'image' },
        { text: 'Cyberpunk street vendor cooking noodles in rain', type: 'image' },
        { text: 'Drone tracking shot through neon alleyway', type: 'video' },
      ],
    });
    projectId = project.projectId;

    // 2. Simulate slot 0 completion with real file on disk
    const destPath = AssetManager.getImageDestinationPath(projectId, 0, project.slots[0]!.promptId, 'job_res_001');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from('FAKE_GENERATED_IMAGE_DATA'));

    const job = await JobRepository.createJob({
      projectId,
      promptId: project.slots[0]!.promptId,
      promptType: 'image',
      slotIndex: 0,
    });
    await JobRepository.updateJob(projectId, job.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, job.jobId, { status: 'assigned', profileId: 'prof_worker_alpha' });
    await JobRepository.updateJob(projectId, job.jobId, { status: 'starting' });
    await JobRepository.updateJob(projectId, job.jobId, { status: 'generating' });
    await JobRepository.updateJob(projectId, job.jobId, { status: 'downloading' });
    await JobRepository.updateJob(projectId, job.jobId, {
      status: 'completed',
      outputPath: destPath,
    });

    await ProjectRepository.updateSlot(projectId, 0, {
      status: 'completed',
      assignedProfileId: 'prof_worker_alpha',
      result: {
        assetId: 'uuid_restored_asset_99',
        mediaPath: destPath,
        modelUsed: 'Nano Banana 2',
        ratioUsed: '9:16',
        completedAt: new Date().toISOString(),
        fileSizeBytes: 24,
      },
    });

    // Simulate slot 1 running
    await ProjectRepository.updateSlot(projectId, 1, {
      status: 'running',
      assignedProfileId: 'prof_worker_beta',
    });
  });

  it('restores exact project structure, slot order, and media paths after reload', async () => {
    // Simulate complete application restart by reading directly from persistent storage
    const reloadedProject = await ProjectRepository.get(projectId);

    expect(reloadedProject).toBeDefined();
    expect(reloadedProject?.name).toBe('Cold Start Restoration Campaign');
    expect(reloadedProject?.campaignTag).toBe('SciFi_2026');
    expect(reloadedProject?.settings.imageRatio).toBe('9:16');
    expect(reloadedProject?.settings.processingOrder).toBe('images_first');
    expect(reloadedProject?.settings.maxRetries).toBe(3);

    // Verify slots are ordered strictly by slotIndex [0, 1, 2]
    expect(reloadedProject?.slots.length).toBe(3);
    expect(reloadedProject?.slots[0]?.slotIndex).toBe(0);
    expect(reloadedProject?.slots[1]?.slotIndex).toBe(1);
    expect(reloadedProject?.slots[2]?.slotIndex).toBe(2);

    // Verify slot 0 completed result remains intact
    const slot0 = reloadedProject?.slots[0];
    expect(slot0?.status).toBe('completed');
    expect(slot0?.assignedProfileId).toBe('prof_worker_alpha');
    expect(slot0?.result?.assetId).toBe('uuid_restored_asset_99');
    expect(slot0?.result?.modelUsed).toBe('Nano Banana 2');
    expect(slot0?.result?.ratioUsed).toBe('9:16');
    expect(slot0?.result?.mediaPath).toBeDefined();
    expect(fs.existsSync(slot0!.result!.mediaPath!)).toBe(true);

    // Verify slot 1 remains untouched in position #02
    const slot1 = reloadedProject?.slots[1];
    expect(slot1?.promptText).toBe('Cyberpunk street vendor cooking noodles in rain');
    expect(slot1?.status).toBe('running');
    expect(slot1?.assignedProfileId).toBe('prof_worker_beta');

    // Verify slot 2 remains in position #03
    const slot2 = reloadedProject?.slots[2];
    expect(slot2?.promptText).toBe('Drone tracking shot through neon alleyway');
    expect(slot2?.type).toBe('video');
    expect(slot2?.status).toBe('draft');
  });
});
