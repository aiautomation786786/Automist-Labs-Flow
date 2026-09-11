/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ProfilesScreen } from '../renderer/screens/ProfilesScreen';
import type { ProfileSessionSnapshot } from '../shared/types';

describe('ProfilesScreen', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });
  const mockProfiles: ProfileSessionSnapshot[] = [
    {
      profileId: 'prof_1',
      displayName: 'Main Generation Profile',
      chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      cdpPort: 9222,
      status: 'ready',
      detectedEmail: 'user1@example.com',
      flowUrl: null,
      errorMessage: null,
      lastStatusChange: new Date().toISOString(),
      uptimeMs: 120000,
    },
    {
      profileId: 'prof_2',
      displayName: 'Secondary Profile',
      chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      cdpPort: 9223,
      status: 'auth_required',
      detectedEmail: null,
      flowUrl: null,
      errorMessage: null,
      lastStatusChange: new Date().toISOString(),
      uptimeMs: 60000,
    },
  ];

  beforeEach(() => {
    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue(mockProfiles),
      createProfile: vi.fn().mockResolvedValue({ profileId: 'prof_3', displayName: 'Profile 3' }),
      startProfile: vi.fn().mockResolvedValue({ ok: true }),
      stopProfile: vi.fn().mockResolvedValue({ ok: true }),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
      openChrome: vi.fn().mockResolvedValue({ ok: true }),
      openSignIn: vi.fn().mockResolvedValue({ success: true, message: 'Ready' }),
      verifyAccount: vi.fn().mockResolvedValue({ success: true, status: 'ready', detectedEmail: 'user1@example.com' }),
      testConnection: vi.fn().mockResolvedValue({ success: true, port: 9222, responsive: true, status: 'ready' }),
      listProjects: vi.fn().mockResolvedValue([]),
      getProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      startProjectGeneration: vi.fn(),
      cancelJob: vi.fn(),
      getProjectJobs: vi.fn().mockResolvedValue([]),
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

  it('renders profile list with isolation banner and action buttons', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Banner text is updated to dedicated profile architecture
    expect(screen.getByText(/Dedicated Flow Profiles/i)).toBeDefined();
    // Profile names appear in cards
    expect(screen.getByText('Main Generation Profile')).toBeDefined();
    expect(screen.getByText('Secondary Profile')).toBeDefined();
    // Detected email shown
    expect(screen.getByText('user1@example.com')).toBeDefined();
    // Status badges
    expect(screen.getAllByText(/Authenticated/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sign-In Required/i).length).toBeGreaterThan(0);

    // Click Open Login for auth_required profile (prof_2)
    const openLoginBtns = screen.getAllByRole('button', { name: /Open Login/i });
    await act(async () => {
      fireEvent.click(openLoginBtns[0]); // prof_2 is auth_required, shows Open Login
      await Promise.resolve();
    });

    expect(window.flowApi?.launchLoginBrowser).toHaveBeenCalled();
  });

  it('handles Verify Account and Test CDP actions', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    const verifyBtns = screen.getAllByRole('button', { name: /Verify Account/i });
    await act(async () => {
      fireEvent.click(verifyBtns[0]);
      await Promise.resolve();
    });

    expect(window.flowApi?.verifyAccount).toHaveBeenCalledWith('prof_1');

    const testBtns = screen.getAllByRole('button', { name: /Test CDP/i });
    await act(async () => {
      fireEvent.click(testBtns[0]);
      await Promise.resolve();
    });

    expect(window.flowApi?.testConnection).toHaveBeenCalledWith('prof_1');
  });

  it('handles Stop Profile action', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    const stopButtons = screen.getAllByRole('button', { name: 'Stop' });
    await act(async () => {
      fireEvent.click(stopButtons[0]);
      await Promise.resolve();
    });

    expect(window.flowApi?.stopProfile).toHaveBeenCalledWith('prof_1');
  });

  it('launches Chrome immediately on clicking Add Flow Account without multi-step wizard', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    // Verify createProfile was called with auto-generated name
    expect(window.flowApi?.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: expect.stringMatching(/Flow Account/) })
    );

    // Verify launchLoginBrowser was called immediately
    expect(window.flowApi?.launchLoginBrowser).toHaveBeenCalledWith('prof_3');

    // Verify streamlined modal is open instructing user to sign in
    expect(screen.getByText(/Chrome window is open to Google Flow/i)).toBeDefined();
    expect(screen.getByText(/Sign into your Google Account in the Chrome window/i)).toBeDefined();
  });
});
