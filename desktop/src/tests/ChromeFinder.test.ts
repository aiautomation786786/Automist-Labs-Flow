/**
 * Tests for WindowsChromeFinder.
 *
 * These tests run in all environments (Windows CI, Windows dev, macOS CI).
 * On non-Windows machines: the registry tests are skipped; filesystem tests
 * use the non-Windows fallback paths defined in WindowsChromeFinder.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import { WindowsChromeFinder } from '../main/engine/WindowsChromeFinder';

describe('WindowsChromeFinder', () => {
  beforeEach(() => {
    // Clear in-process cache before each test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (WindowsChromeFinder as any).cachedResult = null;
  });

  it('should return a ChromeDiscoveryResult object', () => {
    const result = WindowsChromeFinder.find();
    expect(result).toBeDefined();
    expect(result).toHaveProperty('recommended');
    expect(result).toHaveProperty('all');
    expect(Array.isArray(result.all)).toBe(true);
  });

  it('should find at least one candidate path', () => {
    const result = WindowsChromeFinder.find();
    // Even if unverified (CI without Chrome), there should be candidate paths
    expect(result.all.length).toBeGreaterThan(0);
  });

  it('should set verified=false for non-existent paths', () => {
    const result = WindowsChromeFinder.find();
    for (const candidate of result.all) {
      const actuallyExists = fs.existsSync(candidate.path);
      expect(candidate.verified).toBe(actuallyExists);
    }
  });

  it('should recommend a verified path (or null if Chrome is not installed)', () => {
    const result = WindowsChromeFinder.find();
    if (result.recommended) {
      expect(result.recommended.verified).toBe(true);
      expect(fs.existsSync(result.recommended.path)).toBe(true);
    } else {
      // Acceptable: Chrome is not installed on this CI machine
      expect(result.recommended).toBeNull();
    }
  });

  it('should cache the result on subsequent calls', () => {
    const result1 = WindowsChromeFinder.find();
    const result2 = WindowsChromeFinder.find();
    // Same reference — no rescan
    expect(result1).toBe(result2);
  });

  it('should bypass cache with forceRefresh=true', () => {
    const result1 = WindowsChromeFinder.find();
    const result2 = WindowsChromeFinder.find(true);
    // Different object (new scan)
    expect(result1).not.toBe(result2);
    // But same content
    expect(result1.all.length).toBe(result2.all.length);
  });

  it('should label candidates with a valid source enum value', () => {
    const validSources = ['registry', 'program_files', 'program_files_x86', 'localappdata', 'user_specified'];
    const result = WindowsChromeFinder.find();
    for (const candidate of result.all) {
      expect(validSources).toContain(candidate.source);
    }
  });

  it('verifyPath should return true for an existing file', () => {
    // Use the test file itself as a stand-in
    const thisFile = __filename;
    expect(WindowsChromeFinder.verifyPath(thisFile)).toBe(true);
  });

  it('verifyPath should return false for a non-existent path', () => {
    expect(WindowsChromeFinder.verifyPath('/absolutely/not/a/real/file.exe')).toBe(false);
  });

  it('findOrThrow should throw when Chrome is not found', () => {
    // Temporarily simulate "no Chrome" by marking all candidates as unverified
    const original = WindowsChromeFinder.find;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (WindowsChromeFinder as any).cachedResult = { recommended: null, all: [] };

    expect(() => WindowsChromeFinder.findOrThrow()).toThrow('not found');

    // Restore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (WindowsChromeFinder as any).cachedResult = null;
    void original;
  });
});
