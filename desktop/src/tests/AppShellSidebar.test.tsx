/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppShell } from '../renderer/components/AppShell';

describe('AppShell Sidebar Cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([]),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      getCapacityMetrics: vi.fn().mockResolvedValue({}),
      getAppInfo: vi.fn().mockResolvedValue({ version: '1.0.0', platform: 'win32' }),
      getSettings: vi.fn().mockResolvedValue({}),
    } as any;
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('verifies Gemini Status is completely absent from sidebar', () => {
    render(<AppShell />);

    // Gemini Status nav item must not exist
    expect(screen.queryByTestId('nav-item-gemini_video')).toBeNull();
    expect(screen.queryByText('Gemini Status')).toBeNull();
  });

  it('verifies all dummy/milestone badges are removed from sidebar', () => {
    render(<AppShell />);

    // Dummy badges that must NOT exist in the sidebar
    expect(screen.queryByText('New')).toBeNull();
    expect(screen.queryByText('Phase 7')).toBeNull();
    expect(screen.queryByText('Phase 8')).toBeNull();
    expect(screen.queryByText('Nano 2')).toBeNull();
    expect(screen.queryByText('Flow + Gemini')).toBeNull();
    expect(screen.queryByText('Parallel')).toBeNull();
    expect(screen.queryByText('Omni Flash')).toBeNull();
    expect(screen.queryByText('Diagnostics')).toBeNull();

    // Standalone Skills item is removed per ZBot §4 (accessed via From Skill & Channel settings)
    expect(screen.queryByTestId('nav-item-skills')).toBeNull();

    // Standalone Channels item is removed per ZBot §4 (integrated inside Projects workspace)
    expect(screen.queryByTestId('nav-item-channels')).toBeNull();

    // Clean valid navigation items must exist
    expect(screen.getByTestId('nav-item-projects')).toBeDefined();
    expect(screen.getByTestId('nav-item-create_video')).toBeDefined();
    expect(screen.getByTestId('nav-item-single_image')).toBeDefined();
    expect(screen.getByTestId('nav-item-single_video')).toBeDefined();
    expect(screen.getByTestId('nav-item-bulk_image')).toBeDefined();
    expect(screen.getByTestId('nav-item-bulk_video')).toBeDefined();
    expect(screen.getByTestId('nav-item-image_to_video')).toBeDefined();
    expect(screen.getByTestId('nav-item-bulk_image_to_video')).toBeDefined();
    expect(screen.getByTestId('nav-item-profiles')).toBeDefined();
    expect(screen.getByTestId('nav-item-settings')).toBeDefined();
  });
});
