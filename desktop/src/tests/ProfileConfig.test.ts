/**
 * Tests for ProfileConfigManager.
 *
 * These tests exercise real filesystem I/O using a temporary directory
 * that is cleaned up after each test suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProfileConfig } from '../shared/types';

// ---------------------------------------------------------------------------
// Redirect AppLogger's getAppDataDir to a temp directory for all tests
// ---------------------------------------------------------------------------

// We must set LOCALAPPDATA before any module is imported so that AppLogger
// resolves the data directory to our temp path.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-'));
process.env['LOCALAPPDATA'] = tmpDir;

// Now import (after env is set)
import { ProfileConfigManager, getProfilesRootDir } from '../main/engine/ProfileConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeConfig(overrides: Partial<ProfileConfig> = {}): Partial<ProfileConfig> {
  return {
    displayName: 'Test Profile',
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    cdpPort: 9222,
    notes: 'automated test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ProfileConfigManager', () => {
  afterEach(() => {
    // Clean up all profiles created during the test
    const rootDir = getProfilesRootDir();
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('should create a profile with a unique ID', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Account A',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9222,
    });

    expect(config.profileId).toMatch(/^profile_[a-f0-9]{8}$/);
    expect(config.displayName).toBe('Account A');
    expect(config.cdpPort).toBe(9222);
    expect(config.enabled).toBe(true);
    expect(config.createdAt).toBeTruthy();
    expect(config.updatedAt).toBeTruthy();
  });

  it('should write profile.json to the correct directory', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Disk Test',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9223,
    });

    const expectedPath = path.join(
      getProfilesRootDir(),
      config.profileId,
      'profile.json'
    );
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('should create the chrome-user-data directory', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Data Dir Test',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9224,
    });

    expect(fs.existsSync(config.userDataDir)).toBe(true);
    expect(config.userDataDir).toContain('chrome-user-data');
  });

  it('should read a profile back from disk', () => {
    const created = ProfileConfigManager.create({
      displayName: 'Read Test',
      chromePath: 'C:\\fake\\chrome.exe',
      cdpPort: 9225,
    });

    const read = ProfileConfigManager.read(created.profileId);
    expect(read.profileId).toBe(created.profileId);
    expect(read.displayName).toBe('Read Test');
    expect(read.cdpPort).toBe(9225);
  });

  it('should throw when reading a non-existent profile', () => {
    expect(() => ProfileConfigManager.read('profile_00000000')).toThrow('not found');
  });

  it('should list all profiles from readAll()', () => {
    ProfileConfigManager.create({ displayName: 'A', chromePath: 'x', cdpPort: 9230 });
    ProfileConfigManager.create({ displayName: 'B', chromePath: 'x', cdpPort: 9231 });
    ProfileConfigManager.create({ displayName: 'C', chromePath: 'x', cdpPort: 9232 });

    const all = ProfileConfigManager.readAll();
    expect(all.length).toBe(3);
  });

  it('readAll should return [] if profiles directory does not exist', () => {
    // Remove the profiles dir (afterEach will also do this, but test it explicitly)
    const rootDir = getProfilesRootDir();
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
    expect(ProfileConfigManager.readAll()).toEqual([]);
  });

  it('should update a profile and bump updatedAt', async () => {
    const created = ProfileConfigManager.create({
      displayName: 'Update Test',
      chromePath: 'x',
      cdpPort: 9233,
    });

    // Brief pause to ensure updatedAt timestamp differs
    await new Promise((r) => setTimeout(r, 5));

    const updated = ProfileConfigManager.update(created.profileId, {
      displayName: 'Updated Name',
      detectedEmail: 'test@gmail.com',
    });

    expect(updated.displayName).toBe('Updated Name');
    expect(updated.detectedEmail).toBe('test@gmail.com');
    expect(updated.profileId).toBe(created.profileId);
    expect(updated.createdAt).toBe(created.createdAt); // Should not change
    expect(updated.updatedAt).not.toBe(created.updatedAt); // Should change
  });

  it('should delete a profile and its directory', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Delete Test',
      chromePath: 'x',
      cdpPort: 9234,
    });

    const profileDir = path.join(getProfilesRootDir(), config.profileId);
    expect(fs.existsSync(profileDir)).toBe(true);

    ProfileConfigManager.delete(config.profileId);
    expect(fs.existsSync(profileDir)).toBe(false);
  });

  it('exists() should return true for a created profile and false after deletion', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Exists Test',
      chromePath: 'x',
      cdpPort: 9235,
    });

    expect(ProfileConfigManager.exists(config.profileId)).toBe(true);
    ProfileConfigManager.delete(config.profileId);
    expect(ProfileConfigManager.exists(config.profileId)).toBe(false);
  });

  it('two profiles should have independent directories', () => {
    const a = ProfileConfigManager.create({ displayName: 'A', chromePath: 'x', cdpPort: 9236 });
    const b = ProfileConfigManager.create({ displayName: 'B', chromePath: 'x', cdpPort: 9237 });

    expect(a.profileId).not.toBe(b.profileId);
    expect(a.userDataDir).not.toBe(b.userDataDir);
  });

  it('should store notes field correctly', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Notes Test',
      chromePath: 'x',
      cdpPort: 9238,
      notes: 'My marketing account',
    });

    const read = ProfileConfigManager.read(config.profileId);
    expect(read.notes).toBe('My marketing account');
  });

  it('default chromeProfileName should be "Default"', () => {
    const config = ProfileConfigManager.create({
      displayName: 'Profile Name Test',
      chromePath: 'x',
      cdpPort: 9239,
    });
    expect(config.chromeProfileName).toBe('Default');
  });
});
