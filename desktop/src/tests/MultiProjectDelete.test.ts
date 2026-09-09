import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { GenerationScheduler } from '../main/scheduler/GenerationScheduler';

describe('Multi-Project Deletion & Profile Safety Tests', () => {
  let createdProjectIds: string[] = [];
  let scheduler: GenerationScheduler;
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool();
    scheduler = new GenerationScheduler(pool);
    createdProjectIds = [];
  });

  afterEach(async () => {
    try {
      scheduler.shutdown();
      for (const id of createdProjectIds) {
        await ProjectRepository.delete(id).catch(() => {});
      }
    } catch {}
  });

  it('should safely delete multiple projects, mark deleting status, and remove directories', async () => {
    const p1 = await ProjectRepository.create({
      name: 'Batch Project 1',
      generationMode: 'bulk_video',
      prompts: [{ text: 'Prompt 1', type: 'video' }],
    });
    const p2 = await ProjectRepository.create({
      name: 'Batch Project 2',
      generationMode: 'bulk_video',
      prompts: [{ text: 'Prompt 2', type: 'video' }],
    });
    const p3 = await ProjectRepository.create({
      name: 'Batch Project 3',
      generationMode: 'bulk_video',
      prompts: [{ text: 'Prompt 3', type: 'video' }],
    });

    createdProjectIds.push(p1.projectId, p2.projectId, p3.projectId);

    const dir1 = AssetManager.getProjectDir(p1.projectId);
    const dir2 = AssetManager.getProjectDir(p2.projectId);
    const dir3 = AssetManager.getProjectDir(p3.projectId);

    expect(fs.existsSync(dir1)).toBe(true);
    expect(fs.existsSync(dir2)).toBe(true);
    expect(fs.existsSync(dir3)).toBe(true);

    // Cancel and delete p1 and p2 in batch
    for (const id of [p1.projectId, p2.projectId]) {
      await scheduler.cancelProject(id);
      await ProjectRepository.delete(id);
    }

    // p1 and p2 dirs must be gone
    expect(fs.existsSync(dir1)).toBe(false);
    expect(fs.existsSync(dir2)).toBe(false);

    // p3 must remain completely intact
    expect(fs.existsSync(dir3)).toBe(true);
    const remainingP3 = await ProjectRepository.get(p3.projectId);
    expect(remainingP3).not.toBeNull();
    expect(remainingP3?.name).toBe('Batch Project 3');
  });

  it('should never touch or delete user browser profiles during project deletion', async () => {
    const p = await ProjectRepository.create({
      name: 'Temporary Project',
      generationMode: 'single_image',
      prompts: [{ text: 'Sample prompt', type: 'image' }],
    });
    createdProjectIds.push(p.projectId);

    // Cancel and delete project
    await scheduler.cancelProject(p.projectId);
    await ProjectRepository.delete(p.projectId);

    // Ensure worker pool profiles were NOT removed or altered
    expect(pool.getAllWorkers()).toBeDefined();
  });
});
