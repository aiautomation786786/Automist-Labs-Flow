/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { WorkspaceScreen } from '../renderer/screens/WorkspaceScreen';
import type { ProjectEntity, SlotUpdatedEvent } from '../shared/types';

describe('WorkspaceScreen Out-Of-Order Completion & Slot Invariant', () => {
  let mockProject: ProjectEntity;
  let slotUpdatedCallback: (event: SlotUpdatedEvent) => void;

  beforeEach(() => {
    mockProject = {
      projectId: 'proj_test_ordering',
      name: 'Ordering Invariant Project',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        imageRatio: '16:9',
        videoRatio: '16:9',
        processingOrder: 'images_first',
        autoRetry: true,
        maxRetries: 2,
      },
      slots: [
        {
          slotIndex: 0,
          promptId: 'slot_0',
          projectId: 'proj_test_ordering',
          type: 'image',
          promptText: 'Prompt 0 text',
          status: 'queued',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          slotIndex: 1,
          promptId: 'slot_1',
          projectId: 'proj_test_ordering',
          type: 'image',
          promptText: 'Prompt 1 text',
          status: 'queued',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          slotIndex: 2,
          promptId: 'slot_2',
          projectId: 'proj_test_ordering',
          type: 'image',
          promptText: 'Prompt 2 text',
          status: 'queued',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          slotIndex: 3,
          promptId: 'slot_3',
          projectId: 'proj_test_ordering',
          type: 'image',
          promptText: 'Prompt 3 text',
          status: 'queued',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      stats: {
        totalImages: 4,
        totalVideos: 0,
        completedImages: 0,
        completedVideos: 0,
        failedCount: 0,
      },
    };

    window.flowApi = {
      getProject: vi.fn().mockResolvedValue(mockProject),
      startProjectGeneration: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([mockProject]),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
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
      onSlotUpdated: vi.fn().mockImplementation((cb) => {
        slotUpdatedCallback = cb;
        return () => {};
      }),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      launchLoginBrowser: vi.fn().mockResolvedValue({ success: true, pid: 99999, cdpPort: 9222, userDataDir: 'C:\\test', message: 'Chrome opened' }),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('CRITICAL INVARIANT: Out-of-order completion (3 -> 1 -> 4 -> 2) strictly displays slots (1 -> 2 -> 3 -> 4)', async () => {
    const { container } = render(
      <WorkspaceScreen projectId="proj_test_ordering" onBackToProjects={() => {}} />
    );

    // Wait for project to load
    await act(async () => {
      await Promise.resolve();
    });

    // Check that 4 slots are initially rendered in order #01, #02, #03, #04
    expect(screen.getByText('Ordering Invariant Project')).toBeDefined();
    expect(screen.getByText('#01')).toBeDefined();
    expect(screen.getByText('#02')).toBeDefined();
    expect(screen.getByText('#03')).toBeDefined();
    expect(screen.getByText('#04')).toBeDefined();

    // Now simulate OUT-OF-ORDER completion:
    // Slot 2 finishes first (Slot #03 in 1-based index)
    act(() => {
      slotUpdatedCallback({
        projectId: 'proj_test_ordering',
        slotIndex: 2,
        promptId: 'slot_2',
        status: 'completed',
        result: {
          assetId: 'uuid_result_slot_2',
          mediaPath: 'C:\\fake\\slot_02.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 2048,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Slot 0 finishes second (Slot #01 in 1-based index)
    act(() => {
      slotUpdatedCallback({
        projectId: 'proj_test_ordering',
        slotIndex: 0,
        promptId: 'slot_0',
        status: 'completed',
        result: {
          assetId: 'uuid_result_slot_0',
          mediaPath: 'C:\\fake\\slot_00.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 1024,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Slot 3 finishes third (Slot #04 in 1-based index)
    act(() => {
      slotUpdatedCallback({
        projectId: 'proj_test_ordering',
        slotIndex: 3,
        promptId: 'slot_3',
        status: 'completed',
        result: {
          assetId: 'uuid_result_slot_3',
          mediaPath: 'C:\\fake\\slot_03.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 4096,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Slot 1 finishes fourth (Slot #02 in 1-based index)
    act(() => {
      slotUpdatedCallback({
        projectId: 'proj_test_ordering',
        slotIndex: 1,
        promptId: 'slot_1',
        status: 'completed',
        result: {
          assetId: 'uuid_result_slot_1',
          mediaPath: 'C:\\fake\\slot_01.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          completedAt: new Date().toISOString(),
          fileSizeBytes: 3072,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Verify DOM order: all slot number labels in the document must appear strictly in order: #01, #02, #03, #04
    const renderedSlotLabels = Array.from(
      container.querySelectorAll('span')
    )
      .map((el) => el.textContent?.trim())
      .filter((text): text is string => /^#0[1-4]$/.test(text ?? ''));

    expect(renderedSlotLabels).toEqual(['#01', '#02', '#03', '#04']);

    // Verify progress summary reflects 100% completed
    expect(screen.getByText('100%')).toBeDefined();
  });
});
