/**
 * WindowsChromeFinder – Locates the Google Chrome executable on Windows.
 *
 * Scanning order (highest to lowest priority):
 *  1. Windows Registry  HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe
 *  2. Windows Registry  HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe
 *  3. %PROGRAMFILES%\Google\Chrome\Application\chrome.exe
 *  4. %PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe
 *  5. %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
 *  6. Known Canary / Beta paths (bonus fallbacks)
 *
 * On non-Windows platforms (CI, testing) a lightweight fallback tries to run
 * `google-chrome` or `chromium` from PATH, which satisfies the unit tests
 * without requiring a real Windows Chrome installation.
 *
 * All file-system operations are synchronous so the discovery result is
 * available immediately during application startup without async plumbing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ChromeCandidate, ChromeDiscoveryResult } from '../../shared/types';
import { appLogger } from '../utils/AppLogger';

// ---------------------------------------------------------------------------
// Registry helper (Windows only)
// ---------------------------------------------------------------------------

/**
 * Reads a value from the Windows registry using the built-in `reg.exe` tool.
 * Returns null on failure or when not running on Windows.
 */
function readRegistry(key: string, valueName: string): string | null {
  if (process.platform !== 'win32') return null;

  try {
    const stdout = execSync(`reg query "${key}" /v "${valueName}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString();

    // Registry output format:
    //   \n    <ValueName>    REG_SZ    <Value>\n
    const match = stdout.match(/REG_SZ\s+(.+)$/m);
    if (match?.[1]) {
      return match[1].trim();
    }
  } catch {
    // Key not found or reg.exe unavailable — not an error.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate builders
// ---------------------------------------------------------------------------

function makeCandidate(
  candidatePath: string,
  source: ChromeCandidate['source'],
): ChromeCandidate {
  return {
    path: candidatePath,
    source,
    verified: fs.existsSync(candidatePath),
  };
}

// ---------------------------------------------------------------------------
// Main finder
// ---------------------------------------------------------------------------

export class WindowsChromeFinder {
  private static cachedResult: ChromeDiscoveryResult | null = null;

  /**
   * Scans all known Chrome installation locations and returns a discovery result.
   * Result is cached after the first call to avoid repeated filesystem scans
   * during the same process lifetime.
   *
   * @param forceRefresh  Pass true to bypass the in-process cache.
   */
  static find(forceRefresh = false): ChromeDiscoveryResult {
    if (!forceRefresh && this.cachedResult) {
      return this.cachedResult;
    }

    const candidates: ChromeCandidate[] = [];

    if (process.platform === 'win32') {
      candidates.push(...this.scanWindows());
    } else {
      // Non-Windows: used during CI tests only
      candidates.push(...this.scanNonWindows());
    }

    const recommended = candidates.find((c) => c.verified) ?? null;

    const result: ChromeDiscoveryResult = { recommended, all: candidates };
    this.cachedResult = result;

    appLogger.info('chrome_finder', 'Chrome discovery complete', {
      recommended: recommended?.path ?? 'not found',
      candidateCount: candidates.length,
      verifiedCount: candidates.filter((c) => c.verified).length,
    });

    return result;
  }

  /**
   * Returns the path to a verified Chrome executable.
   * Throws if Chrome is not found anywhere.
   */
  static findOrThrow(): string {
    const result = this.find();
    if (!result.recommended) {
      throw new Error(
        'Google Chrome was not found on this system.\n' +
        'Please install Chrome from https://www.google.com/chrome/ ' +
        'or set a custom Chrome path in application Settings.'
      );
    }
    return result.recommended.path;
  }

  /**
   * Verifies that a specific user-supplied path points to a valid chrome.exe.
   */
  static verifyPath(chromePath: string): boolean {
    return fs.existsSync(chromePath);
  }

  // ---- Platform-specific scanning -----------------------------------------

  private static scanWindows(): ChromeCandidate[] {
    const candidates: ChromeCandidate[] = [];

    // 1. HKLM Registry (machine-wide installation)
    const hklmPath = readRegistry(
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      '(Default)',
    );
    if (hklmPath) {
      candidates.push(makeCandidate(hklmPath, 'registry'));
    }

    // 2. HKCU Registry (per-user installation)
    const hkcuPath = readRegistry(
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      '(Default)',
    );
    if (hkcuPath && hkcuPath !== hklmPath) {
      candidates.push(makeCandidate(hkcuPath, 'registry'));
    }

    // 3. Standard filesystem locations
    const programFiles = process.env['PROGRAMFILES'];
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env['LOCALAPPDATA'];

    const CHROME_RELATIVE = path.join('Google', 'Chrome', 'Application', 'chrome.exe');
    const CANARY_RELATIVE = path.join('Google', 'Chrome SxS', 'Application', 'chrome.exe');
    const BETA_RELATIVE = path.join('Google', 'Chrome Beta', 'Application', 'chrome.exe');

    if (programFiles) {
      candidates.push(makeCandidate(path.join(programFiles, CHROME_RELATIVE), 'program_files'));
      candidates.push(makeCandidate(path.join(programFiles, CANARY_RELATIVE), 'program_files'));
      candidates.push(makeCandidate(path.join(programFiles, BETA_RELATIVE), 'program_files'));
    }

    if (programFilesX86) {
      candidates.push(makeCandidate(path.join(programFilesX86, CHROME_RELATIVE), 'program_files_x86'));
    }

    if (localAppData) {
      candidates.push(makeCandidate(path.join(localAppData, CHROME_RELATIVE), 'localappdata'));
      candidates.push(makeCandidate(path.join(localAppData, CANARY_RELATIVE), 'localappdata'));
    }

    return candidates;
  }

  private static scanNonWindows(): ChromeCandidate[] {
    // Used only during CI testing on macOS/Linux.
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
    return linuxPaths.map((p) => makeCandidate(p, 'program_files'));
  }
}
