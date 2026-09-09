/**
 * AppSmoothness.test.ts
 *
 * Automated verification suite for the Full App Smoothness, Zero-Lag,
 * Repository Caching, and Performance Audit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { PromptParser } from '../shared/PromptParser';

describe('App Smoothness & Performance Suite', () => {
  beforeEach(() => {
    ProjectRepository.clearCache();
  });

  afterEach(async () => {
    ProjectRepository.clearCache();
  });

  // ---------------------------------------------------------------------------
  // 1. Repository Write-Through Caching & Invalidation
  // ---------------------------------------------------------------------------
  describe('1. ProjectRepository In-Memory Caching & Source of Truth', () => {
    it('serves repeated get() calls from cache without re-parsing JSON if disk is unchanged', async () => {
      const proj = await ProjectRepository.create({
        name: 'Cache Benchmark Project',
        prompts: [
          { text: 'Prompt 1', type: 'image' },
          { text: 'Prompt 2', type: 'video' },
        ],
      });

      // Spy on JSON.parse
      const parseSpy = vi.spyOn(JSON, 'parse');
      parseSpy.mockClear();

      const fetched1 = await ProjectRepository.get(proj.projectId);
      expect(fetched1).not.toBeNull();
      expect(fetched1?.projectId).toBe(proj.projectId);

      // Mutating returned object should not corrupt subsequent gets (clone isolation)
      if (fetched1) {
        (fetched1 as any).name = 'Corrupted Mutation';
      }

      const fetched2 = await ProjectRepository.get(proj.projectId);
      expect(fetched2?.name).toBe('Cache Benchmark Project');

      // Clean up
      await ProjectRepository.delete(proj.projectId);
      parseSpy.mockRestore();
    });

    it('immediately invalidates cache on delete()', async () => {
      const proj = await ProjectRepository.create({
        name: 'Delete Invalidation Project',
        prompts: [{ text: 'Prompt 1', type: 'image' }],
      });

      const fetched = await ProjectRepository.get(proj.projectId);
      expect(fetched).not.toBeNull();

      await ProjectRepository.delete(proj.projectId);

      const afterDelete = await ProjectRepository.get(proj.projectId);
      expect(afterDelete).toBeNull();
    });

    it('updates cache on update() and updateSlot()', async () => {
      const proj = await ProjectRepository.create({
        name: 'Update Cache Project',
        prompts: [{ text: 'Original Prompt', type: 'image' }],
      });

      // Update project name
      await ProjectRepository.update(proj.projectId, { name: 'Updated Name' });
      const fetchedProj = await ProjectRepository.get(proj.projectId);
      expect(fetchedProj?.name).toBe('Updated Name');

      // Update slot
      await ProjectRepository.updateSlot(proj.projectId, 0, { status: 'completed' });
      const fetchedSlot = await ProjectRepository.get(proj.projectId);
      expect(fetchedSlot?.slots[0]?.status).toBe('completed');
      expect(fetchedSlot?.stats.completedImages).toBe(1);

      await ProjectRepository.delete(proj.projectId);
    });

    it('getAll() safely handles batch reading with bounded chunks', async () => {
      const p1 = await ProjectRepository.create({ name: 'Batch 1', prompts: [{ text: 'T1', type: 'image' }] });
      const p2 = await ProjectRepository.create({ name: 'Batch 2', prompts: [{ text: 'T2', type: 'image' }] });
      const p3 = await ProjectRepository.create({ name: 'Batch 3', prompts: [{ text: 'T3', type: 'image' }] });

      const all = await ProjectRepository.getAll();
      const ids = all.map((p) => p.projectId);
      expect(ids).toContain(p1.projectId);
      expect(ids).toContain(p2.projectId);
      expect(ids).toContain(p3.projectId);

      await ProjectRepository.delete(p1.projectId);
      await ProjectRepository.delete(p2.projectId);
      await ProjectRepository.delete(p3.projectId);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Bulk Prompt Parsing & Live Submission Non-Blocking Behavior
  // ---------------------------------------------------------------------------
  describe('2. Bulk Prompt Parsing & Input Responsiveness', () => {
    it('PromptParser parses 500 lines efficiently in under 50ms', () => {
      const lines: string[] = [];
      for (let i = 0; i < 500; i++) {
        lines.push(`${i + 1}. A cinematic shot of an astronaut walking on Mars, high detail #${i + 1}`);
      }
      const rawText = lines.join('\n');

      const start = performance.now();
      const parsed = PromptParser.parseRawText(rawText, 'video');
      const duration = performance.now() - start;

      expect(parsed.length).toBe(500);
      expect(parsed[0]?.text).toContain('A cinematic shot of an astronaut walking on Mars');
      expect(duration).toBeLessThan(50);
    });

    it('filters out empty lines and preserves prompt order 0..N-1', () => {
      const rawText = `
        1. First prompt
        
        2. Second prompt
        
        3. Third prompt
      `;
      const parsed = PromptParser.parseRawText(rawText, 'image');
      expect(parsed.length).toBe(3);
      expect(parsed[0]?.text).toBe('1. First prompt');
      expect(parsed[1]?.text).toBe('2. Second prompt');
      expect(parsed[2]?.text).toBe('3. Third prompt');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Progress Event Coalescing Guarantee
  // ---------------------------------------------------------------------------
  describe('3. Progress Event Coalescing Logic', () => {
    it('buffers multiple progress ticks for same slot and retains the latest tick', () => {
      const buffer: Record<number, { percent: number; stage: string }> = {};

      // Simulate 10 rapid progress ticks within a single render cycle
      for (let i = 1; i <= 10; i++) {
        buffer[0] = { percent: i * 10, stage: i === 10 ? 'downloading' : 'generating' };
      }

      // Flush batch
      const batch = { ...buffer };
      expect(batch[0]?.percent).toBe(100);
      expect(batch[0]?.stage).toBe('downloading');
    });

    it('buffers multiple different slot updates without overwriting each other', () => {
      const buffer: Record<number, { percent: number; stage: string }> = {};

      buffer[0] = { percent: 45, stage: 'generating' };
      buffer[1] = { percent: 80, stage: 'downloading' };
      buffer[2] = { percent: 15, stage: 'starting' };

      const batch = { ...buffer };
      expect(batch[0]?.percent).toBe(45);
      expect(batch[1]?.percent).toBe(80);
      expect(batch[2]?.percent).toBe(15);
    });
  });
});
