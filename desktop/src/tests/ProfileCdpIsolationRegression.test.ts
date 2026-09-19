import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { LocalChromeProfileDiscoverer } from '../main/engine/LocalChromeProfileDiscoverer';
import { ProfileSession } from '../main/engine/ProfileSession';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ProfileConfigManager } from '../main/engine/ProfileConfig';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';
import type { ProfileConfig } from '../shared/types';

describe('Profile CDP Port Isolation Regression Tests', () => {
  let tempDir: string;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-profile-isolation-test-'));
    originalLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tempDir;
    vi.spyOn(ProfileConfigManager, 'getProfilesRootDir').mockReturnValue(path.join(tempDir, 'AutomistLabs', 'FlowProfiles'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = originalLocalAppData;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('findActiveCdpEndpoint probes ONLY preferredPort when specified, never falling back to 9222', async () => {
    // Simulate port 9222 being active on machine, but 9224 being closed
    const probeSpy = vi.spyOn(LocalChromeProfileDiscoverer as any, 'probePort').mockImplementation(async (port: number) => {
      if (port === 9222) return true;
      return false;
    });

    // Profile C has preferredCdpPort 9224
    const result = await LocalChromeProfileDiscoverer.findActiveCdpEndpoint(9224);

    expect(result).toBeNull();
    // Verify probePort was called for 9224, and was NEVER called for 9222
    expect(probeSpy).toHaveBeenCalledWith(9224);
    expect(probeSpy).not.toHaveBeenCalledWith(9222);
  });

  it('detectProfileState for an existing_chrome profile does not hijack an active port 9222', async () => {
    const profileDir = path.join(tempDir, 'Profile 1');
    fs.mkdirSync(profileDir, { recursive: true });

    // Personal Chrome is open (so locked/in-use is true for Chrome User Data)
    vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileDirectoryLocked').mockReturnValue({ inUse: true });
    vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileInUse').mockResolvedValue({ inUse: true, pids: [9999] });

    // Port 9222 is active (e.g. from another profile), but port 9224 is not
    vi.spyOn(LocalChromeProfileDiscoverer as any, 'probePort').mockImplementation(async (port: number) => {
      return port === 9222;
    });

    const result = await LocalChromeProfileDiscoverer.detectProfileState({
      userDataDir: tempDir,
      profileDirectory: 'Profile 1',
      displayName: 'Mello Yello',
      preferredCdpPort: 9224,
    });

    // It must NOT be open_and_attachable on 9222
    expect(result.state).toBe('open_not_attachable');
    expect(result.cdpPort).toBeUndefined();
  });

  it('ProfileSession.start does not overwrite its cdpPort with 9222 when 9222 is active elsewhere', async () => {
    const config: ProfileConfig = {
      profileId: 'prof_mello_yello',
      displayName: 'Mello Yello',
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      userDataDir: path.join(tempDir, 'userData_9224'),
      cdpPort: 9224,
      connectionMode: 'existing_chrome',
      localProfileDirectory: 'Profile 1',
      localUserDataDir: tempDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const session = new ProfileSession(config);

    // Mock detectProfileState returning state where 9222 was open from another session
    vi.spyOn(LocalChromeProfileDiscoverer, 'detectProfileState').mockResolvedValue({
      state: 'open_not_attachable',
      profileDirectory: 'Profile 1',
      userDataDir: tempDir,
      pids: [1234],
      details: 'Personal Chrome is open without automation on port 9224',
    });

    const seedSpy = vi.spyOn(LocalChromeProfileDiscoverer, 'seedDedicatedUserDataDir').mockReturnValue(true);
    const launchSpy = vi.spyOn(session as any, 'launchChrome').mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(session as any, 'connectPlaywright').mockResolvedValue(undefined);
    const authSpy = vi.spyOn(session as any, 'checkAuth').mockResolvedValue(undefined);

    await session.start(false);

    // ProfileSession must retain its allocated port 9224!
    expect(session.config.cdpPort).toBe(9224);
    expect(session.getSnapshot().cdpPort).toBe(9224);
    expect(seedSpy).toHaveBeenCalled();
    expect(launchSpy).toHaveBeenCalledWith(false, true);
  });

  it('Multiple configured accounts retain their unique isolated CDP ports across getAllProfiles', async () => {
    const portAllocator = new ChromePortAllocator({ startPort: 9222 });
    const manager = new ProfileSessionManager({
      portAllocator,
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });

    // Create 4 distinct profiles
    const profA = await manager.createProfile({ displayName: 'AI Automation' });
    const profB = await manager.createProfile({ displayName: 'The Automist' });
    const profC = await manager.createProfile({ displayName: 'Mello Yello' });
    const profD = await manager.createProfile({ displayName: 'Ali' });

    // Verify all 4 have unique, sequential CDP ports
    expect(profA.cdpPort).toBe(9222);
    expect(profB.cdpPort).toBe(9223);
    expect(profC.cdpPort).toBe(9224);
    expect(profD.cdpPort).toBe(9225);

    const all = manager.getAllProfiles();
    const ports = all.map((p) => p.cdpPort);
    expect(new Set(ports).size).toBe(4);
    expect(ports.sort()).toEqual([9222, 9223, 9224, 9225]);
  });
});
