/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const mockSpawnCalls: Array<{ cmd: string; args: string[]; options: any }> = [];

vi.mock('child_process', () => {
  const Emitter = require('events').EventEmitter;
  const mockSpawn = vi.fn((cmd: string, args: string[], options: any) => {
    mockSpawnCalls.push({ cmd, args, options });
    const proc = new Emitter() as any;
    proc.pid = 88800 + mockSpawnCalls.length;
    proc.killed = false;
    proc.exitCode = null;
    proc.kill = vi.fn((sig?: string) => {
      proc.killed = true;
      proc.exitCode = 0;
      proc.emit('exit', 0, sig || 'SIGTERM');
      return true;
    });
    proc.stdout = new Emitter();
    proc.stderr = new Emitter();
    return proc;
  });

  return {
    default: {
      spawn: mockSpawn,
      execSync: vi.fn().mockReturnValue(Buffer.from('')),
      execFile: vi.fn(),
    },
    spawn: mockSpawn,
    execSync: vi.fn().mockReturnValue(Buffer.from('')),
    execFile: vi.fn(),
  };
});

import { ProfileSession } from '../main/engine/ProfileSession';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ProfileConfigManager } from '../main/engine/ProfileConfig';
import { LocalChromeProfileDiscoverer } from '../main/engine/LocalChromeProfileDiscoverer';
import { WindowsChromeFinder } from '../main/engine/WindowsChromeFinder';
import { ProfilesScreen } from '../renderer/screens/ProfilesScreen';
import type { ProfileConfig } from '../shared/types';

