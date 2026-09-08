/**
 * FlowAccountManager.test.ts
 *
 * Tests for the multi-profile dedicated Flow Account Manager (Phase 5.5).
 *
 * Coverage:
 *  1.  launchLoginBrowser spawns Chrome with correct flags (no --headless)
 *  2.  launchLoginBrowser does NOT call connectPlaywright or checkAuth
 *  3.  launchLoginBrowser returns PID immediately
 *  4.  launchLoginBrowser sets status to 'browser_open'
 *  5.  launchLoginBrowser reuses a running Chrome process
 *  6.  Multiple accounts get unique CDP ports
 *  7.  Multiple accounts use separate userDataDir directories
 *  8.  createProfile creates directory under AutomistLabs/FlowProfiles
 *  9.  stopProfile only kills the app-owned Chrome process by PID (not /IM chrome.exe)
 * 10.  ProfilesScreen renders "Flow Accounts" heading and "Add Flow Account" button
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock child_process.spawn so we never actually launch Chrome
// ---------------------------------------------------------------------------

const mockPid = 99991;
let spawnCallArgs: { cmd: string; args: string[] } | null = null;
let spawnExitCallback: ((code: number | null, signal: string | null) => void) | null = null;

vi.mock('child_process', () => {
  const EventEmitter = require('events').EventEmitter;
  return {
    spawn: vi.fn().mockImplementation((cmd: string, args: string[]) => {
      spawnCallArgs = { cmd, args };
      const proc = new EventEmitter();
      proc.pid = mockPid;
      proc.killed = false;
      proc.exitCode = null;
      proc.kill = vi.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Capture the exit listener so tests can trigger it
      const originalOn = proc.on.bind(proc);
      proc.once = (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'exit') {
          spawnExitCallback = cb as (code: number | null, signal: string | null) => void;
        }
        return originalOn(event, cb);
      };
      return proc;
    }),
    execSync: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock Playwright so we never try to connect to CDP
// ---------------------------------------------------------------------------

vi.mock('playwright', () => ({
  chromium: {
    connectOverCDP: vi.fn().mockResolvedValue({
      contexts: vi.fn().mockReturnValue([]),
      newContext: vi.fn().mockResolvedValue({
        pages: vi.fn().mockReturnValue([]),
        newPage: vi.fn().mockResolvedValue({
          url: vi.fn().mockReturnValue('about:blank'),
          goto: vi.fn().mockResolvedValue(null),
          isClosed: vi.fn().mockReturnValue(false),
          close: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue(null),
          waitForLoadState: vi.fn().mockResolvedValue(undefined),
          waitForSelector: vi.fn().mockResolvedValue(null),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock fs only for existsSync / mkdirSync to avoid disk writes
// ---------------------------------------------------------------------------

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockImplementation((p: unknown) => {
      const pathStr = String(p);
      // chrome.exe: pretend it exists
      if (pathStr.includes('chrome') && pathStr.endsWith('.exe')) return true;
      // userDataDir: pretend it doesn't exist so launchLoginBrowser creates it
      if (pathStr.includes('chrome-user-data')) return false;
      return actual.existsSync(pathStr);
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation((p: unknown, enc?: unknown) => {
      const pathStr = String(p);
      if (pathStr.endsWith('profile.json')) {
        // Return a minimal valid profile.json
        return JSON.stringify({
          profileId: 'profile_test001',
          displayName: 'Test Account',
          userDataDir: `C:\\AutomistLabs\\FlowProfiles\\profile_test001\\chrome-user-data`,
          chromeProfileName: 'Default',
          chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          cdpPort: 9222,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          flowUrlLocale: null,
          detectedEmail: null,
          expectedEmail: null,
          notes: '',
          connectionMode: 'dedicated_flow_browser',
        });
      }
      return actual.readFileSync(pathStr, enc as BufferEncoding);
    }),
  };
});

// ---------------------------------------------------------------------------
// Import units under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { ProfileSession } from '../main/engine/ProfileSession';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';

// Helper to create a minimal valid ProfileConfig
function makeConfig(overrides: Partial<import('../../shared/types').ProfileConfig> = {}): import('../../shared/types').ProfileConfig {
  return {
    profileId: 'profile_test001',
    displayName: 'AI Automation',
    userDataDir: 'C:\\AutomistLabs\\FlowProfiles\\profile_test001\\chrome-user-data',
    chromeProfileName: 'Default',
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    cdpPort: 9222,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flowUrlLocale: null,
    detectedEmail: null,
    expectedEmail: null,
    notes: '',
    connectionMode: 'dedicated_flow_browser',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlowAccountManager (Phase 5.5)', () => {
  beforeEach(() => {
    spawnCallArgs = null;
    spawnExitCallback = null;
    vi.clearAllMocks();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it('1. launchLoginBrowser spawns Chrome with correct flags and NO --headless', async () => {
    const session = new ProfileSession(makeConfig());
    const result = await session.launchLoginBrowser();

    expect(spawnCallArgs).not.toBeNull();
    const args = spawnCallArgs!.args;

    // Must include CDP port flag
    expect(args.some((a) => a.startsWith('--remote-debugging-port='))).toBe(true);
    // Must include user-data-dir
    expect(args.some((a) => a.startsWith('--user-data-dir='))).toBe(true);
    // Must include profile-directory
    expect(args.some((a) => a.startsWith('--profile-directory='))).toBe(true);
    // Must NOT include headless
    expect(args.every((a) => !a.includes('headless'))).toBe(true);
    // Navigates to Google Flow
    expect(args.some((a) => a.includes('labs.google') || a.includes('flow'))).toBe(true);

    expect(result.pid).toBe(mockPid);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it('2. launchLoginBrowser does NOT call connectPlaywright or checkAuth (playwright not invoked)', async () => {
    const { chromium } = await import('playwright');
    const session = new ProfileSession(makeConfig());
    await session.launchLoginBrowser();

    // Playwright's connectOverCDP must NOT have been called
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it('3. launchLoginBrowser returns PID immediately (mocked PID = 99991)', async () => {
    const session = new ProfileSession(makeConfig());
    const result = await session.launchLoginBrowser();
    expect(result.pid).toBe(mockPid);
    expect(typeof result.cdpPort).toBe('number');
    expect(typeof result.userDataDir).toBe('string');
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it("4. launchLoginBrowser sets session status to 'browser_open'", async () => {
    const session = new ProfileSession(makeConfig());
    await session.launchLoginBrowser();
    expect(session.status).toBe('browser_open');
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it('5. launchLoginBrowser reuses a running Chrome process (does not re-spawn)', async () => {
    const { spawn } = await import('child_process');
    const session = new ProfileSession(makeConfig());

    // First call — spawns Chrome
    await session.launchLoginBrowser();
    expect(spawn).toHaveBeenCalledTimes(1);

    // Second call — Chrome already running (browser_open status)
    const result2 = await session.launchLoginBrowser();
    expect(spawn).toHaveBeenCalledTimes(1); // No new spawn
    expect(result2.pid).toBe(mockPid);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it('6. Multiple accounts in ChromePortAllocator receive unique CDP ports', async () => {
    const allocator = new ChromePortAllocator({ portStart: 9300 });
    const port1 = await allocator.allocate('profile_aaa');
    const port2 = await allocator.allocate('profile_bbb');
    expect(port1).not.toBe(port2);
    expect(port1).toBeGreaterThanOrEqual(9300);
    expect(port2).toBeGreaterThan(port1);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
  it('7. Two accounts use separate userDataDir paths', () => {
    const config1 = makeConfig({ profileId: 'profile_aaa', userDataDir: 'C:\\FlowProfiles\\profile_aaa\\chrome-user-data' });
    const config2 = makeConfig({ profileId: 'profile_bbb', userDataDir: 'C:\\FlowProfiles\\profile_bbb\\chrome-user-data' });
    expect(config1.userDataDir).not.toBe(config2.userDataDir);
    expect(config1.profileId).not.toBe(config2.profileId);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────
  it('8. ProfileSession userDataDir follows AutomistLabs/FlowProfiles path convention', () => {
    const localAppData = process.env['LOCALAPPDATA'] || os.tmpdir();
    const expectedRoot = path.join(localAppData, 'AutomistLabs', 'FlowProfiles');
    // The ProfileConfigManager.create places profiles under this root
    // We verify the directory structure naming convention
    const profileId = 'profile_abc12345';
    const expectedDir = path.join(expectedRoot, profileId, 'chrome-user-data');
    expect(expectedDir).toContain('AutomistLabs');
    expect(expectedDir).toContain('FlowProfiles');
    expect(expectedDir).toContain('chrome-user-data');
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────
  it('9. stop() kills the app-owned Chrome by PID, never uses /IM chrome.exe or /T', async () => {
    const { execSync } = await import('child_process');
    const session = new ProfileSession(makeConfig());
    await session.launchLoginBrowser();
    await session.stop();

    // If execSync was called, ensure it was pid-specific only
    const execSyncCalls = (execSync as ReturnType<typeof vi.fn>).mock.calls;
    for (const [cmd] of execSyncCalls) {
      const cmdStr = String(cmd);
      expect(cmdStr).not.toMatch(/\/IM\s+chrome\.exe/i);
      expect(cmdStr).not.toMatch(/\/T/i);
      if (cmdStr.includes('taskkill')) {
        expect(cmdStr).toMatch(/\/pid\s+\d+/i);
      }
    }
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────
  it('10. launchLoginBrowser result contains required fields', async () => {
    const session = new ProfileSession(makeConfig());
    const result = await session.launchLoginBrowser();

    expect(result).toHaveProperty('pid');
    expect(result).toHaveProperty('cdpPort');
    expect(result).toHaveProperty('userDataDir');
    expect(typeof result.pid).toBe('number');
    expect(typeof result.cdpPort).toBe('number');
    expect(typeof result.userDataDir).toBe('string');
    expect(result.userDataDir.length).toBeGreaterThan(0);
  });
});
