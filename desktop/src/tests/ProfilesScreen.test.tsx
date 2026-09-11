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

    // Banner text is present
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

  it('Test CDP button is NOT visible on account cards', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Test CDP must not appear in the normal card UI
    const testCdpBtns = screen.queryAllByRole('button', { name: /Test CDP/i });
    expect(testCdpBtns.length).toBe(0);
  });

  it('handles Verify Account action on cards (no Test CDP button)', async () => {
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

    // Confirm Test CDP is still absent after interaction
    expect(screen.queryAllByRole('button', { name: /Test CDP/i }).length).toBe(0);
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

  it('clicking Add Flow Account opens choice modal (not Chrome directly)', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    // Choice modal should open
    expect(screen.getByText('Add a Flow Account')).toBeDefined();
    expect(screen.getByText(/Choose how you want to connect/i)).toBeDefined();

    // Both options must be present
    expect(screen.getByText('Sign in with Google')).toBeDefined();
    expect(screen.getByText('Connect Existing Chrome Profile')).toBeDefined();
    expect(screen.getByText(/Continue with Google/i)).toBeDefined();
    expect(screen.getByText(/Scan Chrome Profiles/i)).toBeDefined();

    // Chrome must NOT have been launched yet — user hasn't chosen
    expect(window.flowApi?.createProfile).not.toHaveBeenCalled();
    expect(window.flowApi?.launchLoginBrowser).not.toHaveBeenCalled();
  });

  it('choosing Sign in with Google in choice modal launches Chrome', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Open choice modal
    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    // Click the "Sign in with Google" option
    const googleBtn = screen.getByTestId('choice-google-signin');
    await act(async () => {
      fireEvent.click(googleBtn);
      await Promise.resolve();
    });

    // createProfile and launchLoginBrowser should both be called
    expect(window.flowApi?.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: expect.stringMatching(/Flow Account/) })
    );
    expect(window.flowApi?.launchLoginBrowser).toHaveBeenCalledWith('prof_3');

    // Sign-in onboarding modal should appear (text may appear in multiple places)
    expect(screen.getAllByText(/Chrome window is open/i).length).toBeGreaterThan(0);
  });

  it('choosing Connect Existing Chrome Profile in choice modal opens scan modal', async () => {
    // Setup detectLocalChromeProfiles
    (window.flowApi as any).detectLocalChromeProfiles = vi.fn().mockResolvedValue([]);

    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // Open choice modal
    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    // Click the "Connect Existing Chrome Profile" option
    const connectBtn = screen.getByTestId('choice-connect-existing');
    await act(async () => {
      fireEvent.click(connectBtn);
      await Promise.resolve();
    });

    // Connect Existing Chrome Profile modal should open
    expect(screen.getByText(/Connect Existing Chrome Profile/i)).toBeDefined();
    expect(window.flowApi?.launchLoginBrowser).not.toHaveBeenCalled();
    expect((window.flowApi as any).detectLocalChromeProfiles).toHaveBeenCalled();
  });

  it('choice modal can be dismissed without launching Chrome', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    // Modal should be open
    expect(screen.getByText('Add a Flow Account')).toBeDefined();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await Promise.resolve();
    });

    // Modal should be gone, Chrome was never launched
    expect(screen.queryByText('Add a Flow Account')).toBeNull();
    expect(window.flowApi?.launchLoginBrowser).not.toHaveBeenCalled();
    expect(window.flowApi?.createProfile).not.toHaveBeenCalled();
  });
});
