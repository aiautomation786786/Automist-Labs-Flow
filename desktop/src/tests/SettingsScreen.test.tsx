/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SettingsScreen } from '../renderer/screens/SettingsScreen';
import type { AppSettings } from '../shared/types';

describe('SettingsScreen', () => {
  const mockSettings: AppSettings = {
    appDataDir: 'C:/UserData/FlowDesktop',
    defaultImageRatio: '16:9',
    defaultProcessingOrder: 'images_first',
    maxRetries: 2,
    logLevel: 'INFO',
    defaultImageDownloadQuality: 'original',
    defaultVideoDownloadQuality: 'original',
  };

  beforeEach(() => {
    window.flowApi = {
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      updateSettings: vi.fn().mockImplementation((patch) => Promise.resolve({ ...mockSettings, ...patch })),
      getAppInfo: vi.fn().mockResolvedValue({
        version: '1.0.0',
        chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        appDataDir: 'C:/UserData/FlowDesktop',
        platform: 'win32',
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
      launchLoginBrowser: vi.fn().mockResolvedValue({ success: true, pid: 99999, cdpPort: 9222, userDataDir: 'C:\\test', message: 'Chrome opened' }),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
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

  it('supports updating processing order, retries, download quality, and log level', async () => {
    render(<SettingsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Change processing order to Videos First
    const videosFirstBtn = screen.getByRole('button', { name: /Videos First/i });
    await act(async () => {
      fireEvent.click(videosFirstBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultProcessingOrder: 'videos_first',
      })
    );

    // Change log level to DEBUG
    const debugBtn = screen.getByRole('button', { name: /DEBUG/i });
    await act(async () => {
      fireEvent.click(debugBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        logLevel: 'DEBUG',
      })
    );

    // Change image download quality to 2K
    const twoKBtn = screen.getByRole('button', { name: /2K High Definition/i });
    await act(async () => {
      fireEvent.click(twoKBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultImageDownloadQuality: '2k',
      })
    );

    // Change video download quality to 1080p
    const tenEightyBtn = screen.getByRole('button', { name: /1080p Full HD/i });
    await act(async () => {
      fireEvent.click(tenEightyBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultVideoDownloadQuality: '1080p',
      })
    );
  });

  it('displays error banner when updateSettings fails', async () => {
    vi.mocked(window.flowApi!.updateSettings).mockRejectedValueOnce(
      new Error('Validation error: invalid setting')
    );

    render(<SettingsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    const ratioBtn = screen.getByRole('button', { name: /9:16/i });
    await act(async () => {
      fireEvent.click(ratioBtn);
      await Promise.resolve();
    });

    expect(screen.getByText('Validation error: invalid setting')).toBeDefined();
  });
});
