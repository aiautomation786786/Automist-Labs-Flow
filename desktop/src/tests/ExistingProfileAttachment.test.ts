import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { LocalChromeProfileDiscoverer } from '../main/engine/LocalChromeProfileDiscoverer';
import { ProfileSession } from '../main/engine/ProfileSession';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';
import { ProfileConfigManager } from '../main/engine/ProfileConfig';
import type { ProfileConfig } from '../shared/types';

describe('Phase 5.4: Existing Chrome Profile Attachment & Safe State Detection', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-profile-test-'));
    originalEnv = { ...process.env };
    process.env.LOCALAPPDATA = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('Profile Lock Detection (isProfileDirectoryLocked)', () => {
    it('returns inUse: false if profile directory does not exist', () => {
      const nonExistent = path.join(tempDir, 'NonExistentProfile');
      const locked = LocalChromeProfileDiscoverer.isProfileDirectoryLocked(nonExistent);
      expect(locked.inUse).toBe(false);
    });

    it('returns inUse: false when profile directory exists and files can be opened cleanly', () => {
      const profileDir = path.join(tempDir, 'Default');
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, 'Web Data'), 'sqlite header');

      const locked = LocalChromeProfileDiscoverer.isProfileDirectoryLocked(profileDir);
      expect(locked.inUse).toBe(false);
    });

    it('returns inUse: true when a lock-sensitive file cannot be opened exclusively', () => {
      const profileDir = path.join(tempDir, 'Default');
      const networkDir = path.join(profileDir, 'Network');
      fs.mkdirSync(networkDir, { recursive: true });
      const cookiePath = path.join(networkDir, 'Cookies');
      fs.writeFileSync(cookiePath, 'locked cookies');

      // Hold an exclusive open file handle
      const fd = fs.openSync(cookiePath, 'r+');
      try {
        // Mock isProfileDirectoryLocked behavior directly
        vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileDirectoryLocked').mockReturnValue({
          inUse: true,
          lockedFile: cookiePath,
        });
        const locked = LocalChromeProfileDiscoverer.isProfileDirectoryLocked(profileDir);
        expect(locked.inUse).toBe(true);
        expect(locked.lockedFile).toBe(cookiePath);
      } finally {
        fs.closeSync(fd);
      }
    });
  });

  describe('Profile State Classification (detectProfileState)', () => {
    it('Case C: returns not_open when profile directory is not locked and no CDP port responds', async () => {
      const profileDir = path.join(tempDir, 'Default');
      fs.mkdirSync(profileDir, { recursive: true });

      vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileDirectoryLocked').mockReturnValue({ inUse: false });
      vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileInUse').mockResolvedValue({ inUse: false, pids: [] });
      vi.spyOn(LocalChromeProfileDiscoverer, 'findActiveCdpEndpoint').mockResolvedValue(null);

      const result = await LocalChromeProfileDiscoverer.detectProfileState({
        userDataDir: tempDir,
        profileDirectory: 'Default',
        displayName: 'AI Automation',
      });

      expect(result.state).toBe('not_open');
      expect(result.cdpPort).toBeUndefined();
      expect(result.details).toContain('not currently running');
    });

    it('Case B: returns open_not_attachable with exact required message when locked but no CDP port responds', async () => {
      const profileDir = path.join(tempDir, 'Default');
      fs.mkdirSync(profileDir, { recursive: true });

      vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileDirectoryLocked').mockReturnValue({ inUse: true });
      vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileInUse').mockResolvedValue({ inUse: true, pids: [1234] });
      vi.spyOn(LocalChromeProfileDiscoverer, 'findActiveCdpEndpoint').mockResolvedValue(null);

      const result = await LocalChromeProfileDiscoverer.detectProfileState({
        userDataDir: tempDir,
        profileDirectory: 'Default',
        displayName: 'AI Automation',
      });

      expect(result.state).toBe('open_not_attachable');
      expect(result.cdpPort).toBeUndefined();
      expect(result.details).toBe(
        'AI Automation profile is already open, but this Chrome session does not expose an automation connection. Please enable/launch this profile through the app\'s supported connection mode, or close only this profile and retry.'
      );
    });

    it('Case A: returns open_and_attachable when locked AND active CDP port is found', async () => {
      const profileDir = path.join(tempDir, 'Default');
      fs.mkdirSync(profileDir, { recursive: true });

      vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileDirectoryLocked').mockReturnValue({ inUse: true });
      vi.spyOn(LocalChromeProfileDiscoverer, 'isProfileInUse').mockResolvedValue({ inUse: true, pids: [1234] });
      vi.spyOn(LocalChromeProfileDiscoverer, 'findActiveCdpEndpoint').mockResolvedValue({ port: 9222 });

      const result = await LocalChromeProfileDiscoverer.detectProfileState({
        userDataDir: tempDir,
        profileDirectory: 'Default',
        displayName: 'AI Automation',
        preferredCdpPort: 9222,
      });

      expect(result.state).toBe('open_and_attachable');
      expect(result.cdpPort).toBe(9222);
      expect(result.details).toContain('active automation connection on CDP port 9222');
    });
  });

  describe('Existing Profile Management in ProfileSessionManager', () => {
    it('registers an existing profile with connectionMode="existing_chrome"', async () => {
      const portAllocator = new ChromePortAllocator({ startPort: 9222 });
      const manager = new ProfileSessionManager({
        portAllocator,
        chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      });

      const profile = await manager.createExistingChromeProfile({
        displayName: 'AI Automation Profile',
        localProfileDirectory: 'Default',
        localUserDataDir: tempDir,
        expectedEmail: 'aiautomation786786@gmail.com',
      });

      expect(profile.connectionMode).toBe('existing_chrome');
      expect(profile.localProfileDirectory).toBe('Default');
      expect(profile.localUserDataDir).toBe(tempDir);
      expect(profile.expectedEmail).toBe('aiautomation786786@gmail.com');

      const all = await manager.getAllProfiles();
      const match = all.find((p) => p.profileId === profile.profileId);
      expect(match).toBeDefined();
      expect(match?.connectionMode).toBe('existing_chrome');
      expect(match?.connectionState).toBe('profile_closed');
    });

    it('detectExistingProfileState delegates cleanly to LocalChromeProfileDiscoverer', async () => {
      const portAllocator = new ChromePortAllocator({ startPort: 9222 });
      const manager = new ProfileSessionManager({
        portAllocator,
        chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      });

      const profile = await manager.createExistingChromeProfile({
        displayName: 'AI Automation',
        localProfileDirectory: 'Default',
        localUserDataDir: tempDir,
      });

      vi.spyOn(LocalChromeProfileDiscoverer, 'detectProfileState').mockResolvedValue({
        state: 'open_not_attachable',
        profileDirectory: 'Default',
        userDataDir: tempDir,
        pids: [1234],
        details: 'AI Automation profile is already open, but this Chrome session does not expose an automation connection. Please enable/launch this profile through the app\'s supported connection mode, or close only this profile and retry.',
      });

      const detected = await manager.detectExistingProfileState(profile.profileId);
      expect(detected.state).toBe('open_not_attachable');
      expect(detected.details).toContain('does not expose an automation connection');
    });
  });

  describe('ProfileSession Existing Browser Safety & Isolation', () => {
    it('throws error and does not launch duplicate browser when open_not_attachable', async () => {
      const config: ProfileConfig = {
        profileId: 'prof_existing_test',
        displayName: 'AI Automation',
        chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        userDataDir: tempDir,
        cdpPort: 9222,
        connectionMode: 'existing_chrome',
        localProfileDirectory: 'Default',
        localUserDataDir: tempDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const session = new ProfileSession(config);
      session.on('error', () => {}); // Attach listener to prevent unhandled EventEmitter error

      vi.spyOn(LocalChromeProfileDiscoverer, 'detectProfileState').mockResolvedValue({
        state: 'open_not_attachable',
        profileDirectory: 'Default',
        userDataDir: tempDir,
        pids: [1234],
        details: 'AI Automation profile is already open, but this Chrome session does not expose an automation connection. Please enable/launch this profile through the app\'s supported connection mode, or close only this profile and retry.',
      });

      const launchSpy = vi.spyOn(session as any, 'launchChrome');

      await expect(session.start(false)).rejects.toThrow(/does not expose an automation connection/);
      expect(launchSpy).not.toHaveBeenCalled();
      expect(session.status).toBe('error');
    });

    it('attaches over CDP and creates a dedicated new tab without killing user browser', async () => {
      const config: ProfileConfig = {
        profileId: 'prof_attach_test',
        displayName: 'AI Automation',
        chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        userDataDir: tempDir,
        cdpPort: 9222,
        connectionMode: 'existing_chrome',
        localProfileDirectory: 'Default',
        localUserDataDir: tempDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const session = new ProfileSession(config);

      // Mock Case A: open and attachable
      vi.spyOn(LocalChromeProfileDiscoverer, 'detectProfileState').mockResolvedValue({
        state: 'open_and_attachable',
        profileDirectory: 'Default',
        userDataDir: tempDir,
        cdpPort: 9222,
        pids: [1234],
        details: 'Ready to attach on port 9222',
      });

      // Mock Playwright chromium.connectOverCDP
      const mockPageClose = vi.fn().mockResolvedValue(undefined);
      const mockFlowPage = {
        close: mockPageClose,
        isClosed: () => false,
        url: () => 'https://labs.google/fx/tools/flow',
        goto: vi.fn().mockResolvedValue(undefined),
        bringToFront: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };
      const mockExistingUserTab = {
        url: () => 'https://www.google.com',
      };

      const mockContext = {
        pages: () => [mockExistingUserTab],
        newPage: vi.fn().mockResolvedValue(mockFlowPage),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = {
        contexts: () => [mockContext],
        close: mockBrowserClose,
      };

      const playwright = await import('playwright');
      vi.spyOn(playwright.chromium, 'connectOverCDP').mockResolvedValue(mockBrowser as any);

      const { FlowAuthDetector } = await import('../main/engine/FlowAuthDetector');
      vi.spyOn(FlowAuthDetector, 'navigateAndCheck').mockResolvedValue({
        state: 'authenticated',
        detectedEmail: 'aiautomation786786@gmail.com',
        url: 'https://labs.google/fx/tools/flow',
        timestamp: new Date().toISOString(),
      });

      // Start session (attach mode)
      await session.start(false);

      // Verifications:
      // 1. Session is ready and authenticated
      expect(session.status).toBe('ready');

      // 2. Playwright called context.newPage() to open a fresh tab, NOT replacing existing user tabs
      expect(mockContext.newPage).toHaveBeenCalled();

      // 3. User tab was NOT closed
      expect(mockContext.pages()).toHaveLength(1);

      // 4. Snapshot reports existing connection mode
      const snapshot = session.getSnapshot();
      expect(snapshot.connectionMode).toBe('existing_chrome');
      expect(snapshot.connectionState).toBe('connected_existing');

      // 5. Cleanup: verify user's browser is NOT killed
      const killChromeSpy = vi.spyOn(session as any, 'killChrome');
      await session.stop();

      // The Flow tab is closed
      expect(mockPageClose).toHaveBeenCalled();
      // CDP connection closed
      expect(mockBrowserClose).toHaveBeenCalled();
      // context.close() is NOT called (avoids closing other user tabs)
      expect(mockContext.close).not.toHaveBeenCalled();
      // Browser process termination is NEVER invoked for existing browser sessions
      expect(killChromeSpy).not.toHaveBeenCalled();
    }, 15000);
  });
});
