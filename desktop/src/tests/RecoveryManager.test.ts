/**
 * Tests for RecoveryManager.
 *
 * Verifies crash recovery policies for transient/in-flight jobs:
 *  - Interrupted job with valid output file -> recovered as completed.
 *  - Interrupted job without output file and retries left -> recovered as retry_waiting.
 *  - Interrupted job without output file and retries exhausted -> recovered as manual_action_required.
 *  - Accompanying prompt slot statuses reconciled accordingly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RecoveryManager } from '../main/storage/RecoveryManager';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { JobRepository } from '../main/storage/JobRepository';
import { AssetManager } from '../main/storage/AssetManager';

describe('RecoveryManager Crash Recovery', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-recovery-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('should recover interrupted transient jobs based on output file presence and retries', async () => {
    const project = await ProjectRepository.create({
      name: 'Crash Recovery Test Project',
      maxRetries: 2,
      prompts: [
        { text: 'Prompt 0 (Has Output)', type: 'image' },
        { text: 'Prompt 1 (No Output, Has Retries)', type: 'image' },
        { text: 'Prompt 2 (No Output, Exhausted Retries)', type: 'image' },
      ],
    });

    const projectId = project.projectId;

    // Job 0: left in 'generating' state, but output file exists on disk
    const j0 = await JobRepository.createJob({
      projectId,
      promptId: project.slots[0]!.promptId,
      promptType: 'image',
      slotIndex: 0,
      maxRetries: 2,
    });
    await JobRepository.updateJob(projectId, j0.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, j0.jobId, { status: 'assigned' });
    await JobRepository.updateJob(projectId, j0.jobId, { status: 'starting' });
    await JobRepository.updateJob(projectId, j0.jobId, { status: 'generating' });

    const outputPath0 = AssetManager.getImageDestinationPath(
      projectId,
      0,
      project.slots[0]!.promptId,
      j0.jobId
    );
    fs.mkdirSync(path.dirname(outputPath0), { recursive: true });
    fs.writeFileSync(outputPath0, Buffer.from('VALID_IMAGE_DATA_BEFORE_CRASH'));

    // Job 1: left in 'starting' state, no output, retryCount = 0 (retries available)
    const j1 = await JobRepository.createJob({
      projectId,
      promptId: project.slots[1]!.promptId,
      promptType: 'image',
      slotIndex: 1,
      maxRetries: 2,
    });
    await JobRepository.updateJob(projectId, j1.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, j1.jobId, { status: 'assigned' });
    await JobRepository.updateJob(projectId, j1.jobId, { status: 'starting' });

    // Job 2: left in 'downloading' state, no output, retryCount = 2 (retries exhausted)
    const j2 = await JobRepository.createJob({
      projectId,
      promptId: project.slots[2]!.promptId,
      promptType: 'image',
      slotIndex: 2,
      maxRetries: 2,
    });
    await JobRepository.updateJob(projectId, j2.jobId, { status: 'queued' });
    await JobRepository.updateJob(projectId, j2.jobId, { status: 'assigned' });
    await JobRepository.updateJob(projectId, j2.jobId, { status: 'starting' });
    await JobRepository.updateJob(projectId, j2.jobId, { status: 'generating' });
    await JobRepository.updateJob(projectId, j2.jobId, { status: 'waiting_for_result' });
    await JobRepository.updateJob(projectId, j2.jobId, {
      status: 'downloading',
      retryCount: 2, // exhausted!
    });

    // Execute crash recovery
    const report = await RecoveryManager.recoverAll();

    expect(report.scannedProjects).toBe(1);
    expect(report.transientJobsFound).toBe(3);
    expect(report.recoveredCompleted).toBe(1);
    expect(report.recoveredForRetry).toBe(1);
    expect(report.recoveredManualAction).toBe(1);

    // Verify Job 0 and Slot 0
    const reloadedJ0 = await JobRepository.getJob(projectId, j0.jobId);
    expect(reloadedJ0?.status).toBe('completed');
    expect(reloadedJ0?.outputPath).toBe(outputPath0);

    const reloadedProject = await ProjectRepository.get(projectId);
    expect(reloadedProject?.slots[0]?.status).toBe('completed');
    expect(reloadedProject?.slots[0]?.result?.mediaPath).toBe(outputPath0);

    // Verify Job 1 and Slot 1
    const reloadedJ1 = await JobRepository.getJob(projectId, j1.jobId);
    expect(reloadedJ1?.status).toBe('retry_waiting');
    expect(reloadedProject?.slots[1]?.status).toBe('queued');

    // Verify Job 2 and Slot 2
    const reloadedJ2 = await JobRepository.getJob(projectId, j2.jobId);
    expect(reloadedJ2?.status).toBe('manual_action_required');
    expect(reloadedProject?.slots[2]?.status).toBe('failed');
  });
});
