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
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('renders profile list with isolation banner and action buttons', async () => {
    render(<ProfilesScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Flow profiles use separate browser sessions/i)).toBeDefined();
    expect(screen.getByText('Main Generation Profile')).toBeDefined();
    expect(screen.getByText('Secondary Profile')).toBeDefined();
    expect(screen.getByText('user1@example.com')).toBeDefined();
    expect(screen.getAllByText(/Ready/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Login Required/i).length).toBeGreaterThan(0);

    // Click Open Sign-In for prof_2
    const signInBtns = screen.getAllByRole('button', { name: /Open Sign-In/i });
    await act(async () => {
      fireEvent.click(signInBtns[1]);
      await Promise.resolve();
    });

    expect(window.flowApi?.openSignIn).toHaveBeenCalledWith('prof_2');
  });

  it('handles Verify Account and Test Connection actions', async () => {
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

    const testBtns = screen.getAllByRole('button', { name: /Test Connection/i });
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
});
