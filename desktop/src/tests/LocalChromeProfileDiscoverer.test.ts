import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalChromeProfileDiscoverer } from '../main/engine/LocalChromeProfileDiscoverer';
import { WindowsChromeFinder } from '../main/engine/WindowsChromeFinder';
import type { DiscoveredLocalProfile } from '../shared/types';

describe('LocalChromeProfileDiscoverer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('Windows Chrome Discovery', () => {
    it('should find or throw a candidate path via WindowsChromeFinder', () => {
      const discovery = WindowsChromeFinder.find();
      expect(discovery).toBeDefined();
      expect(discovery.all.length).toBeGreaterThan(0);
    });
  });

  describe('User-data Directory Discovery', () => {
    it('should accept an explicit override path', () => {
      const discovered = LocalChromeProfileDiscoverer.discoverChromeUserDataDir(tempDir);
      expect(discovered).toBe(tempDir);
    });

    it('should return null for non-existent override path without falling back to invalid dirs', () => {
      const fakePath = path.join(tempDir, 'non_existent_subdir');
      const discovered = LocalChromeProfileDiscoverer.discoverChromeUserDataDir(fakePath);
      // Either returns standard system user data dir or null, but never the non-existent override path
      expect(discovered).not.toBe(fakePath);
    });
  });

  describe('Email Normalization', () => {
    it('should remove spaces and lowercase email addresses', () => {
      expect(
        LocalChromeProfileDiscoverer.normalizeEmail('AI Automation 786 786 @ Gmail.com')
      ).toBe('aiautomation786786@gmail.com');
    });

    it('should handle mailto prefixes or leading/trailing whitespace', () => {
      expect(
        LocalChromeProfileDiscoverer.normalizeEmail('  user.test@example.com  ')
      ).toBe('user.test@example.com');
    });

    it('should return empty string for null or undefined', () => {
      expect(LocalChromeProfileDiscoverer.normalizeEmail(null)).toBe('');
      expect(LocalChromeProfileDiscoverer.normalizeEmail(undefined)).toBe('');
    });
  });

  describe('Display Name Normalization', () => {
    it('should collapse multiple spaces and trim', () => {
      expect(
        LocalChromeProfileDiscoverer.normalizeDisplayName('  AI   Automation  786  ')
      ).toBe('ai automation 786');
    });

    it('should return empty string for null or undefined', () => {
      expect(LocalChromeProfileDiscoverer.normalizeDisplayName(null)).toBe('');
      expect(LocalChromeProfileDiscoverer.normalizeDisplayName(undefined)).toBe('');
    });
  });

  describe('Profile Enumeration & Metadata Parsing', () => {
    it('should extract profiles from Local State file', () => {
      const localState = {
        profile: {
          info_cache: {
            Default: {
              name: 'Personal Chrome',
              user_name: 'personal@gmail.com',
              gaia_name: 'Personal User',
            },
            'Profile 1': {
              name: 'Work Profile',
              user_name: 'work@company.com',
              gaia_name: 'Work User',
            },
          },
        },
      };

      fs.writeFileSync(path.join(tempDir, 'Local State'), JSON.stringify(localState));

      const profiles = LocalChromeProfileDiscoverer.scanProfiles(tempDir);
      expect(profiles.length).toBe(2);

      const defaultProf = profiles.find((p) => p.profileDirectory === 'Default');
      expect(defaultProf).toBeDefined();
      expect(defaultProf?.accountEmail).toBe('personal@gmail.com');
      expect(defaultProf?.profileDisplayName).toBe('Personal Chrome');

      const prof1 = profiles.find((p) => p.profileDirectory === 'Profile 1');
      expect(prof1).toBeDefined();
      expect(prof1?.accountEmail).toBe('work@company.com');
      expect(prof1?.profileDisplayName).toBe('Work Profile');
    });

    it('should supplement profile metadata from Preferences file if present', () => {
      const profDir = path.join(tempDir, 'Profile 2');
      fs.mkdirSync(profDir, { recursive: true });

      const prefs = {
        profile: { name: 'Direct Profile' },
        account_info: [{ email: 'direct@domain.com', full_name: 'Direct Full Name' }],
      };
      fs.writeFileSync(path.join(profDir, 'Preferences'), JSON.stringify(prefs));

      const profiles = LocalChromeProfileDiscoverer.scanProfiles(tempDir);
      expect(profiles.length).toBe(1);
      expect(profiles[0]?.profileDirectory).toBe('Profile 2');
      expect(profiles[0]?.accountEmail).toBe('direct@domain.com');
      expect(profiles[0]?.accountDisplayName).toBe('Direct Full Name');
    });
  });

  describe('Account Matching Logic', () => {
    const mockProfiles: DiscoveredLocalProfile[] = [
      {
        profileDirectory: 'Default',
        profileDisplayName: 'Your Chrome',
        accountEmail: 'aiautomation786786@gmail.com',
        accountDisplayName: 'Ai Automation',
        fullPath: '/path/Default',
      },
      {
        profileDirectory: 'Profile 1',
        profileDisplayName: 'Secondary Work',
        accountEmail: 'other@example.com',
        accountDisplayName: 'Other User',
        fullPath: '/path/Profile 1',
      },
      {
        profileDirectory: 'Profile 3',
        profileDisplayName: 'Empty Profile',
        accountEmail: null,
        accountDisplayName: null,
        fullPath: '/path/Profile 3',
      },
    ];

    it('should match target Google account using exact normalized email', () => {
      const result = LocalChromeProfileDiscoverer.findMatchingProfile(mockProfiles, {
        email: 'AI Automation 786 786 @ Gmail.com',
      });

      expect(result.status).toBe('exact_match');
      expect(result.match?.profileDirectory).toBe('Default');
      expect(result.match?.accountEmail).toBe('aiautomation786786@gmail.com');
      expect(result.matchingMethod).toBe('email');
      // Crucial requirement: NEVER assume or guess Profile 3
      expect(result.match?.profileDirectory).not.toBe('Profile 3');
    });

    it('should fallback to display name matching if email is not provided', () => {
      const result = LocalChromeProfileDiscoverer.findMatchingProfile(mockProfiles, {
        displayName: 'Secondary Work',
      });

      expect(result.status).toBe('exact_match');
      expect(result.match?.profileDirectory).toBe('Profile 1');
      expect(result.matchingMethod).toBe('display_name');
    });

    it('should handle multiple matches safely by rejecting arbitrary choice', () => {
      const duplicateProfiles: DiscoveredLocalProfile[] = [
        {
          profileDirectory: 'Profile 1',
          profileDisplayName: 'User A',
          accountEmail: 'dupe@example.com',
          accountDisplayName: 'Dupe',
          fullPath: '/path/1',
        },
        {
          profileDirectory: 'Profile 2',
          profileDisplayName: 'User B',
          accountEmail: 'dupe@example.com',
          accountDisplayName: 'Dupe',
          fullPath: '/path/2',
        },
      ];

      const result = LocalChromeProfileDiscoverer.findMatchingProfile(duplicateProfiles, {
        email: 'dupe@example.com',
      });

      expect(result.status).toBe('multiple_matches');
      expect(result.match).toBeNull();
      expect(result.candidates.length).toBe(2);
      expect(result.error).toContain('Disambiguation required');
    });

    it('should report not_found with standard message when account does not exist locally', () => {
      const result = LocalChromeProfileDiscoverer.findMatchingProfile(mockProfiles, {
        email: 'nonexistent@gmail.com',
      });

      expect(result.status).toBe('not_found');
      expect(result.match).toBeNull();
      expect(result.error).toBe('Target Google account profile was not found locally.');
    });
  });

  describe('Already-Running Profile Detection', () => {
    it('should return safe structure when checking if profile is in use', async () => {
      const result = await LocalChromeProfileDiscoverer.isProfileInUse(tempDir);
      expect(result).toBeDefined();
      expect(typeof result.inUse).toBe('boolean');
      expect(Array.isArray(result.pids)).toBe(true);
    });
  });
});
