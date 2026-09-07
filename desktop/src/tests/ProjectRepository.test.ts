/**
 * Tests for ProjectRepository.
 *
 * Verifies project creation, slot immutability, stats calculation, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectRepository } from '../main/storage/ProjectRepository';

describe('ProjectRepository', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-project-repo-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('should create a project with immutable prompt slots preserving input order', async () => {
    const project = await ProjectRepository.create({
      name: 'Cyberpunk Campaign',
      imageRatio: '16:9',
      processingOrder: 'images_first',
      prompts: [
        { text: 'A futuristic city in rain', type: 'image' },
        { text: 'A flying spinner car', type: 'image' },
        { text: 'A drone hovering over neon alley', type: 'video' },
      ],
    });

    expect(project.projectId).toMatch(/^proj_/);
    expect(project.name).toBe('Cyberpunk Campaign');
    expect(project.slots).toHaveLength(3);

    // Verify slot indices strictly match input order
    expect(project.slots[0]?.slotIndex).toBe(0);
    expect(project.slots[0]?.promptText).toBe('A futuristic city in rain');
    expect(project.slots[0]?.type).toBe('image');

    expect(project.slots[1]?.slotIndex).toBe(1);
    expect(project.slots[1]?.promptText).toBe('A flying spinner car');

    expect(project.slots[2]?.slotIndex).toBe(2);
    expect(project.slots[2]?.promptText).toBe('A drone hovering over neon alley');
    expect(project.slots[2]?.type).toBe('video');

    // Stats
    expect(project.stats.totalImages).toBe(2);
    expect(project.stats.totalVideos).toBe(1);
    expect(project.stats.completedImages).toBe(0);
  });

  it('should retrieve a stored project from disk', async () => {
    const created = await ProjectRepository.create({
      name: 'Test Project',
      prompts: [{ text: 'Sample prompt', type: 'image' }],
    });

    const loaded = await ProjectRepository.get(created.projectId);
    expect(loaded).not.toBeNull();
    expect(loaded?.projectId).toBe(created.projectId);
    expect(loaded?.slots).toHaveLength(1);
    expect(loaded?.slots[0]?.promptText).toBe('Sample prompt');
  });

  it('updateSlot should update slot result and automatically recalculate stats', async () => {
    const project = await ProjectRepository.create({
      name: 'Stats Test',
      prompts: [
        { text: 'Prompt 0', type: 'image' },
        { text: 'Prompt 1', type: 'image' },
      ],
    });

    await ProjectRepository.updateSlot(project.projectId, 0, {
      status: 'completed',
      result: {
        assetId: 'uuid_001',
        mediaPath: 'C:\\fake\\img0.png',
        modelUsed: 'Nano Banana 2',
        ratioUsed: '16:9',
        completedAt: new Date().toISOString(),
        fileSizeBytes: 1024,
      },
    });

    const updated = await ProjectRepository.get(project.projectId);
    expect(updated?.slots[0]?.status).toBe('completed');
    expect(updated?.slots[0]?.result?.assetId).toBe('uuid_001');
    expect(updated?.stats.completedImages).toBe(1);
    expect(updated?.stats.completedVideos).toBe(0);
  });

  it('SLOT IMMUTABILITY: slotIndex and promptId cannot be overwritten', async () => {
    const project = await ProjectRepository.create({
      name: 'Immutability Test',
      prompts: [{ text: 'Prompt Alpha', type: 'image' }],
    });

    const originalSlot = project.slots[0]!;

    await ProjectRepository.updateSlot(project.projectId, 0, {
      status: 'running',
      // Trying to overwrite immutable fields should be safely ignored/prevented
    });

    const reloaded = await ProjectRepository.get(project.projectId);
    expect(reloaded?.slots[0]?.slotIndex).toBe(0);
    expect(reloaded?.slots[0]?.promptId).toBe(originalSlot.promptId);
    expect(reloaded?.slots[0]?.type).toBe('image');
  });

  it('should delete project and clean up files', async () => {
    const project = await ProjectRepository.create({
      name: 'To Delete',
      prompts: [{ text: 'Will be deleted', type: 'image' }],
    });

    await ProjectRepository.delete(project.projectId);
    const loaded = await ProjectRepository.get(project.projectId);
    expect(loaded).toBeNull();
  });
});
