/**
 * Tests for ProfileSessionManager.
 *
 * These tests exercise the manager's state machine and storage logic
 * WITHOUT launching real Chrome instances (unit-level).
 *
 * Tests that require real Chrome use .skip annotations with a TODO comment
 * explaining how to run them manually via the manual-test.mjs script.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Redirect app data to a temp directory
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-mgr-test-'));
process.env['LOCALAPPDATA'] = tmpDir;

import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ProfileConfigManager, getProfilesRootDir } from '../main/engine/ProfileConfig';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';
import { WindowsChromeFinder } from '../main/engine/WindowsChromeFinder';

// ---------------------------------------------------------------------------
// Mock Chrome finder so tests don't need real Chrome installed
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helper: build a manager with a test-specific port allocator
// ---------------------------------------------------------------------------

function buildManager(): ProfileSessionManager {
  const allocator = new ChromePortAllocator({ portStart: 28222, portEnd: 28280 });
  return new ProfileSessionManager({
    portAllocator: allocator,
    chromePath: 'C:\\fake\\chrome.exe',
  });
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

function cleanupProfiles(): void {
  const rootDir = getProfilesRootDir();
  if (fs.existsSync(rootDir)) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProfileSessionManager — unit tests (no Chrome)', () => {
  let manager: ProfileSessionManager;

  beforeEach(() => {
    manager = buildManager();
  });

  afterEach(() => {
    cleanupProfiles();
  });

  // SCENARIO 1: Profile creation
  it('should create a profile with valid config', async () => {
    const config = await manager.createProfile({ displayName: 'Account Alpha' });

    expect(config.profileId).toMatch(/^profile_/);
    expect(config.displayName).toBe('Account Alpha');
    expect(config.cdpPort).toBeGreaterThanOrEqual(28222);
    expect(config.chromePath).toBe('C:\\fake\\chrome.exe');
  });

  // SCENARIO 2: Profile appears in getAllProfiles()
  it('getAllProfiles should list created profiles', async () => {
    await manager.createProfile({ displayName: 'Profile 1' });
    await manager.createProfile({ displayName: 'Profile 2' });

    const profiles = manager.getAllProfiles();
    expect(profiles.length).toBe(2);
    expect(profiles.map((p) => p.displayName)).toContain('Profile 1');
    expect(profiles.map((p) => p.displayName)).toContain('Profile 2');
  });

  // SCENARIO 3: Inactive profiles show status='stopped'
  it('profiles without active sessions should appear as stopped', async () => {
    await manager.createProfile({ displayName: 'Inactive' });
    const profiles = manager.getAllProfiles();
    expect(profiles[0]?.status).toBe('stopped');
  });

  // SCENARIO 4: getSession returns null for profiles not yet started
  it('getSession should return null for an unstarted profile', async () => {
    const config = await manager.createProfile({ displayName: 'Unstarted' });
    expect(manager.getSession(config.profileId)).toBeNull();
  });

  // SCENARIO 5: Two profiles get different ports
  it('two created profiles should receive different CDP ports', async () => {
    const a = await manager.createProfile({ displayName: 'Port A' });
    const b = await manager.createProfile({ displayName: 'Port B' });
    expect(a.cdpPort).not.toBe(b.cdpPort);
  });

  // SCENARIO 6: Profile deletion removes from disk
  it('deleteProfile should remove the profile from disk', async () => {
    const config = await manager.createProfile({ displayName: 'To Delete' });
    expect(ProfileConfigManager.exists(config.profileId)).toBe(true);

    await manager.deleteProfile(config.profileId);
    expect(ProfileConfigManager.exists(config.profileId)).toBe(false);
  });

  // SCENARIO 7: After deletion, getAllProfiles should not list the deleted profile
  it('getAllProfiles should not list deleted profiles', async () => {
    const a = await manager.createProfile({ displayName: 'Keep' });
    const b = await manager.createProfile({ displayName: 'Remove' });

    await manager.deleteProfile(b.profileId);
    const profiles = manager.getAllProfiles();

    expect(profiles.length).toBe(1);
    expect(profiles[0]?.profileId).toBe(a.profileId);
  });

  // SCENARIO 8: 'profile:created' event fires on creation
  it('should emit profile:created event when a profile is created', async () => {
    const events: string[] = [];
    manager.on('profile:created', (config) => events.push(config.profileId));

    const config = await manager.createProfile({ displayName: 'Event Test' });
    expect(events).toContain(config.profileId);
  });

  // SCENARIO 9: 'profile:deleted' event fires on deletion
  it('should emit profile:deleted event when a profile is deleted', async () => {
    const deleted: string[] = [];
    manager.on('profile:deleted', (id) => deleted.push(id));

    const config = await manager.createProfile({ displayName: 'Delete Event' });
    await manager.deleteProfile(config.profileId);

    expect(deleted).toContain(config.profileId);
  });

  // SCENARIO 10: activeCount is 0 when no sessions are running
  it('activeCount should be 0 with no running sessions', async () => {
    await manager.createProfile({ displayName: 'Counter Test' });
    expect(manager.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NOTE: Integration tests requiring real Chrome
// ---------------------------------------------------------------------------
// Run manually via: node scripts/manual-test.mjs
//
// Covered scenarios:
//  - Launch two real Chrome instances on different ports
//  - Confirm both CDP ports respond
//  - Confirm Playwright connects to each independently
//  - Navigate to Flow in both, confirm independent pages
//  - Shut both down cleanly
// ---------------------------------------------------------------------------
