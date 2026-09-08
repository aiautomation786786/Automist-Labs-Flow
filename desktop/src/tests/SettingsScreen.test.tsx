/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SettingsScreen } from '../renderer/screens/SettingsScreen';
import type { AppSettings } from '../shared/types';

describe('SettingsScreen', () => {
  const mockSettings: AppSettings = {
    appDataDir: 'C:/UserData/FlowDesktop',
    defaultImageRatio: '16:9',
    defaultProcessingOrder: 'images_first',
    maxRetries: 2,
    logLevel: 'INFO',
  };

  beforeEach(() => {
    window.flowApi = {
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      updateSettings: vi.fn().mockImplementation((patch) => Promise.resolve({ ...mockSettings, ...patch })),
      getAppInfo: vi.fn().mockResolvedValue({
        version: '1.0.0',
        chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        appDataDir: 'C:/UserData/FlowDesktop',
      }),
      listProjects: vi.fn().mockResolvedValue([]),
      getProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
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
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('renders application settings and updates configuration', async () => {
    render(<SettingsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue('C:/UserData/FlowDesktop')).toBeDefined();
    expect(screen.getByText(/Version:\s*1\.0\.0/i)).toBeDefined();

    // Click 9:16 aspect ratio button
    const ratioBtn = screen.getByRole('button', { name: /9:16/i });
    await act(async () => {
      fireEvent.click(ratioBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultImageRatio: '9:16',
      })
    );
  });
});
