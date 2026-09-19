/**
 * FlowAccountLifecycleRecovery.test.ts
 *
 * Comprehensive regression tests verifying stable Flow Account & Chrome profile lifecycle:
 *
 * 1. Same Google email cannot create duplicate canonical profiles unintentionally.
 * 2. Same canonical profile cannot run two browser sessions.
 * 3. Preferred CDP port never falls back to another profile's port.
 * 4. Profile A cannot attach to Profile B's CDP endpoint.
 * 5. Verify Account reuses an existing healthy browser.
 * 6. Startup verification does not create duplicate browser instances.
 * 7. Duplicate/stale runtime records do not create duplicate UI cards.
 * 8. Restart preserves the canonical profile list and ports.
 * 9. ZSocial remains absent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileConfigManager } from '../main/engine/ProfileConfig';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ProfileSession } from '../main/engine/ProfileSession';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';
import { LocalChromeProfileDiscoverer } from '../main/engine/LocalChromeProfileDiscoverer';
import type { ProfileConfig } from '../shared/types';

vi.mock('../main/engine/WindowsChromeFinder', () => ({
  WindowsChromeFinder: {
    find: vi.fn(() => ({
      recommended: { path: 'C:\\fake\\chrome.exe', source: 'program_files', verified: true },
      all: [],
    })),
    findOrThrow: vi.fn(() => 'C:\\fake\\chrome.exe'),
    verifyPath: vi.fn(() => true),
  },
}));

describe('Flow Account Lifecycle Recovery & Isolation', () => {
  let tempDir: string;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-recovery-test-'));
    originalLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tempDir;
    ProfileConfigManager.setCustomProfilesRootDir(path.join(tempDir, 'AutomistLabs', 'FlowProfiles'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ProfileConfigManager.setCustomProfilesRootDir(null);
    if (originalLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = originalLocalAppData;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // 1. Same Google email cannot create duplicate canonical profiles unintentionally
  // -------------------------------------------------------------------------
  it('1. Same Google email cannot create duplicate canonical profiles unintentionally', async () => {
    const portAllocator = new ChromePortAllocator({ portStart: 19222, portEnd: 19230 });
    const manager = new ProfileSessionManager({
      portAllocator,
      chromePath: 'C:\\fake\\chrome.exe',
    });

    vi.spyOn(manager as any, 'startProfile').mockResolvedValue(undefined);

    const first = await manager.createProfile({
      displayName: 'Test Account',
      expectedEmail: 'test.account@gmail.com',
    });

    const second = await manager.createProfile({
      displayName: 'Test Account Duplicate Attempt',
      expectedEmail: 'test.account@gmail.com',
    });

    expect(first.profileId).toBe(second.profileId);
    expect(second.cdpPort).toBe(first.cdpPort);

    const all = ProfileConfigManager.list();
    expect(all.length).toBe(1);
    expect(all[0].profileId).toBe(first.profileId);
  });

  // -------------------------------------------------------------------------
  // 2. Same canonical profile cannot run two browser sessions
  // -------------------------------------------------------------------------
  it('2. Same canonical profile cannot run two browser sessions concurrently', async () => {
    const config: ProfileConfig = {
      profileId: 'profile_single_session',
      displayName: 'Single Session Account',
      userDataDir: path.join(tempDir, 'user_data'),
      chromeProfileName: 'Default',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 19222,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flowUrlLocale: null,
      detectedEmail: 'user@example.com',
      expectedEmail: 'user@example.com',
      notes: '',
    };

    const session = new ProfileSession(config);

    let launchCount = 0;
    vi.spyOn(session as any, 'launchChrome').mockImplementation(async () => {
      launchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    vi.spyOn(session as any, 'connectPlaywright').mockResolvedValue(undefined);
    vi.spyOn(session as any, 'checkAuth').mockResolvedValue(undefined);

    // Concurrently trigger start twice
    await Promise.all([
      session.start({ headless: false, background: true }),
      session.start({ headless: false, background: true }),
    ]);

    expect(launchCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3. Preferred CDP port never falls back to another profile's port
  // -------------------------------------------------------------------------
  it("3. Preferred CDP port never falls back to another profile's port", async () => {
    const probedPorts: number[] = [];
    vi.spyOn(LocalChromeProfileDiscoverer as any, 'probePort').mockImplementation(async (port: number) => {
      probedPorts.push(port);
      return port === 9222; // Port 9222 is active on machine
    });

    // Profile has preferred port 9224
    const result = await LocalChromeProfileDiscoverer.findActiveCdpEndpoint(9224);

    expect(result).toBeNull();
    expect(probedPorts).toContain(9224);
    expect(probedPorts).not.toContain(9222);
  });

  // -------------------------------------------------------------------------
  // 4. Profile A cannot attach to Profile B's CDP endpoint
  // -------------------------------------------------------------------------
  it("4. Profile A cannot attach to Profile B's CDP endpoint", async () => {
    const configA: ProfileConfig = {
      profileId: 'profile_a',
      displayName: 'Profile A',
      userDataDir: path.join(tempDir, 'user_data_a'),
      chromeProfileName: 'Default',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9224, // Profile A is on 9224
      connectionMode: 'existing_chrome',
      localProfileDirectory: 'Profile 1',
      localUserDataDir: tempDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sessionA = new ProfileSession(configA);

    // Simulate Profile B running on 9222
    vi.spyOn(LocalChromeProfileDiscoverer, 'detectProfileState').mockResolvedValue({
      state: 'open_and_attachable',
      profileDirectory: 'Profile 1',
      userDataDir: tempDir,
      cdpPort: 9222, // Foreign port
    });

    const connectSpy = vi.spyOn(sessionA as any, 'connectPlaywright').mockResolvedValue(undefined);
    const launchSpy = vi.spyOn(sessionA as any, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(sessionA as any, 'checkAuth').mockResolvedValue(undefined);
    vi.spyOn(LocalChromeProfileDiscoverer, 'seedDedicatedUserDataDir').mockReturnValue(true);

    await sessionA.start(false);

    // Session A should NOT attach to 9222; it must preserve its port 9224 and launch its own dedicated instance
    expect(sessionA.config.cdpPort).toBe(9224);
    expect(launchSpy).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Verify Account reuses an existing healthy browser
  // -------------------------------------------------------------------------
  it('5. Verify Account reuses an existing healthy browser', async () => {
    const portAllocator = new ChromePortAllocator({ portStart: 19222, portEnd: 19230 });
    const manager = new ProfileSessionManager({
      portAllocator,
      chromePath: 'C:\\fake\\chrome.exe',
    });

    const config = await manager.createProfile({
      displayName: 'Healthy Browser Account',
      expectedEmail: 'healthy@gmail.com',
    });

    let session = manager.getSession(config.profileId);
    if (!session) {
      session = new ProfileSession(config);
      (manager as any).sessions.set(config.profileId, session);
    }

    // Mark process alive
    vi.spyOn(session, 'isProcessAlive').mockReturnValue(true);
    const launchSpy = vi.spyOn(session as any, 'launchChrome');
    vi.spyOn(session, 'verifyAuth').mockResolvedValue({
      state: 'authenticated',
      detectedEmail: 'healthy@gmail.com',
      url: 'https://labs.google/fx/en/tools/flow',
      locale: 'en',
      pagesCount: 1,
      flowPageFound: true,
    });
    vi.spyOn(session, 'hideWindowFromTaskbar').mockResolvedValue(undefined);

    const result = await manager.verifyAccount(config.profileId);

    expect(result.success).toBe(true);
    expect(result.detectedEmail).toBe('healthy@gmail.com');
    // Crucial: no new Chrome process was spawned
    expect(launchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. Startup verification does not create duplicate browser instances
  // -------------------------------------------------------------------------
  it('6. Startup verification does not create duplicate browser instances', async () => {
    const portAllocator = new ChromePortAllocator({ portStart: 19222, portEnd: 19230 });
    const manager = new ProfileSessionManager({
      portAllocator,
      chromePath: 'C:\\fake\\chrome.exe',
    });

    // Create 1 existing_chrome profile (not active) and 1 authenticated dedicated profile
    const p1 = await manager.createExistingChromeProfile({
      displayName: 'Existing Chrome Personal',
      localProfileDirectory: 'Profile 1',
      preferredCdpPort: 19223,
    });

    const p2 = await manager.createProfile({
      displayName: 'Dedicated Flow Account',
      expectedEmail: 'auth.dedicated@gmail.com',
    });

    // Spy on ProfileSession.prototype.start
    const startedProfiles: string[] = [];
    vi.spyOn(ProfileSession.prototype, 'start').mockImplementation(async function (this: ProfileSession) {
      startedProfiles.push(this.profileId);
    });

    await manager.autoStartProfiles();

    // Existing chrome should NOT be started if not open
    expect(startedProfiles).not.toContain(p1.profileId);
    // Dedicated authenticated profile should be started exactly once in background
    expect(startedProfiles.filter((id) => id === p2.profileId).length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 7. Duplicate/stale runtime records do not create duplicate UI cards
  // -------------------------------------------------------------------------
  it('7. Duplicate/stale runtime records do not create duplicate UI cards', async () => {
    const portAllocator = new ChromePortAllocator({ portStart: 19222, portEnd: 19230 });
    const manager = new ProfileSessionManager({
      portAllocator,
      chromePath: 'C:\\fake\\chrome.exe',
    });

    // Create canonical authenticated profile
    const canonical = await manager.createProfile({
      displayName: 'Canonical Account',
      expectedEmail: 'canonical@gmail.com',
    });

    // Create an unauthenticated stub directory simulating duplicate creation
    const stubDir = path.join(tempDir, 'AutomistLabs', 'FlowProfiles', 'profile_stub999');
    fs.mkdirSync(stubDir, { recursive: true });
    const stubConfig: ProfileConfig = {
      profileId: 'profile_stub999',
      displayName: 'Canonical Account',
      userDataDir: path.join(stubDir, 'chrome-user-data'),
      chromeProfileName: 'Default',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 19230,
      enabled: true,
      createdAt: new Date(Date.now() + 1000).toISOString(),
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      flowUrlLocale: null,
      detectedEmail: null,
      expectedEmail: null,
      notes: '',
    };
    fs.writeFileSync(path.join(stubDir, 'profile.json'), JSON.stringify(stubConfig, null, 2), 'utf-8');

    // getAllProfiles should return only the canonical account card
    const cards = manager.getAllProfiles();
    expect(cards.length).toBe(1);
    expect(cards[0].profileId).toBe(canonical.profileId);
    expect(cards[0].cdpPort).toBe(canonical.cdpPort);
  });

  // -------------------------------------------------------------------------
  // 8. Restart preserves the canonical profile list and ports
  // -------------------------------------------------------------------------
  it('8. Restart preserves the canonical profile list and ports', async () => {
    const portAllocator1 = new ChromePortAllocator({ portStart: 9222, portEnd: 9230 });
    const manager1 = new ProfileSessionManager({
      portAllocator: portAllocator1,
      chromePath: 'C:\\fake\\chrome.exe',
    });

    // Create 6 canonical accounts mimicking real setup
    const acc1 = await manager1.createProfile({ displayName: 'AI Automation', expectedEmail: 'aiautomation786786@gmail.com' });
    const acc2 = await manager1.createProfile({ displayName: 'The Automist', expectedEmail: 'theautomist@gmail.com' });
    const acc3 = await manager1.createProfile({ displayName: 'Mello Yello', expectedEmail: 'melloyello723@gmail.com' });
    const acc4 = await manager1.createProfile({ displayName: 'Ali', expectedEmail: 'aliasadawan21@gmail.com' });
    const acc5 = await manager1.createProfile({ displayName: 'Heidi Mason', expectedEmail: 'heidimason761@gmail.com' });
    const acc6 = await manager1.createProfile({ displayName: 'SyncFrame Studio', expectedEmail: 'support.syncframe@gmail.com' });

    expect(acc1.cdpPort).toBe(9222);
    expect(acc2.cdpPort).toBe(9223);
    expect(acc3.cdpPort).toBe(9224);
    expect(acc4.cdpPort).toBe(9225);
    expect(acc5.cdpPort).toBe(9226);
    expect(acc6.cdpPort).toBe(9227);

    // Simulate restart by initializing a new ProfileSessionManager
    const portAllocator2 = new ChromePortAllocator({ portStart: 9222, portEnd: 9230 });
    const manager2 = new ProfileSessionManager({
      portAllocator: portAllocator2,
      chromePath: 'C:\\fake\\chrome.exe',
    });

    const restartedProfiles = manager2.getAllProfiles();
    expect(restartedProfiles.length).toBe(6);

    const portMap = new Map(restartedProfiles.map((p) => [p.displayName, p.cdpPort]));
    expect(portMap.get('AI Automation')).toBe(9222);
    expect(portMap.get('The Automist')).toBe(9223);
    expect(portMap.get('Mello Yello')).toBe(9224);
    expect(portMap.get('Ali')).toBe(9225);
    expect(portMap.get('Heidi Mason')).toBe(9226);
    expect(portMap.get('SyncFrame Studio')).toBe(9227);
  });

  // -------------------------------------------------------------------------
  // 9. ZSocial remains absent
  // -------------------------------------------------------------------------
  it('9. ZSocial remains completely absent from codebase', () => {
    const srcDir = path.resolve(__dirname, '..');
    const checkDir = (dir: string): string[] => {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'release' || e.name === '.git') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          files.push(...checkDir(full));
        } else if (e.name.toLowerCase().includes('zsocial') || e.name.toLowerCase().includes('watchedfolder')) {
          files.push(full);
        }
      }
      return files;
    };

    const violations = checkDir(srcDir);
    expect(violations).toEqual([]);
  });
});
