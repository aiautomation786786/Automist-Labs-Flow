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
      listGeminiKeys: vi.fn().mockResolvedValue([
        { id: 'key_1', masked: '••••••••••••1234', status: 'healthy', cooldownUntil: null, lastUsedAt: null, failureCount: 0 }
      ]),
      addGeminiKey: vi.fn().mockResolvedValue({
        success: true,
        keys: [
          { id: 'key_1', masked: '••••••••••••1234', status: 'healthy', cooldownUntil: null, lastUsedAt: null, failureCount: 0 },
          { id: 'key_2', masked: '••••••••••••5678', status: 'healthy', cooldownUntil: null, lastUsedAt: null, failureCount: 0 },
        ],
      }),
      removeGeminiKey: vi.fn().mockResolvedValue({ success: true, keys: [] }),
      revealGeminiKey: vi.fn().mockResolvedValue({ success: true, fullKey: 'AIzaSySecretPlaintextKey1234' }),
      testScriptAiConnection: vi.fn().mockResolvedValue({ success: true, model: 'gemini-2.5-flash', isMock: false }),
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

  it('confirms mixed processing order is removed and supports updating download quality and log level', async () => {
    render(<SettingsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Verify "Default Mixed Processing Order" is NOT rendered anywhere
    expect(screen.queryByText(/Default Mixed Processing Order/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Videos First/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Images First/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Automatic \(FIFO\)/i })).toBeNull();

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

  it('renders and manages multi-key Gemini API keys correctly', async () => {
    render(<SettingsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Verify Gemini API Keys section is rendered
    expect(screen.getAllByText(/Gemini API Keys/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/safeStorage/i).length).toBeGreaterThan(0);

    // Verify initial key appears masked
    expect(screen.getByText('••••••••••••1234')).toBeDefined();
    expect(screen.getByText('Healthy')).toBeDefined();

    // Add a new key
    const input = screen.getByPlaceholderText(/Paste Gemini API key/i);
    const addBtn = screen.getByRole('button', { name: /\+ Add Key/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'AIzaSyNewKey999999' } });
      fireEvent.click(addBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.addGeminiKey).toHaveBeenCalledWith('AIzaSyNewKey999999');

    // Test Show key toggle
    const showBtns = screen.getAllByRole('button', { name: /Show/i });
    await act(async () => {
      fireEvent.click(showBtns[0]);
      await Promise.resolve();
    });

    expect(window.flowApi?.revealGeminiKey).toHaveBeenCalledWith('key_1');

    // Test Connection button
    const testBtn = screen.getByRole('button', { name: /Test Connection/i });
    await act(async () => {
      fireEvent.click(testBtn);
      await Promise.resolve();
    });

    expect(window.flowApi?.testScriptAiConnection).toHaveBeenCalled();
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
