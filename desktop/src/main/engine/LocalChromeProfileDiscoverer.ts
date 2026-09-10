/**
 * LocalChromeProfileDiscoverer – Discovers and matches existing Google Chrome profiles on Windows.
 *
 * Responsibilities:
 *  - Discovering the real Chrome user-data directory (e.g. %LOCALAPPDATA%\Google\Chrome\User Data).
 *  - Scanning Chrome profile metadata from Local State and profile Preferences files.
 *  - Normalizing email and display name hints for robust matching.
 *  - Matching target Google accounts using exact normalized email (with display name as fallback).
 *  - Detecting if a target profile is already running in an existing Chrome process.
 *  - Verifying if a Chrome process has a visible window on the user's desktop.
 *
 * SAFETY & PRIVACY GUARANTEES:
 *  - Never accesses, prints, or extracts cookies, credentials, passwords, or tokens.
 *  - Reads only profile identification metadata (display name, email string).
 *  - Never guesses "Profile 3" or hardcodes numeric profile directories.
 *  - Never overwrites or modifies existing user profile files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { execSync } from 'child_process';
import type {
  DiscoveredLocalProfile,
  ProfileMatchResult,
  ProfileInUseResult,
} from '../../shared/types';
import { appLogger } from '../utils/AppLogger';

export class LocalChromeProfileDiscoverer {
  /**
   * Discovers the standard Google Chrome User Data directory on Windows.
   * Returns null if not found.
   */
  static discoverChromeUserDataDir(overridePath?: string): string | null {
    if (overridePath && fs.existsSync(overridePath)) {
      return overridePath;
    }

    if (process.env.CHROME_USER_DATA_DIR && fs.existsSync(process.env.CHROME_USER_DATA_DIR)) {
      return process.env.CHROME_USER_DATA_DIR;
    }

    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const standardPath = path.join(localAppData, 'Google', 'Chrome', 'User Data');
      if (fs.existsSync(standardPath)) {
        return standardPath;
      }
    }

    // Fallback: Check user profile
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const fallbackPath = path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
      if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
      }
    }

    return null;
  }

  /**
   * Normalizes an email address for robust matching:
   *  - Trims outer whitespace
   *  - Converts to lowercase
   *  - Removes all internal whitespace (e.g. "AI Automation 786 786 @ Gmail.com" -> "aiautomation786786@gmail.com")
   */
  static normalizeEmail(email: string | null | undefined): string {
    if (!email) return '';
    return email
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  /**
   * Normalizes a display name for matching:
   *  - Trims outer whitespace
   *  - Converts to lowercase
   *  - Collapses multiple whitespace into a single space
   */
  static normalizeDisplayName(name: string | null | undefined): string {
    if (!name) return '';
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * Scans a Chrome user-data directory and returns metadata for all detected profiles.
   * Never accesses cookies, passwords, or authentication tokens.
   */
  static scanProfiles(userDataDir: string): DiscoveredLocalProfile[] {
    const profilesMap = new Map<string, DiscoveredLocalProfile>();

    if (!fs.existsSync(userDataDir)) {
      appLogger.warn('profile_discoverer', `User data directory does not exist: ${userDataDir}`);
      return [];
    }

    // Strategy 1: Parse "Local State" file (primary source of profile info_cache)
    const localStatePath = path.join(userDataDir, 'Local State');
    if (fs.existsSync(localStatePath)) {
      try {
        const content = fs.readFileSync(localStatePath, 'utf-8');
        const parsed = JSON.parse(content) as {
          profile?: {
            info_cache?: Record<
              string,
              {
                name?: string;
                user_name?: string;
                gaia_name?: string;
              }
            >;
          };
        };

        const infoCache = parsed?.profile?.info_cache ?? {};
        for (const [dirName, entry] of Object.entries(infoCache)) {
          profilesMap.set(dirName, {
            profileDirectory: dirName,
            profileDisplayName: entry.name ?? dirName,
            accountEmail: entry.user_name || null,
            accountDisplayName: entry.gaia_name || null,
            fullPath: path.join(userDataDir, dirName),
          });
        }
      } catch (err) {
        appLogger.warn('profile_discoverer', `Failed to parse Local State: ${(err as Error).message}`);
      }
    }

    // Strategy 2: Supplement / verify by scanning subdirectories (Default, Profile 1, Profile 2, etc.)
    try {
      const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (name !== 'Default' && !name.startsWith('Profile ')) continue;

        const profilePath = path.join(userDataDir, name);
        const prefPath = path.join(profilePath, 'Preferences');

        if (fs.existsSync(prefPath)) {
          try {
            const raw = fs.readFileSync(prefPath, 'utf-8');
            const pref = JSON.parse(raw) as {
              profile?: { name?: string };
              account_info?: Array<{ email?: string; full_name?: string }>;
            };

            const existing = profilesMap.get(name);
            const prefProfileName = pref?.profile?.name;
            let accountInfo: { email?: string; full_name?: string } | undefined;
            if (Array.isArray(pref?.account_info)) {
              accountInfo = pref.account_info[0];
            } else if (pref?.account_info && typeof pref.account_info === 'object') {
              accountInfo = pref.account_info as { email?: string; full_name?: string };
            }
            const prefEmail = accountInfo?.email;
            const prefFullName = accountInfo?.full_name;

            profilesMap.set(name, {
              profileDirectory: name,
              profileDisplayName: existing?.profileDisplayName || prefProfileName || name,
              accountEmail: existing?.accountEmail || prefEmail || null,
              accountDisplayName: existing?.accountDisplayName || prefFullName || null,
              fullPath: profilePath,
            });
          } catch {
            // Unreadable preferences file — skip supplement
          }
        }
      }
    } catch (err) {
      appLogger.warn('profile_discoverer', `Error scanning subdirectories: ${(err as Error).message}`);
    }

    return Array.from(profilesMap.values());
  }

  /**
   * Directly extracts the primary Google Account email from a profile's user data directory.
   * Inspects Preferences and Local State without launching Chrome.
   */
  static extractEmailFromUserDataDir(
    userDataDir?: string | null,
    profileName = 'Default'
  ): string | null {
    if (!userDataDir || !fs.existsSync(userDataDir)) return null;

    // Strategy 1: Check Preferences for candidate profile directories
    const candidateDirs = [profileName, 'Default'];
    for (const dir of candidateDirs) {
      const prefPath = path.join(userDataDir, dir, 'Preferences');
      if (fs.existsSync(prefPath)) {
        try {
          const raw = fs.readFileSync(prefPath, 'utf-8');
          const pref = JSON.parse(raw);
          let accountInfo: { email?: string; full_name?: string } | undefined;
          if (Array.isArray(pref?.account_info)) {
            accountInfo = pref.account_info[0];
          } else if (pref?.account_info && typeof pref.account_info === 'object') {
            accountInfo = pref.account_info as { email?: string; full_name?: string };
          }
          if (accountInfo?.email && typeof accountInfo.email === 'string' && accountInfo.email.includes('@')) {
            return this.normalizeEmail(accountInfo.email);
          }
        } catch { /* continue */ }
      }
    }

    // Strategy 2: Check Local State info_cache
    const localStatePath = path.join(userDataDir, 'Local State');
    if (fs.existsSync(localStatePath)) {
      try {
        const raw = fs.readFileSync(localStatePath, 'utf-8');
        const state = JSON.parse(raw);
        const infoCache = state?.profile?.info_cache;
        if (infoCache) {
          const profileInfo = infoCache[profileName] || infoCache['Default'];
          const email = profileInfo?.user_name;
          if (email && typeof email === 'string' && email.includes('@')) {
            return this.normalizeEmail(email);
          }
        }
      } catch { /* continue */ }
    }

    return null;
  }

  /**
   * Matches profiles against target hints.
   * Priority:
   *  1. Exact normalized email match
   *  2. Secondary hint: display name match
   *
   * Rejects ambiguity: if multiple profiles match, returns 'multiple_matches'.
   * If none match, returns 'not_found'.
   * Never hardcodes or guesses 'Profile 3'.
   */
  static findMatchingProfile(
    profiles: DiscoveredLocalProfile[],
    target: { email?: string; displayName?: string }
  ): ProfileMatchResult {
    const targetEmailNorm = this.normalizeEmail(target.email);
    const targetDisplayNorm = this.normalizeDisplayName(target.displayName);

    // 1. Try exact normalized email match
    if (targetEmailNorm) {
      const emailMatches = profiles.filter((p) => this.normalizeEmail(p.accountEmail) === targetEmailNorm);

      if (emailMatches.length === 1) {
        return {
          status: 'exact_match',
          match: emailMatches[0]!,
          candidates: emailMatches,
          matchingMethod: 'email',
        };
      }

      if (emailMatches.length > 1) {
        return {
          status: 'multiple_matches',
          match: null,
          candidates: emailMatches,
          matchingMethod: 'email',
          error: `Multiple Chrome profiles (${emailMatches.map((m) => m.profileDirectory).join(', ')}) matched target email "${target.email}". Disambiguation required.`,
        };
      }
    }

    // 2. Try secondary display name hint if no email match
    if (targetDisplayNorm) {
      const targetDisplayStripped = targetDisplayNorm.replace(/\s+/g, '');

      const displayMatches = profiles.filter((p) => {
        const accNorm = this.normalizeDisplayName(p.accountDisplayName);
        const profNorm = this.normalizeDisplayName(p.profileDisplayName);

        if (accNorm === targetDisplayNorm || profNorm === targetDisplayNorm) return true;

        // Compare space-stripped versions
        const accStripped = accNorm.replace(/\s+/g, '');
        const profStripped = profNorm.replace(/\s+/g, '');
        if (accStripped && targetDisplayStripped.includes(accStripped)) return true;
        if (profStripped && targetDisplayStripped.includes(profStripped)) return true;

        return false;
      });

      if (displayMatches.length === 1) {
        return {
          status: 'exact_match',
          match: displayMatches[0]!,
          candidates: displayMatches,
          matchingMethod: 'display_name',
        };
      }

      if (displayMatches.length > 1) {
        return {
          status: 'multiple_matches',
          match: null,
          candidates: displayMatches,
          matchingMethod: 'display_name',
          error: `Multiple Chrome profiles (${displayMatches.map((m) => m.profileDirectory).join(', ')}) matched target display name "${target.displayName}". Disambiguation required.`,
        };
      }
    }

    // 3. No match found
    return {
      status: 'not_found',
      match: null,
      candidates: [],
      error: 'Target Google account profile was not found locally.',
    };
  }

  /**
   * Checks whether the target Chrome user-data directory or profile is currently in use
   * by an active Chrome process.
   *
   * Inspects:
   *  - Running chrome.exe processes via PowerShell / Win32
   *  - Whether `--remote-debugging-port` is already active
   */
  static async isProfileInUse(userDataDir: string, _profileDirectory?: string): Promise<ProfileInUseResult> {
    if (process.platform !== 'win32') {
      return { inUse: false, pids: [] };
    }

    try {
      const psCommand = `Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -notlike "*--type=*" } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`;
      const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
      const raw = execSync(`powershell.exe -NoProfile -EncodedCommand ${encoded}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 6000,
      }).toString().trim();

      if (!raw) {
        return { inUse: false, pids: [] };
      }

      let procList: Array<{ ProcessId: number; CommandLine: string }> = [];
      try {
        const parsed = JSON.parse(raw);
        procList = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return { inUse: false, pids: [] };
      }

      const normTargetUserData = path.normalize(userDataDir).toLowerCase();
      const standardDefaultUserData = process.env.LOCALAPPDATA
        ? path.normalize(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')).toLowerCase()
        : '';

      const matchingPids: number[] = [];
      let detectedCdpPort: number | undefined;

      for (const proc of procList) {
        const cmd = proc.CommandLine || '';

        // Check if command line specifies user-data-dir
        const matchUserData = cmd.match(/--user-data-dir=["']?([^"'\s]+)["']?/i);
        let procUserData = matchUserData?.[1] ? path.normalize(matchUserData[1]).toLowerCase() : null;

        // If no --user-data-dir is specified, Chrome defaults to the standard user-data dir
        if (!procUserData && standardDefaultUserData) {
          procUserData = standardDefaultUserData;
        }

        if (procUserData && procUserData === normTargetUserData) {
          matchingPids.push(proc.ProcessId);

          // Check if remote debugging port is present
          const portMatch = cmd.match(/--remote-debugging-port=(\d+)/i);
          if (portMatch?.[1]) {
            detectedCdpPort = parseInt(portMatch[1], 10);
          }
        }
      }

      if (matchingPids.length === 0) {
        return { inUse: false, pids: [] };
      }

      // If CDP port is detected, check if it's responsive
      if (detectedCdpPort) {
        const isResponsive = await this.probePort(detectedCdpPort);
        if (isResponsive) {
          return {
            inUse: true,
            pids: matchingPids,
            cdpPort: detectedCdpPort,
            details: `Chrome is running with responsive CDP endpoint on port ${detectedCdpPort}.`,
          };
        }
      }

      return {
        inUse: true,
        pids: matchingPids,
        cdpPort: undefined,
        details: `Chrome is running (${matchingPids.length} process(es), PIDs: ${matchingPids.join(', ')}) without an accessible remote debugging port.`,
      };
    } catch {
      return { inUse: false, pids: [] };
    }
  }

  /**
   * Verifies whether a given process has a visible GUI window on Windows.
   */
  static async verifyVisibleWindow(pid: number): Promise<{ visible: boolean; windowTitle?: string; details?: string }> {
    if (process.platform !== 'win32') {
      return { visible: true, details: 'Non-Windows platform; visibility assumed.' };
    }

    try {
      const psScript = `
        Add-Type @'
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class WinCheck {
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
          [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
          [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
          [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          public struct RECT { public int Left, Top, Right, Bottom; }
          public static string FindWindow(uint[] targetPids) {
            string found = "";
            EnumWindows((hWnd, lParam) => {
              if (IsWindowVisible(hWnd)) {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (Array.IndexOf(targetPids, pid) >= 0) {
                  RECT r;
                  GetWindowRect(hWnd, out r);
                  int w = r.Right - r.Left;
                  int h = r.Bottom - r.Top;
                  if (w > 150 && h > 150) {
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, 256);
                    found = "title:" + sb.ToString() + ";size:" + w + "x" + h;
                    return false;
                  }
                }
              }
              return true;
            }, IntPtr.Zero);
            return found;
          }
        }
'@
        $treePids = @([uint32]${pid}) + @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq ${pid} } | ForEach-Object { [uint32]$_.ProcessId })
        $found = [WinCheck]::FindWindow([uint32[]]$treePids)
        if (-not $found) {
          $allChromePids = @(Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.ProcessId })
          $found = [WinCheck]::FindWindow([uint32[]]$allChromePids)
        }
        $found
      `;

      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      const result = execSync(`powershell.exe -NoProfile -EncodedCommand ${encoded}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
      }).toString().trim();

      if (result.startsWith('title:')) {
        const parts = result.split(';');
        const title = parts[0]?.replace('title:', '');
        const size = parts[1]?.replace('size:', '');
        return {
          visible: true,
          windowTitle: title,
          details: `Visible top-level window confirmed (Size: ${size}, Title: "${title}")`,
        };
      }

      return {
        visible: false,
        details: 'No top-level visible window matching process PID found.',
      };
    } catch (err) {
      return {
        visible: false,
        details: `Visibility check encountered error: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Checks whether a specific Chrome profile directory is actively in use
   * by inspecting exclusive file locks on session files (e.g. Network\Cookies, Web Data, History).
   */
  static isProfileDirectoryLocked(profilePath: string): { inUse: boolean; lockedFile?: string } {
    if (!fs.existsSync(profilePath)) {
      return { inUse: false };
    }

    const checkFiles = [
      path.join(profilePath, 'Network', 'Cookies'),
      path.join(profilePath, 'Web Data'),
      path.join(profilePath, 'History'),
      path.join(profilePath, 'Preferences'),
      path.join(profilePath, 'Session Storage'),
    ];

    for (const f of checkFiles) {
      if (fs.existsSync(f)) {
        try {
          const fd = fs.openSync(f, 'r+');
          fs.closeSync(fd);
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === 'EBUSY' || code === 'EPERM') {
            return { inUse: true, lockedFile: f };
          }
        }
      }
    }

    return { inUse: false };
  }

  /**
   * Searches for an active CDP endpoint across candidate ports.
   */
  static async findActiveCdpEndpoint(preferredPort?: number): Promise<{ port: number } | null> {
    const candidatePorts = preferredPort
      ? [preferredPort, 9222, 9223, 9224, 9225]
      : [9222, 9223, 9224, 9225];
    const uniquePorts = [...new Set(candidatePorts)];

    for (const port of uniquePorts) {
      try {
        const isOk = await this.probePort(port);
        if (isOk) {
          return { port };
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  /**
   * Inspects whether the requested Flow/Google profile is already running,
   * distinguishing Case A (open & attachable), Case B (open but not attachable),
   * and Case C (not open).
   */
  static async detectProfileState(target: {
    userDataDir?: string;
    profileDirectory?: string;
    email?: string;
    displayName?: string;
    preferredCdpPort?: number;
  }): Promise<import('../../shared/types').ExistingProfileDetectionResult> {
    const userDataDir = target.userDataDir || this.discoverChromeUserDataDir() || '';
    let profileDirectory = target.profileDirectory;
    let profileDisplayName = target.displayName;
    let accountEmail = target.email;

    // If profileDirectory is not specified, resolve it via scanProfiles & findMatchingProfile
    if (!profileDirectory && userDataDir && (target.email || target.displayName)) {
      const profiles = this.scanProfiles(userDataDir);
      const match = this.findMatchingProfile(profiles, { email: target.email, displayName: target.displayName });
      if (match.status === 'exact_match' && match.match) {
        profileDirectory = match.match.profileDirectory;
        profileDisplayName = match.match.profileDisplayName;
        accountEmail = match.match.accountEmail || accountEmail;
      }
    }

    if (!profileDirectory) {
      profileDirectory = 'Default';
    }

    const fullProfilePath = path.join(userDataDir, profileDirectory);

    // 1. Check process-level in-use for this user-data directory
    const procInfo = await this.isProfileInUse(userDataDir, profileDirectory);
    // 2. Check profile-specific lock status
    const lockInfo = this.isProfileDirectoryLocked(fullProfilePath);

    // Specific profile is considered open if its folder is locked OR a dedicated Chrome instance is running it
    const isProfileOpen = lockInfo.inUse || (procInfo.inUse && procInfo.pids.length > 0);

    if (!isProfileOpen) {
      return {
        state: 'not_open',
        profileDirectory,
        userDataDir,
        profileDisplayName,
        accountEmail,
        pids: [],
        details: `Profile "${profileDisplayName || profileDirectory}" is not currently running.`,
      };
    }

    // Profile IS OPEN! Check if automation / CDP connection is available
    const activeCdp = await this.findActiveCdpEndpoint(procInfo.cdpPort || target.preferredCdpPort);

    if (activeCdp) {
      return {
        state: 'open_and_attachable',
        profileDirectory,
        userDataDir,
        profileDisplayName,
        accountEmail,
        pids: procInfo.pids,
        cdpPort: activeCdp.port,
        details: `Profile "${profileDisplayName || profileDirectory}" is running and exposes an active automation connection on CDP port ${activeCdp.port}.`,
      };
    }

    // Profile is OPEN but NOT attachable (Case B)
    const displayName = target.displayName || profileDisplayName || profileDirectory;
    return {
      state: 'open_not_attachable',
      profileDirectory,
      userDataDir,
      profileDisplayName,
      accountEmail,
      pids: procInfo.pids,
      details: `${displayName} profile is already open, but this Chrome session does not expose an automation connection. Please enable/launch this profile through the app's supported connection mode, or close only this profile and retry.`,
    };
  }

  private static probePort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 800 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }
}

