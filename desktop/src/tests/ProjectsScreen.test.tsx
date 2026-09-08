/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ProjectsScreen } from '../renderer/screens/ProjectsScreen';
import type { ProjectEntity } from '../shared/types';

describe('ProjectsScreen', () => {
  afterEach(() => {
    cleanup();
  });
  const mockProjects: ProjectEntity[] = [
    {
      projectId: 'proj_1',
      name: 'Cyberpunk Episode',
      campaignTag: 'SciFi',
      settings: {
        imageRatio: '16:9',
        videoRatio: '16:9',
        processingOrder: 'images_first',
        autoRetry: true,
        maxRetries: 2,
      },
      stats: {
        totalImages: 1,
        totalVideos: 1,
        completedImages: 1,
        completedVideos: 1,
        failedCount: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      slots: [
        {
          slotIndex: 0,
          promptId: 'slot_1',
          projectId: 'proj_1',
          type: 'image',
          promptText: 'Neon car',
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          slotIndex: 1,
          promptId: 'slot_2',
          projectId: 'proj_1',
          type: 'video',
          promptText: 'Drone flying',
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    {
      projectId: 'proj_2',
      name: 'Fantasy Landscapes',
      campaignTag: 'Fantasy',
      settings: {
        imageRatio: '9:16',
        videoRatio: '16:9',
        processingOrder: 'automatic',
        autoRetry: true,
        maxRetries: 2,
      },
      stats: {
        totalImages: 1,
        totalVideos: 0,
        completedImages: 0,
        completedVideos: 0,
        failedCount: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      slots: [
        {
          slotIndex: 0,
          promptId: 'slot_3',
          projectId: 'proj_2',
          type: 'image',
          promptText: 'Magic castle',
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  ];

  beforeEach(() => {
    window.flowApi = {
      listProjects: vi.fn().mockResolvedValue(mockProjects),
      getProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn().mockResolvedValue(undefined),
      startProjectGeneration: vi.fn(),
      cancelJob: vi.fn(),
      getProjectJobs: vi.fn().mockResolvedValue([]),
      listProfiles: vi.fn().mockResolvedValue([]),
      createProfile: vi.fn(),
      startProfile: vi.fn(),
      stopProfile: vi.fn(),
      deleteProfile: vi.fn(),
      openChrome: vi.fn(),
      openSignIn: vi.fn().mockResolvedValue({ success: true, message: 'Ready' }),
      verifyAccount: vi.fn().mockResolvedValue({ success: true, status: 'ready', detectedEmail: 'test@example.com' }),
      testConnection: vi.fn().mockResolvedValue({ success: true, port: 9222, responsive: true, status: 'ready' }),
      getAppInfo: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      launchLoginBrowser: vi.fn().mockResolvedValue({ success: true, pid: 99999, cdpPort: 9222, userDataDir: 'C:\\test', message: 'Chrome opened' }),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('renders project list and filters by search query', async () => {
    const onOpenProject = vi.fn();
    const onNavigateNewProject = vi.fn();

    render(
      <ProjectsScreen
        onOpenProject={onOpenProject}
        onNavigateNewProject={onNavigateNewProject}
      />
    );

    // Wait for initial load
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Cyberpunk Episode')).toBeDefined();
    expect(screen.getByText('Fantasy Landscapes')).toBeDefined();

    // Filter by "cyber"
    const searchInput = screen.getByPlaceholderText(/Search projects by name or tag/i);
    fireEvent.change(searchInput, { target: { value: 'cyber' } });

    expect(screen.getByText('Cyberpunk Episode')).toBeDefined();
    expect(screen.queryByText('Fantasy Landscapes')).toBeNull();

    // Click Open button for Cyberpunk Episode
    const openButtons = screen.getAllByRole('button', { name: /Open/i });
    fireEvent.click(openButtons[0]);
    expect(onOpenProject).toHaveBeenCalledWith('proj_1');
  });

  it('handles project deletion confirmation flow', async () => {
    render(
      <ProjectsScreen
        onOpenProject={() => {}}
        onNavigateNewProject={() => {}}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Find and click delete button for first project
    const deleteButtons = screen.getAllByTitle('Delete project');
    expect(deleteButtons.length).toBe(2);

    fireEvent.click(deleteButtons[0]);

    // Confirm modal should appear
    expect(screen.getByText(/Are you sure you want to delete "Cyberpunk Episode"/i)).toBeDefined();
    const confirmBtn = screen.getByRole('button', { name: /Delete Project/i });

    await act(async () => {
      fireEvent.click(confirmBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.deleteProject).toHaveBeenCalledWith('proj_1');
  });
});
