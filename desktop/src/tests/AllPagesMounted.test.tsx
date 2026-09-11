/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { AppShell } from '../renderer/components/AppShell';

describe('All-Pages-Mounted Architecture (ZBot §4 Parity)', () => {
  beforeEach(() => {
    (window as any).flowApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([]),
      listChannels: vi.fn().mockResolvedValue([]),
      listSkills: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
      getTtsEngines: vi.fn().mockResolvedValue([]),
      listVoices: vi.fn().mockResolvedValue([]),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onGenerationProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      getSystemMetrics: vi.fn().mockResolvedValue({
        cpuPercent: 12,
        freeMemMb: 8000,
        totalMemMb: 16000,
        memPercent: 50,
        pingMs: 25,
        timestamp: new Date().toISOString(),
      }),
      getFactoryDraft: vi.fn().mockResolvedValue(null),
      saveFactoryDraft: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('initially mounts Projects screen with display: flex', async () => {
    await act(async () => {
      render(<AppShell />);
    });

    const projectsContainer = screen.getByTestId('view-container-projects');
    expect(projectsContainer).toBeTruthy();
    expect(projectsContainer.style.display).toBe('flex');
  });

  it('preserves Projects in the DOM with display: none when navigating to Channels', async () => {
    await act(async () => {
      render(<AppShell />);
    });

    const channelsNavBtn = screen.getByTestId('nav-item-channels');

    await act(async () => {
      fireEvent.click(channelsNavBtn);
    });

    // Channels container should now be mounted and visible
    const channelsContainer = screen.getByTestId('view-container-channels');
    expect(channelsContainer).toBeTruthy();
    expect(channelsContainer.style.display).toBe('flex');

    // Projects container MUST remain in the DOM (never unmounted), with display: none
    const projectsContainer = screen.getByTestId('view-container-projects');
    expect(projectsContainer).toBeTruthy();
    expect(projectsContainer.style.display).toBe('none');
  });

  it('keeps multiple visited views mounted simultaneously across repeated navigation', async () => {
    await act(async () => {
      render(<AppShell />);
    });

    // Visit Channels
    const channelsNavBtn = screen.getByTestId('nav-item-channels');
    await act(async () => {
      fireEvent.click(channelsNavBtn);
    });

    const channelsContainer = screen.getByTestId('view-container-channels');
    expect(channelsContainer.style.display).toBe('flex');
    expect(screen.getByTestId('view-container-projects').style.display).toBe('none');

    // Visit Create Video
    const createVideoNavBtn = screen.getByTestId('nav-item-create_video');
    await act(async () => {
      fireEvent.click(createVideoNavBtn);
    });

    const createVideoContainer = screen.getByTestId('view-container-create-video');
    expect(createVideoContainer.style.display).toBe('flex');
    expect(screen.getByTestId('view-container-channels').style.display).toBe('none');
    expect(screen.getByTestId('view-container-projects').style.display).toBe('none');

    // Return to Projects
    const projectsNavBtn = screen.getByTestId('nav-item-projects');
    await act(async () => {
      fireEvent.click(projectsNavBtn);
    });

    // Projects should be visible again without remounting
    expect(screen.getByTestId('view-container-projects').style.display).toBe('flex');
    expect(screen.getByTestId('view-container-create-video').style.display).toBe('none');
    expect(screen.getByTestId('view-container-channels').style.display).toBe('none');
  });
});