describe('Account Verification Experience & Strict Isolation', () => {
  let tempDir: string;
  let originalLocalAppData: string | undefined;
  let originalFlowAppData: string | undefined;
  let testChromePath: string;

  function makeConfig(id: string, port: number, extra: Partial<ProfileConfig> = {}): ProfileConfig {
    return {
      profileId: id,
      displayName: `Profile ${id}`,
      userDataDir: path.join(tempDir, 'FlowProfiles', id, 'chrome-user-data'),
      chromeProfileName: 'Default',
      chromePath: testChromePath,
      cdpPort: port,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flowUrlLocale: null,
      detectedEmail: `${id}@example.com`,
      notes: '',
      ...extra,
    };
  }

  function saveConfig(config: ProfileConfig): void {
    const profileDir = path.join(tempDir, 'FlowProfiles', config.profileId);
    fs.mkdirSync(profileDir, { recursive: true });
    fs.mkdirSync(config.userDataDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'profile.json'), JSON.stringify(config, null, 2), 'utf-8');
  }

  function createMockProc(pid: number) {
    const proc = new EventEmitter() as any;
    proc.pid = pid;
    proc.killed = false;
    proc.exitCode = null;
    proc.kill = vi.fn((sig?: string) => {
      proc.killed = true;
      proc.exitCode = 0;
      proc.emit('exit', 0, sig || 'SIGTERM');
      return true;
    });
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }

  beforeEach(() => {
    mockSpawnCalls.length = 0;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-verify-test-'));
    originalLocalAppData = process.env['LOCALAPPDATA'];
    originalFlowAppData = process.env['FLOW_APPDATA_DIR'];
    process.env['LOCALAPPDATA'] = tempDir;
    process.env['FLOW_APPDATA_DIR'] = tempDir;
    ProfileConfigManager.setCustomProfilesRootDir(path.join(tempDir, 'FlowProfiles'));

    testChromePath = path.join(tempDir, process.platform === 'win32' ? 'chrome.exe' : 'Google Chrome');
    fs.writeFileSync(testChromePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    ProfileConfigManager.setCustomProfilesRootDir(null);
    if (originalLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = originalLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (originalFlowAppData !== undefined) {
      process.env['FLOW_APPDATA_DIR'] = originalFlowAppData;
    } else {
      delete process.env['FLOW_APPDATA_DIR'];
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Successful first-time connection closes ONLY its owned visible Chrome process
  it('Requirement 1: successful first-time connection closes ONLY its owned visible Chrome process', async () => {
    const config = makeConfig('prof_1', 19222);
    const session = new ProfileSession(config);

    const mockProc = createMockProc(12345);
    (session as any).chromeProcess = mockProc;
    (session as any)._status = 'browser_open';

    await session.closeLoginBrowser();

    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect((session as any).isAutoClosedAfterAuth).toBe(true);
    expect(session.status).toBe('ready');
  });

  // 2. Does not terminate another profile's Chrome process
  it('Requirement 2: does not terminate another profile\'s Chrome process', async () => {
    const configA = makeConfig('prof_a', 19222);
    const configB = makeConfig('prof_b', 19223);

    const sessionA = new ProfileSession(configA);
    const sessionB = new ProfileSession(configB);

    const mockProcA = createMockProc(1001);
    const mockProcB = createMockProc(1002);

    (sessionA as any).chromeProcess = mockProcA;
    (sessionB as any).chromeProcess = mockProcB;

    await sessionA.closeLoginBrowser();

    expect(mockProcA.kill).toHaveBeenCalled();
    expect(mockProcB.kill).not.toHaveBeenCalled();
    expect(mockProcB.killed).toBe(false);
  });

  // 3. Does not terminate personal Chrome
  it('Requirement 3: does not terminate personal Chrome or any non-owned process', async () => {
    const config = makeConfig('prof_personal', 19222);
    const session = new ProfileSession(config);

    const personalPid = 99999;
    const processKillSpy = vi.spyOn(process, 'kill');

    const mockProc = createMockProc(4321);
    (session as any).chromeProcess = mockProc;

    await session.closeLoginBrowser();

    // Verify process.kill was never called targeting personalPid
    expect(processKillSpy).not.toHaveBeenCalledWith(personalPid, expect.anything());
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  // 4. Existing account Verify uses background verification mode
  it('Requirement 4: existing account Verify uses background verification mode', async () => {
    const config = makeConfig('prof_verify_bg', 19225);
    saveConfig(config);
    const manager = new ProfileSessionManager();
    const session = new ProfileSession(config);
    (manager as any).sessions.set(config.profileId, session);

    const verifyBgSpy = vi.spyOn(session, 'verifyAuthBackground').mockResolvedValue({
      state: 'authenticated',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: 'prof_verify_bg@example.com',
      locale: null,
      pagesCount: 1,
      flowPageFound: true,
    });

    const res = await manager.verifyAccount('prof_verify_bg');

    expect(verifyBgSpy).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.status).toBe('ready');
  });

  // 5. Verify does not launch visible Chrome (headless: true, --headless=new)
  it('Requirement 5: Verify does not launch visible Chrome', async () => {
    const config = makeConfig('prof_headless_check', 19226);
    const session = new ProfileSession(config);

    vi.spyOn(session as any, 'waitForCdpPort').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'connectPlaywright').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'checkAuth').mockResolvedValue({
      state: 'authenticated',
      detectedEmail: 'user@example.com',
    });

    await session.start({ mode: 'background_verify', headless: true, background: true });

    expect(mockSpawnCalls.length).toBeGreaterThan(0);
    const lastCall = mockSpawnCalls[mockSpawnCalls.length - 1];
    expect(lastCall.args).toContain('--headless=new');
    expect(lastCall.args).not.toContain('--window-position=100,100');
  });

  // 6. Background verification uses exact canonical profile path
  it('Requirement 6: background verification uses exact canonical profile path', async () => {
    const config = makeConfig('prof_canonical_dir', 19227);
    const session = new ProfileSession(config);

    vi.spyOn(session as any, 'waitForCdpPort').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'connectPlaywright').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'checkAuth').mockResolvedValue({ state: 'authenticated' });

    await session.start({ mode: 'background_verify', headless: true, background: true });

    expect(mockSpawnCalls.length).toBeGreaterThan(0);
    const lastCall = mockSpawnCalls[mockSpawnCalls.length - 1];
    expect(lastCall.args).toContain(`--user-data-dir=${config.userDataDir}`);
  });

  // 7. Background verification uses exact assigned CDP port
  it('Requirement 7: background verification uses exact assigned CDP port', async () => {
    const config = makeConfig('prof_cdp_port', 19228);
    const session = new ProfileSession(config);

    vi.spyOn(session as any, 'waitForCdpPort').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'connectPlaywright').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'checkAuth').mockResolvedValue({ state: 'authenticated' });

    await session.start({ mode: 'background_verify', headless: true, background: true });

    expect(mockSpawnCalls.length).toBeGreaterThan(0);
    const lastCall = mockSpawnCalls[mockSpawnCalls.length - 1];
    expect(lastCall.args).toContain(`--remote-debugging-port=${config.cdpPort}`);
  });

  // 8. Profile-1 cannot attach to profile-10
  it('Requirement 8: profile-1 cannot attach to profile-10 port', async () => {
    const config1 = makeConfig('prof_1', 19222);
    const config10 = makeConfig('prof_10', 19231);

    expect(config1.cdpPort).not.toBe(config10.cdpPort);

    const probeSpy = vi.spyOn(LocalChromeProfileDiscoverer as any, 'probePort').mockImplementation(async (port: number) => {
      // Simulate profile-10's port being active
      return port === 19231;
    });

    // profile-1 only probes its own preferred port 19222
    const res = await LocalChromeProfileDiscoverer.findActiveCdpEndpoint(19222);
    expect(res).toBeNull();
    expect(probeSpy).toHaveBeenCalledWith(19222);
    expect(probeSpy).not.toHaveBeenCalledWith(19231);
  });

  // 9. One account cannot attach to another account's CDP
  it('Requirement 9: one account cannot attach to another account\'s CDP', async () => {
    const configA = makeConfig('prof_account_a', 19230);
    const sessionA = new ProfileSession(configA);

    // If an existing Chrome check returns a port belonging to a different profile (19231)
    vi.spyOn(LocalChromeProfileDiscoverer, 'detectProfileState').mockResolvedValue({
      state: 'open_and_attachable',
      profileDirectory: 'Default',
      cdpPort: 19231, // Foreign port!
    });

    const launchSpy = vi.spyOn(sessionA as any, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(sessionA as any, 'connectPlaywright').mockResolvedValue(undefined);
    vi.spyOn(sessionA as any, 'checkAuth').mockResolvedValue({ state: 'authenticated' });

    (sessionA as any).config.connectionMode = 'existing_chrome';

    await sessionA.start({ mode: 'background_verify', headless: true, background: true });

    // Must NOT attach to foreign port 19231; must fall back to launching dedicated Chrome with 19230
    expect(launchSpy).toHaveBeenCalled();
  });

  // 10. Successful Verify -> Connected
  it('Requirement 10: successful Verify transitions to Connected (ready)', async () => {
    const config = makeConfig('prof_success', 19232);
    saveConfig(config);
    const manager = new ProfileSessionManager();
    const session = new ProfileSession(config);
    (manager as any).sessions.set(config.profileId, session);

    vi.spyOn(session, 'verifyAuthBackground').mockResolvedValue({
      state: 'authenticated',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: 'success@example.com',
      locale: null,
      pagesCount: 1,
      flowPageFound: true,
    });

    const res = await manager.verifyAccount('prof_success');
    expect(res.success).toBe(true);
    expect(res.status).toBe('ready');
    expect(res.detectedEmail).toBe('prof_success@example.com');
  });

  // 11. Expired auth -> Reconnect Required without automatically opening visible Chrome
  it('Requirement 11: expired auth -> Reconnect Required without opening visible Chrome', async () => {
    const config = makeConfig('prof_expired', 19233);
    saveConfig(config);
    const manager = new ProfileSessionManager();
    const session = new ProfileSession(config);
    (manager as any).sessions.set(config.profileId, session);

    vi.spyOn(session, 'verifyAuthBackground').mockResolvedValue({
      state: 'login_required',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: null,
      locale: null,
      pagesCount: 1,
      flowPageFound: false,
    });
    const launchLoginBrowserSpy = vi.spyOn(session, 'launchLoginBrowser');

    const res = await manager.verifyAccount('prof_expired');
    expect(res.success).toBe(false);
    expect(res.status).toBe('auth_required');
    expect(launchLoginBrowserSpy).not.toHaveBeenCalled();
  });

  // 12. Temporary verification error does not destroy session/account data
  it('Requirement 12: temporary verification error does not destroy session/account data', async () => {
    const config = makeConfig('prof_temp_err', 19234, { detectedEmail: 'keep_me@example.com' });
    saveConfig(config);
    const dummyCookie = path.join(config.userDataDir, 'Cookies');
    fs.writeFileSync(dummyCookie, 'SAVED_COOKIE_STATE');

    const manager = new ProfileSessionManager();
    const session = new ProfileSession(config);
    (manager as any).sessions.set(config.profileId, session);

    vi.spyOn(session, 'verifyAuthBackground').mockRejectedValue(new Error('ETIMEDOUT: Flow server unreachable'));

    const res = await manager.verifyAccount('prof_temp_err');
    expect(res.success).toBe(false);
    expect(res.error).toContain('ETIMEDOUT');
    // Account and cookie state are preserved
    expect(fs.existsSync(dummyCookie)).toBe(true);
    const reloaded = ProfileConfigManager.read('prof_temp_err');
    expect(reloaded.detectedEmail).toBe('keep_me@example.com');
  });

  // 13. App startup triggers verification for previously connected accounts
  it('Requirement 13: app startup triggers verification for previously connected accounts', async () => {
    const config1 = makeConfig('prof_start_1', 19235);
    const config2 = makeConfig('prof_start_2', 19236);
    vi.spyOn(ProfileConfigManager, 'list').mockReturnValue([config1, config2]);

    const manager = new ProfileSessionManager();
    const startSpy = vi.spyOn(ProfileSession.prototype, 'start').mockResolvedValue(undefined);

    await manager.autoStartProfiles();

    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(startSpy).toHaveBeenCalledWith({ mode: 'background_verify', headless: true, background: true });
  });

  // 14. Startup verification respects concurrency/resource limit
  it('Requirement 14: startup verification respects concurrency limit (max 2)', async () => {
    const configs = [
      makeConfig('prof_c1', 19241),
      makeConfig('prof_c2', 19242),
      makeConfig('prof_c3', 19243),
      makeConfig('prof_c4', 19244),
    ];
    vi.spyOn(ProfileConfigManager, 'list').mockReturnValue(configs);

    const manager = new ProfileSessionManager();
    let currentConcurrent = 0;
    let maxConcurrent = 0;

    vi.spyOn(ProfileSession.prototype, 'start').mockImplementation(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      currentConcurrent--;
    });

    await manager.autoStartProfiles();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  // 15. New account login remains interactive/visible
  it('Requirement 15: new account login remains interactive and visible', async () => {
    const config = makeConfig('prof_new_login', 19245);
    const session = new ProfileSession(config);

    await session.launchLoginBrowser();
    session.stopPostLoginWatcher();

    expect(mockSpawnCalls.length).toBeGreaterThan(0);
    const lastCall = mockSpawnCalls[mockSpawnCalls.length - 1];
    // Visible Chrome: no --headless=new flag
    expect(lastCall.args).not.toContain('--headless=new');
    expect(session.status).toBe('browser_open');
  });

  // 16. Successful login shuts down its spawned visible Chrome
  it('Requirement 16: successful login shuts down its spawned visible Chrome', async () => {
    const config = makeConfig('prof_auto_close', 19246);
    const session = new ProfileSession(config);

    const mockProc = createMockProc(88888);
    (session as any).chromeProcess = mockProc;
    (session as any)._status = 'browser_open';

    const closeSpy = vi.spyOn(session, 'closeLoginBrowser');

    // Directly trigger closeLoginBrowser as done in watcher
    await session.closeLoginBrowser();

    expect(closeSpy).toHaveBeenCalled();
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(session.status).toBe('ready');
  });

  // 17. Add Account UI renders both professional choices
  it('Requirement 17: Add Account UI renders both professional choices', async () => {
    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      createProfile: vi.fn(),
      launchLoginBrowser: vi.fn(),
      detectLocalChromeProfiles: vi.fn().mockResolvedValue([]),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
    } as any;

    render(<ProfilesScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', { name: 'Add Flow Account' })).toBeDefined();
    expect(screen.getByText('Connect Existing Profile')).toBeDefined();
    expect(screen.getByText('Add New Account')).toBeDefined();
    expect(screen.getByText(/Use a Chrome profile that's already signed in/i)).toBeDefined();
    expect(screen.getByText(/Sign in with a new Google account using a dedicated Infinity Flow profile/i)).toBeDefined();
  });

  // 18. Existing profile action still calls the correct existing workflow
  it('Requirement 18: existing profile action triggers scan modal', async () => {
    const detectSpy = vi.fn().mockResolvedValue([]);
    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      createProfile: vi.fn(),
      launchLoginBrowser: vi.fn(),
      detectLocalChromeProfiles: detectSpy,
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
    } as any;

    render(<ProfilesScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('choice-connect-existing'));
      await Promise.resolve();
    });

    expect(detectSpy).toHaveBeenCalled();
  });

  // 19. New account action still calls the correct new-account workflow
  it('Requirement 19: new account action triggers createProfile and launchLoginBrowser', async () => {
    const createProfileSpy = vi.fn().mockResolvedValue({ profileId: 'new_prof_1' });
    const launchBrowserSpy = vi.fn().mockResolvedValue({ success: true, pid: 999 });

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      createProfile: createProfileSpy,
      launchLoginBrowser: launchBrowserSpy,
      detectLocalChromeProfiles: vi.fn().mockResolvedValue([]),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
    } as any;

    render(<ProfilesScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('choice-google-signin'));
      await Promise.resolve();
    });

    expect(createProfileSpy).toHaveBeenCalled();
    expect(launchBrowserSpy).toHaveBeenCalledWith('new_prof_1');
  });

  // 20. Windows tests/behavior remain intact
  it('Requirement 20: Windows tests and directory paths remain intact', () => {
    const rootDir = ProfileConfigManager.getProfilesRootDir();
    if (process.platform === 'win32') {
      expect(rootDir).toContain(path.join('AutomistLabs', 'FlowProfiles'));
    } else {
      expect(rootDir).toContain('FlowProfiles');
    }
  });

  // 21. Persisted 'ready' status does NOT skip startup verification on app restart
  it('Requirement 21: persisted ready status does NOT skip startup verification on fresh app start', async () => {
    const config = makeConfig('profile_persisted_ready', 19250);
    saveConfig(config);
    vi.spyOn(ProfileConfigManager, 'list').mockReturnValue([config]);

    const manager = new ProfileSessionManager();
    // In fresh process, session is not verified yet
    const session = new ProfileSession(config);
    expect(session.isVerifiedInCurrentProcess).toBe(false);
    (manager as any).sessions.set(config.profileId, session);

    const startSpy = vi.spyOn(session, 'start').mockImplementation(async () => {
      session.isVerifiedInCurrentProcess = true;
    });

    await manager.autoStartProfiles();

    // Must be queued and started despite any previous persisted status
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(session.isVerifiedInCurrentProcess).toBe(true);
  });

  // 22. Selecting Connect Existing Profile automatically starts interactive flow if auth required
  it('Requirement 22: Connect Existing Profile automatically starts interactive login if auth required', async () => {
    const createExistingSpy = vi.fn().mockResolvedValue({
      profileId: 'existing_prof_1',
      displayName: 'Existing User',
    });
    // First verify returns auth_required
    const verifyAccountSpy = vi.fn().mockResolvedValue({
      success: false,
      status: 'auth_required',
    });
    const launchBrowserSpy = vi.fn().mockResolvedValue({ success: true, pid: 9991 });

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      detectLocalChromeProfiles: vi.fn().mockResolvedValue([
        {
          profileDirectory: 'Profile 1',
          accountDisplayName: 'Existing User',
          accountEmail: 'existing@example.com',
          profileDisplayName: 'Profile 1',
          sourceUserDataDir: '/mock/Chrome',
          inUse: false,
        },
      ]),
      createExistingProfile: createExistingSpy,
      verifyAccount: verifyAccountSpy,
      launchLoginBrowser: launchBrowserSpy,
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
    } as any;

    render(<ProfilesScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    // 1. Click Add Flow Account
    const addBtns = screen.getAllByRole('button', { name: /Add Flow Account/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
      await Promise.resolve();
    });

    // 2. Select Connect Existing Profile
    await act(async () => {
      fireEvent.click(screen.getByTestId('choice-connect-existing'));
      await Promise.resolve();
    });

    // 3. Confirm profile in modal
    const importSubmitBtn = screen.getByRole('button', { name: /Connect Profile/i });
    await act(async () => {
      fireEvent.click(importSubmitBtn);
      await Promise.resolve();
    });

    // Should create profile, attempt verify, and immediately launch login browser without separate click
    expect(createExistingSpy).toHaveBeenCalledWith({
      displayName: 'Existing User',
      localProfileDirectory: 'Profile 1',
      expectedEmail: 'existing@example.com',
    });
    expect(verifyAccountSpy).toHaveBeenCalledWith('existing_prof_1');
    expect(launchBrowserSpy).toHaveBeenCalledWith('existing_prof_1');
  });

  // 23. Select All and Verify Selected behavior in UI
  it('Requirement 23: Select All selects all cards and Verify Selected skips already connected accounts', async () => {
    const mockProfiles = [
      {
        profileId: 'p_conn',
        displayName: 'Connected Account',
        chromeProfileName: 'Default',
        cdpPort: 19222,
        status: 'ready' as const,
        enabled: true,
        detectedEmail: 'conn@example.com',
      },
      {
        profileId: 'p_need',
        displayName: 'Needs Auth Account',
        chromeProfileName: 'Profile 1',
        cdpPort: 19223,
        status: 'auth_required' as const,
        enabled: true,
      },
      {
        profileId: 'p_err',
        displayName: 'Error Account',
        chromeProfileName: 'Profile 2',
        cdpPort: 19224,
        status: 'connection_error' as const,
        enabled: true,
      },
    ];

    const verifySelectedSpy = vi.fn().mockResolvedValue(undefined);

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue(mockProfiles),
      verifySelectedProfiles: verifySelectedSpy,
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
    } as any;

    render(<ProfilesScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    // Bulk action bar should be visible
    expect(screen.getByTestId('bulk-action-bar')).toBeDefined();

    // Click Select All
    const selectAllCheckbox = screen.getByTestId('select-all-checkbox');
    await act(async () => {
      fireEvent.click(selectAllCheckbox);
      await Promise.resolve();
    });

    // Check count badge: 3 selected
    expect(screen.getByTestId('selected-count-badge')).toBeDefined();
    expect(screen.getByTestId('selected-count-badge').textContent).toContain('3 of 3 selected');

    // Click Verify Selected
    const verifySelectedBtn = screen.getByTestId('verify-selected-btn');
    await act(async () => {
      fireEvent.click(verifySelectedBtn);
      await Promise.resolve();
    });

    // Should call verifySelectedProfiles with ONLY the eligible profiles ('p_need', 'p_err')
    expect(verifySelectedSpy).toHaveBeenCalledWith(['p_need', 'p_err']);
  });

  // 24. Explicit Reconnect opens visible login browser
  it('Requirement 24: explicit Reconnect opens visible login browser', async () => {
    const mockProfiles = [
      {
        profileId: 'p_reconn',
        displayName: 'Expired Account',
        chromeProfileName: 'Default',
        cdpPort: 19222,
        status: 'auth_required' as const,
        enabled: true,
      },
    ];

    const launchBrowserSpy = vi.fn().mockResolvedValue({ success: true, message: 'Browser launched' });

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue(mockProfiles),
      launchLoginBrowser: launchBrowserSpy,
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
    } as any;

    render(<ProfilesScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    const reconnectBtn = screen.getByTestId('reconnect-btn-p_reconn');
    await act(async () => {
      fireEvent.click(reconnectBtn);
      await Promise.resolve();
    });

    expect(launchBrowserSpy).toHaveBeenCalledWith('p_reconn');
  });

  // 25. Startup auto-verify does not deadlock with status starting collision
  it('Requirement 25: startup auto-verify does not deadlock with status starting collision', async () => {
    const config1 = makeConfig('profile_startup_1', 19240);
    const config2 = makeConfig('profile_startup_2', 19241);
    saveConfig(config1);
    saveConfig(config2);

    const manager = new ProfileSessionManager();
    const session1 = new ProfileSession(config1);
    const session2 = new ProfileSession(config2);
    (manager as any).sessions.set(config1.profileId, session1);
    (manager as any).sessions.set(config2.profileId, session2);

    const verifySpy1 = vi.spyOn(session1, 'verifyAuthBackground').mockResolvedValue({
      state: 'authenticated',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: 'user1@example.com',
      locale: null,
      pagesCount: 1,
      flowPageFound: true,
    });
    const verifySpy2 = vi.spyOn(session2, 'verifyAuthBackground').mockResolvedValue({
      state: 'authenticated',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: 'user2@example.com',
      locale: null,
      pagesCount: 1,
      flowPageFound: true,
    });

    const results = await manager.verifyProfilesBackground(['profile_startup_1', 'profile_startup_2']);
    expect(results['profile_startup_1'].success).toBe(true);
    expect(results['profile_startup_1'].status).toBe('ready');
    expect(results['profile_startup_2'].success).toBe(true);
    expect(results['profile_startup_2'].status).toBe('ready');
    expect(verifySpy1).toHaveBeenCalled();
    expect(verifySpy2).toHaveBeenCalled();
  });

  // 26. In-flight verification deduplication reuses active promise without error
  it('Requirement 26: in-flight verification deduplication reuses active promise without error', async () => {
    const config = makeConfig('profile_inflight', 19242);
    saveConfig(config);

    const manager = new ProfileSessionManager();
    const session = new ProfileSession(config);
    (manager as any).sessions.set(config.profileId, session);

    let finishVerify: () => void = () => {};
    const pendingPromise = new Promise<any>((resolve) => {
      finishVerify = () => resolve({
        state: 'authenticated',
        url: 'https://labs.google/fx/en/tools/flow',
        detectedEmail: 'inflight@example.com',
        locale: null,
        pagesCount: 1,
        flowPageFound: true,
      });
    });

    const verifySpy = vi.spyOn(session, 'verifyAuthBackground').mockImplementation(() => pendingPromise);

    // Call 1: startup / initial verify
    const p1 = manager.verifyAccount('profile_inflight');
    // Call 2: concurrent manual verify
    const p2 = manager.verifyAccount('profile_inflight');

    // Both promises must be identical reference (in-flight deduplication)
    expect(p1).toBe(p2);

    finishVerify();
    const [res1, res2] = await Promise.all([p1, p2]);

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.status).toBe('ready');
    expect(res2.status).toBe('ready');
  });

  // 27. Verification failure clears isVerifying and sets connection_error instead of starting
  it('Requirement 27: verification failure clears isVerifying and sets connection_error instead of starting', async () => {
    const config = makeConfig('profile_fail_recovery', 19243);
    const session = new ProfileSession(config);
    session.on('error', () => {}); // Handle emitted error event

    vi.spyOn(session as any, 'waitForCdpPort').mockRejectedValue(new Error('CDP port failed to open'));
    vi.spyOn(session as any, 'killChrome').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'cleanupPlaywrightObjects').mockResolvedValue(undefined);

    await expect(session.verifyAuthBackground()).rejects.toThrow('CDP port failed to open');

    expect(session.isVerifying).toBe(false);
    expect(session.status).not.toBe('starting');
    expect(session.status).toBe('connection_error');
  });

  // 28. Stale persisted transient status recovers to stopped on dead process
  it('Requirement 28: stale persisted transient status recovers to stopped on dead process', async () => {
    const config = makeConfig('profile_stale', 19244);
    saveConfig(config);

    const manager = new ProfileSessionManager();
    const session = new ProfileSession(config);
    (session as any)._status = 'starting'; // Stale transient status
    (manager as any).sessions.set(config.profileId, session);

    expect(session.isProcessAlive()).toBe(false);

    const snapshots = manager.getAllProfiles();
    const snap = snapshots.find((s) => s.profileId === 'profile_stale');
    expect(snap).toBeDefined();
    expect(snap?.status).toBe('stopped');
    expect(session.status).toBe('stopped');
  });

  // 29. Profile seeding copies auth session data and strictly excludes disposable caches
  it('Requirement 29: profile seeding copies auth session data and strictly excludes disposable caches', () => {
    const srcUserData = path.join(tempDir, 'FakeChromeUser');
    const srcProfile = path.join(srcUserData, 'Default');
    const dstUserData = path.join(tempDir, 'TargetUserData');

    fs.mkdirSync(path.join(srcProfile, 'Local Storage', 'leveldb'), { recursive: true });
    fs.mkdirSync(path.join(srcProfile, 'IndexedDB', 'test.indexeddb.leveldb'), { recursive: true });
    fs.mkdirSync(path.join(srcProfile, 'Cache', 'Cache_Data'), { recursive: true });
    fs.mkdirSync(path.join(srcProfile, 'Code Cache', 'js'), { recursive: true });
    fs.mkdirSync(path.join(srcProfile, 'GPUCache'), { recursive: true });

    fs.writeFileSync(path.join(srcUserData, 'Local State'), '{"os_crypt":{}}', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'Preferences'), '{"profile":{}}', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'Cookies'), 'fake-cookie-binary-data', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'Local Storage', 'leveldb', '000001.ldb'), 'storage-data', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'IndexedDB', 'test.indexeddb.leveldb', '000001.ldb'), 'idb-data', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'Cache', 'Cache_Data', 'f_000001'), 'disposable-cache-bytes', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'Code Cache', 'js', '000001'), 'compiled-js-cache', 'utf-8');
    fs.writeFileSync(path.join(srcProfile, 'GPUCache', 'data_0'), 'gpu-cache', 'utf-8');

    LocalChromeProfileDiscoverer.seedDedicatedUserDataDir(srcUserData, 'Default', dstUserData);

    const dstProfile = path.join(dstUserData, 'Default');
    // Auth files MUST be copied
    expect(fs.existsSync(path.join(dstUserData, 'Local State'))).toBe(true);
    expect(fs.existsSync(path.join(dstProfile, 'Preferences'))).toBe(true);
    expect(fs.existsSync(path.join(dstProfile, 'Cookies'))).toBe(true);
    expect(fs.existsSync(path.join(dstProfile, 'Local Storage', 'leveldb', '000001.ldb'))).toBe(true);
    expect(fs.existsSync(path.join(dstProfile, 'IndexedDB', 'test.indexeddb.leveldb', '000001.ldb'))).toBe(true);

    // Heavy disposable caches MUST be excluded
    expect(fs.existsSync(path.join(dstProfile, 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(dstProfile, 'Code Cache'))).toBe(false);
    expect(fs.existsSync(path.join(dstProfile, 'GPUCache'))).toBe(false);
  });

  // 30. connectExistingChromeProfile fast path executes headless verification first without visible Chrome
  it('Requirement 30: connectExistingChromeProfile fast path executes headless verification first without visible Chrome', async () => {
    const manager = new ProfileSessionManager();
    const progressStages: string[] = [];

    vi.spyOn(ProfileSession.prototype, 'verifyAuthBackground').mockResolvedValue({
      state: 'authenticated',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: 'fastpath@example.com',
      locale: 'en',
      pagesCount: 1,
      flowPageFound: true,
    });
    const launchLoginSpy = vi.spyOn(ProfileSession.prototype, 'launchLoginBrowser').mockResolvedValue({
      pid: 99999,
      cdpPort: 19800,
      userDataDir: '/tmp/test',
    });

    const res = await manager.connectExistingChromeProfile(
      {
        displayName: 'Fast Path Account',
        localProfileDirectory: 'Default',
      },
      (p) => progressStages.push(p.stage)
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('ready');
    expect(res.detectedEmail).toBe('fastpath@example.com');
    expect(launchLoginSpy).not.toHaveBeenCalled(); // ZERO visible Chrome window launched!
  });

  // 31. connectExistingChromeProfile emits all 5 stages in order
  it('Requirement 31: connectExistingChromeProfile emits all 5 stages in order', async () => {
    const manager = new ProfileSessionManager();
    const emittedStages: string[] = [];

    vi.spyOn(ProfileSession.prototype, 'verifyAuthBackground').mockResolvedValue({
      state: 'authenticated',
      url: 'https://labs.google/fx/en/tools/flow',
      detectedEmail: 'stages@example.com',
      locale: null,
      pagesCount: 1,
      flowPageFound: true,
    });

    manager.on('profile:connection_progress', (p) => {
      if (!emittedStages.includes(p.stage)) {
        emittedStages.push(p.stage);
      }
    });

    await manager.connectExistingChromeProfile({
      displayName: 'Stages Test',
      localProfileDirectory: 'Default',
    });

    expect(emittedStages).toEqual([
      'preparing',
      'copying_session',
      'checking_auth',
      'connecting_flow',
      'finalizing',
      'success',
    ]);
  });

  // 32. connectExistingChromeProfile falls back to visible login Chrome when auth is required
  it('Requirement 32: connectExistingChromeProfile falls back to visible login Chrome when auth is required', async () => {
    const manager = new ProfileSessionManager();
    const stages: string[] = [];

    vi.spyOn(ProfileSession.prototype, 'verifyAuthBackground').mockResolvedValue({
      state: 'login_required',
      url: 'https://accounts.google.com/signin',
      detectedEmail: null,
      locale: null,
      pagesCount: 1,
      flowPageFound: false,
    });
    const launchLoginSpy = vi.spyOn(ProfileSession.prototype, 'launchLoginBrowser').mockResolvedValue({
      pid: 77777,
      cdpPort: 19801,
      userDataDir: '/tmp/test',
    });

    const res = await manager.connectExistingChromeProfile(
      {
        displayName: 'Interactive Signin',
        localProfileDirectory: 'Default',
      },
      (p) => stages.push(p.stage)
    );

    expect(res.success).toBe(false);
    expect(res.requiresInteraction).toBe(true);
    expect(launchLoginSpy).toHaveBeenCalledTimes(1); // Visible Chrome opened for sign-in!
    expect(stages).toContain('auth_required');
    expect(stages).toContain('waiting_for_user');
  });

  // 33. cancelConnection safely stops only owned process and removes in-flight record
  it('Requirement 33: cancelConnection safely stops only owned process and cleans in-flight record', async () => {
    const manager = new ProfileSessionManager();
    const config = makeConfig('profile_to_cancel', 19250);
    saveConfig(config);

    const session = new ProfileSession(config);
    const mockProc = createMockProc(55555);
    (session as any).chromeProcess = mockProc;
    (session as any)._status = 'browser_open';
    (manager as any).sessions.set(config.profileId, session);

    const closeLoginSpy = vi.spyOn(session, 'closeLoginBrowser').mockResolvedValue();
    const stopSpy = vi.spyOn(session, 'stop').mockResolvedValue();

    let cancelEmitted = false;
    manager.on('profile:connection_progress', (p) => {
      if (p.stage === 'cancelled' && p.profileId === config.profileId) {
        cancelEmitted = true;
      }
    });

    await manager.cancelConnection(config.profileId);

    expect(closeLoginSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    expect(cancelEmitted).toBe(true);
  });

  // 34. UI renders event-driven Live Connection Progress modal with progress bar and checkmarks
  it('Requirement 34: UI renders event-driven Live Connection Progress modal with progress bar and checkmarks', async () => {
    let progressCallback: ((prog: any) => void) | null = null;
    let cancelCalledWith: string | null = null;

    const mockApi = {
      listProfiles: vi.fn().mockResolvedValue([]),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
      detectLocalChromeProfiles: vi.fn().mockResolvedValue([
        {
          profileDirectory: 'Default',
          profileDisplayName: 'Personal',
          accountDisplayName: 'Personal User',
          accountEmail: 'user@example.com',
          isOpen: false,
          isAttachable: false,
        },
      ]),
      connectExistingProfile: vi.fn().mockImplementation(async () => {
        progressCallback?.({
          profileId: 'prof_test_1',
          stage: 'connecting_flow',
          message: 'Connecting to Google Flow in background...',
          progress: 70,
          displayName: 'Test Account',
        });
        return {
          success: true,
          profileId: 'prof_test_1',
          status: 'ready',
          detectedEmail: 'user@example.com',
        };
      }),
      cancelConnection: vi.fn().mockImplementation(async (id: string) => {
        cancelCalledWith = id;
      }),
      onProfileConnectionProgress: vi.fn().mockImplementation((cb: (prog: any) => void) => {
        progressCallback = cb;
        return () => {};
      }),
    };

    (window as any).flowApi = mockApi;

    render(<ProfilesScreen />);

    // Open Add Flow Account choice modal
    await act(async () => {
      fireEvent.click(screen.getByText('Add Flow Account'));
    });

    // Choose Connect Existing Profile
    await act(async () => {
      fireEvent.click(screen.getByText('Connect Existing Profile'));
    });

    // Modal opens with Connect Profile submit button
    expect(screen.getByText(/Connect Existing Chrome Profile/i)).toBeDefined();
    const connectBtn = screen.getByRole('button', { name: /connect profile/i });

    // Submit form to begin connection
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    // Event-driven live connection progress modal MUST be rendered
    expect(screen.getByText('Preparing profile')).toBeDefined();
    expect(screen.getByText('Copying account session')).toBeDefined();
    expect(screen.getByText('Checking existing login')).toBeDefined();
    expect(screen.getByText('Connecting to Google Flow')).toBeDefined();
    // Verify success banner and Done button
    expect(screen.getByText('Connected successfully ✓')).toBeDefined();
    expect(screen.getByText('Authenticated as user@example.com')).toBeDefined();
    const doneBtn = screen.getByRole('button', { name: /done/i });
    expect(doneBtn).toBeDefined();
  });

  it('Requirement 35: startup verification fast-path skips redundant reseeding if profile is already seeded', async () => {
    const config = makeConfig('prof_reseed_check', 9811, {
      connectionMode: 'existing_chrome',
      localUserDataDir: path.join(tempDir, 'User Data'),
      localProfileDirectory: 'Default',
    });
    ProfileConfigManager.create(config);

    // Create seeded directory markers
    fs.mkdirSync(path.join(config.userDataDir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(config.userDataDir, 'Default', 'Preferences'), '{}', 'utf-8');

    const seedSpy = vi.spyOn(LocalChromeProfileDiscoverer, 'seedDedicatedUserDataDir');

    const session = new ProfileSession(config);
    vi.spyOn(session as any, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'connectPlaywright').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'checkAuth').mockImplementation(async () => {
      (session as any).setStatus('ready');
      return { state: 'authenticated', url: 'https://flow.google.com', detectedEmail: 'user@example.com', locale: null };
    });

    await session.start({ mode: 'background_verify', headless: true, background: true });

    // Seed method MUST NOT be called because profile was already seeded
    expect(seedSpy).not.toHaveBeenCalled();
    seedSpy.mockRestore();
  });

  it('Requirement 36: FLOW_BASE_URL targets flow.google.com to avoid unnecessary HTTP redirects', async () => {
    const { FLOW_BASE_URL } = await import('../main/engine/ProfileSession');
    expect(FLOW_BASE_URL).toBe('https://flow.google.com');
  });

  it('Requirement 37: navigateAndCheck reactively polls and returns immediately when authenticated without 2s sleep', async () => {
    const { FlowAuthDetector } = await import('../main/engine/FlowAuthDetector');

    const mockPage = {
      url: vi.fn().mockReturnValue('https://flow.google.com'),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockImplementation((fn: any) => {
        const fnStr = fn.toString();
        if (fnStr.includes('new-project')) return true;
        return false;
      }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as any;

    const t0 = Date.now();
    const result = await FlowAuthDetector.navigateAndCheck(mockPage, 'https://flow.google.com', 'test_perf');
    const elapsed = Date.now() - t0;

    expect(result.state).toBe('authenticated');
    // Fast path: does not block for 2000ms
    expect(elapsed).toBeLessThan(1000);
  });
});
