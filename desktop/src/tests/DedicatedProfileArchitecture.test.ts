import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileConfigManager } from '../main/engine/ProfileConfig';
import { ProfileSession } from '../main/engine/ProfileSession';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';
import { WindowsChromeFinder } from '../main/engine/WindowsChromeFinder';
import type { ProfileConfig } from '../shared/types';

describe('Phase 5.3: Dedicated Profile Architecture & Multi-Account Isolation', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let testChromePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-profile-test-'));
    originalEnv = { ...process.env };
    process.env.LOCALAPPDATA = tempDir;
    process.env.FLOW_APPDATA_DIR = tempDir;

    const discovered = WindowsChromeFinder.find().executablePath;
    if (discovered && fs.existsSync(discovered)) {
      testChromePath = discovered;
    } else {
      testChromePath = path.join(tempDir, process.platform === 'win32' ? 'chrome.exe' : 'Google Chrome');
      fs.writeFileSync(testChromePath, '');
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('Requirement 1 & 5: dedicated persistent directories under FlowProfiles and unique CDP ports', async () => {
    const rootDir = ProfileConfigManager.getProfilesRootDir();
    const expectedRoot = process.platform === 'win32'
      ? path.join(tempDir, 'AutomistLabs', 'FlowProfiles')
      : path.join(tempDir, 'FlowProfiles');
    expect(rootDir).toBe(expectedRoot);

    const portAllocator = new ChromePortAllocator({ portStart: 19222, portEnd: 19350 });
    const p1Port = await portAllocator.allocate('profile-1');
    const p2Port = await portAllocator.allocate('profile-2');

    expect(p1Port).toBe(19222);
    expect(p2Port).toBe(19223);

    const config1 = ProfileConfigManager.create({
      displayName: 'Flow Profile A',
      chromePath: testChromePath,
      cdpPort: p1Port,
      expectedEmail: 'flow.worker1@gmail.com',
    });

    const config2 = ProfileConfigManager.create({
      displayName: 'Flow Profile B',
      chromePath: testChromePath,
      cdpPort: p2Port,
      expectedEmail: 'flow.worker2@gmail.com',
    });

    // Verify completely separate isolated directory paths
    const expectedSubdir = process.platform === 'win32'
      ? path.join('AutomistLabs', 'FlowProfiles')
      : 'FlowProfiles';
    expect(config1.userDataDir).toContain(path.join(expectedSubdir, config1.profileId, 'chrome-user-data'));
    expect(config2.userDataDir).toContain(path.join(expectedSubdir, config2.profileId, 'chrome-user-data'));
    expect(config1.userDataDir).not.toBe(config2.userDataDir);

    // Verify they NEVER point to default Chrome user data
    expect(config1.userDataDir).not.toContain(path.join('Google', 'Chrome', 'User Data'));
    expect(config2.userDataDir).not.toContain(path.join('Google', 'Chrome', 'User Data'));

    // Verify expectedEmail is persisted
    const reloaded1 = ProfileConfigManager.read(config1.profileId);
    expect(reloaded1.expectedEmail).toBe('flow.worker1@gmail.com');
    expect(reloaded1.cdpPort).toBe(p1Port);

    const reloaded2 = ProfileConfigManager.read(config2.profileId);
    expect(reloaded2.expectedEmail).toBe('flow.worker2@gmail.com');
    expect(reloaded2.cdpPort).toBe(p2Port);
  });

  it('Requirement 4: strictly zero password, cookie, or token storage in profile config schema', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Security Check Profile',
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      cdpPort: 9222,
    });

    const configKeys = Object.keys(config);
    expect(configKeys).not.toContain('password');
    expect(configKeys).not.toContain('passwords');
    expect(configKeys).not.toContain('cookie');
    expect(configKeys).not.toContain('cookies');
    expect(configKeys).not.toContain('token');
    expect(configKeys).not.toContain('authToken');
    expect(configKeys).not.toContain('credentials');
  });

  it('Requirement 2: Process Safety - killChrome strictly uses non-recursive termination without /T or /IM', async () => {
    const sessionFileContent = fs.readFileSync(
      path.join(__dirname, '../main/engine/ProfileSession.ts'),
      'utf-8'
    );

    // Verify taskkill does NOT use /T (recursive tree kill)
    expect(sessionFileContent).not.toMatch(/taskkill[^\n]*\/T/i);

    // Verify taskkill does NOT use /IM (image name kill which kills all chromes)
    expect(sessionFileContent).not.toMatch(/taskkill[^\n]*\/IM/i);

    // Verify killChrome strictly targets specific proc.pid non-recursively
    expect(sessionFileContent).toContain('taskkill /pid ${proc.pid} /F');
  });

  it('Requirement 3: No NTFS junctions pointing to user normal Chrome directory', () => {
    const discovererContent = fs.readFileSync(
      path.join(__dirname, '../main/engine/LocalChromeProfileDiscoverer.ts'),
      'utf-8'
    );

    expect(discovererContent).not.toContain('ensureUserDataJunction');
    expect(discovererContent).not.toContain('FlowUserDataLink');
    expect(discovererContent).not.toContain('ItemType Junction');
  });

  it('Requirement 7: Concurrent Profile Management and Independence', async () => {
    const portAllocator = new ChromePortAllocator({ startPort: 9230 });
    const manager = new ProfileSessionManager({
      portAllocator,
      chromePath: testChromePath,
    });

    const p1 = await manager.createProfile({
      displayName: 'Independent Alpha',
      expectedEmail: 'alpha@flow.internal',
    });

    const p2 = await manager.createProfile({
      displayName: 'Independent Beta',
      expectedEmail: 'beta@flow.internal',
    });

    const all = manager.getAllProfiles();
    expect(all.length).toBe(2);

    const snapshot1 = all.find((s) => s.profileId === p1.profileId);
    const snapshot2 = all.find((s) => s.profileId === p2.profileId);

    expect(snapshot1).toBeDefined();
    expect(snapshot2).toBeDefined();
    expect(snapshot1?.expectedEmail).toBe('alpha@flow.internal');
    expect(snapshot2?.expectedEmail).toBe('beta@flow.internal');
    expect(snapshot1?.cdpPort).not.toBe(snapshot2?.cdpPort);

    // Stopping or deleting p1 has zero effect on p2
    await manager.deleteProfile(p1.profileId);

    const afterDelete = manager.getAllProfiles();
    expect(afterDelete.length).toBe(1);
    expect(afterDelete[0].profileId).toBe(p2.profileId);
    expect(afterDelete[0].displayName).toBe('Independent Beta');
  });
});
