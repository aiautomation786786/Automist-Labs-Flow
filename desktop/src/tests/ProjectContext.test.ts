/**
 * Tests for ProjectContext.
 *
 * Verifies project ID parsing, URL construction, and anti-stickiness logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { ProjectContext, PROJECT_URL_REGEX } from '../main/engine/ProjectContext';

describe('ProjectContext', () => {
  describe('extractProjectId', () => {
    it('should extract UUID from standard Flow project URL', () => {
      const url = 'https://labs.google/fx/en/tools/flow/project/9a8b7c6d-1234-5678-abcd-ef0123456789';
      const id = ProjectContext.extractProjectId(url);
      expect(id).toBe('9a8b7c6d-1234-5678-abcd-ef0123456789');
    });

    it('should extract UUID from flow.google.com project URL', () => {
      const url = 'https://flow.google.com/project/00e59600-6138-4245-a29d-8cb3ed53403d';
      const id = ProjectContext.extractProjectId(url);
      expect(id).toBe('00e59600-6138-4245-a29d-8cb3ed53403d');
    });

    it('should extract ID from French Flow project URL', () => {
      const url = 'https://labs.google/fx/fr/tools/flow/project/project_alpha_123';
      const id = ProjectContext.extractProjectId(url);
      expect(id).toBe('project_alpha_123');
    });

    it('should extract ID when URL contains query parameters or hash', () => {
      const url = 'https://labs.google/fx/en/tools/flow/project/abc-123?tab=settings#view';
      const id = ProjectContext.extractProjectId(url);
      expect(id).toBe('abc-123');
    });

    it('should return null for Flow home page (not a project)', () => {
      const url = 'https://labs.google/fx/en/tools/flow';
      expect(ProjectContext.extractProjectId(url)).toBeNull();
    });

    it('should return null for empty string or invalid URL', () => {
      expect(ProjectContext.extractProjectId('')).toBeNull();
      expect(ProjectContext.extractProjectId('https://google.com')).toBeNull();
    });
  });

  describe('getCurrentProject', () => {
    it('should return FlowProjectInfo when page is on a project URL', () => {
      const fakePage = {
        url: vi.fn(() => 'https://labs.google/fx/en/tools/flow/project/test-proj-999'),
      } as unknown as import('playwright').Page;

      const project = ProjectContext.getCurrentProject(fakePage);
      expect(project).not.toBeNull();
      expect(project?.id).toBe('test-proj-999');
      expect(project?.url).toBe('https://labs.google/fx/en/tools/flow/project/test-proj-999');
      expect(project?.lastAccessed).toBeTruthy();
    });

    it('should return null when page is on main Flow homepage', () => {
      const fakePage = {
        url: vi.fn(() => 'https://labs.google/fx/en/tools/flow'),
      } as unknown as import('playwright').Page;

      const project = ProjectContext.getCurrentProject(fakePage);
      expect(project).toBeNull();
    });
  });

  describe('Anti-stickiness logic in ensureProject', () => {
    it('should reuse currently open project if matching the requested ID', async () => {
      const fakePage = {
        url: vi.fn(() => 'https://labs.google/fx/en/tools/flow/project/requested-id-123'),
        goto: vi.fn(),
        waitForTimeout: vi.fn(),
      } as unknown as import('playwright').Page;

      const project = await ProjectContext.ensureProject(fakePage, {
        projectId: 'requested-id-123',
      });

      // No navigation should occur because we are already on requested project
      expect(project.id).toBe('requested-id-123');
      expect(fakePage.goto).not.toHaveBeenCalled();
    });

    it('should NOT reuse currently open project if a different ID is requested', async () => {
      let currentUrl = 'https://labs.google/fx/en/tools/flow/project/old-sticky-project';

      const fakePage = {
        url: vi.fn(() => currentUrl),
        goto: vi.fn(async (newUrl: string) => {
          currentUrl = newUrl;
        }),
        waitForTimeout: vi.fn(),
      } as unknown as import('playwright').Page;

      const project = await ProjectContext.ensureProject(fakePage, {
        projectId: 'new-target-project',
      });

      // Verification: must navigate to the new target project, fixing the stickiness bug
      expect(fakePage.goto).toHaveBeenCalledWith(
        'https://labs.google/fx/en/tools/flow/project/new-target-project',
        expect.any(Object),
      );
      expect(project.id).toBe('new-target-project');
    });

    it('should reuse any currently open project if no specific ID is requested', async () => {
      const fakePage = {
        url: vi.fn(() => 'https://labs.google/fx/en/tools/flow/project/any-open-project'),
        goto: vi.fn(),
        waitForTimeout: vi.fn(),
      } as unknown as import('playwright').Page;

      const project = await ProjectContext.ensureProject(fakePage, {});
      expect(project.id).toBe('any-open-project');
      expect(fakePage.goto).not.toHaveBeenCalled();
    });
  });
});
