import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageExecutionService } from '../main/execution/ImageExecutionService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { FlowDriver } from '../main/engine/FlowDriver';
import type { GenerationJobEntity, ProjectEntity } from '../shared/types';
import * as fs from 'fs';

describe('MediaAssociation & Ambiguity Safeguard', () => {
  let testProjectId: string;
  let mockWorker: any;
  let mockJob: GenerationJobEntity;

  beforeEach(async () => {
    vi.spyOn(FlowDriver, 'findFirstVisible').mockResolvedValue({
      fill: vi.fn(),
      click: vi.fn(),
      evaluate: vi.fn(),
    } as any);
    vi.spyOn(FlowDriver, 'safeFill').mockResolvedValue(undefined);

    // Create test project
    const project = await ProjectRepository.create({
      name: 'Association Test Project',
      imageRatio: '16:9',
      processingOrder: 'images_first',
      autoRetry: false,
      maxRetries: 0,
      prompts: [
        { text: 'A test prompt for association', type: 'image' },
      ],
    });
    testProjectId = project.projectId;

    mockJob = await JobRepository.createJob({
      projectId: testProjectId,
      promptId: 'slot_0',
      promptType: 'image',
      slotIndex: 0,
    });

    await JobRepository.updateJob(testProjectId, mockJob.jobId, { status: 'queued' });
    mockJob = await JobRepository.updateJob(testProjectId, mockJob.jobId, {
      status: 'assigned',
      profileId: 'prof_test_assoc',
    });

    mockWorker = {
      profileId: 'prof_test_assoc',
      release: vi.fn(),
      automation: {
        checkAuthentication: vi.fn().mockResolvedValue({ state: 'authenticated', url: 'https://labs.google/fx/en/tools/flow' }),
        ensureProject: vi.fn().mockResolvedValue({ projectId: testProjectId }),
        selectNanoBanana2: vi.fn().mockResolvedValue({ verified: true, modelDetectedAfter: 'Nano Banana 2' }),
        selectRatio: vi.fn().mockResolvedValue({ verified: true, detectedAfter: '16:9' }),
        detectGeneratedMedia: vi.fn().mockResolvedValue({ imageUuids: [], mediaUrls: [], hasVideo: false, videoSources: [] }),
        getPage: vi.fn().mockReturnValue({
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          locator: vi.fn(),
          url: vi.fn().mockReturnValue('https://labs.google/fx/en/tools/flow/project/123'),
          evaluate: vi.fn(),
        }),
        downloadMedia: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  it('unambiguously associates single new generated media UUID with target prompt slot', async () => {
    const singleUuid = 'uuid_unique_success_001';

    await ImageExecutionService.execute(mockWorker, mockJob, {
      triggerGenerationClick: false,
      pollTimeoutMs: 1000,
      mockDeltaUuids: [singleUuid],
    });

    const updatedJob = await JobRepository.getJob(testProjectId, mockJob.jobId);
    expect(updatedJob?.status).toBe('completed');

    const updatedProject = await ProjectRepository.get(testProjectId);
    const slot0 = updatedProject?.slots[0];
    expect(slot0?.status).toBe('completed');
    expect(slot0?.result?.assetId).toBe(singleUuid);
    expect(mockWorker.release).toHaveBeenCalled();
  });

  it('safely transitions to manual_action_required when multiple new UUIDs appear simultaneously (ambiguity protection)', async () => {
    const ambiguousUuids = ['uuid_ambig_1', 'uuid_ambig_2'];

    await expect(
      ImageExecutionService.execute(mockWorker, mockJob, {
        triggerGenerationClick: false,
        pollTimeoutMs: 1000,
        mockDeltaUuids: ambiguousUuids,
      })
    ).rejects.toThrow(/Ambiguous media result/i);

    const updatedJob = await JobRepository.getJob(testProjectId, mockJob.jobId);
    expect(updatedJob?.status).toBe('manual_action_required');

    const updatedProject = await ProjectRepository.get(testProjectId);
    const slot0 = updatedProject?.slots[0];
    expect(slot0?.status).toBe('failed');
    expect(slot0?.error?.code).toBe('AMBIGUOUS_MEDIA_RESULT');
    expect(mockWorker.release).toHaveBeenCalled();
  });
});
