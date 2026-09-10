/**
 * ProfileConfig – Manages persistent profile configuration files on disk.
 *
 * Each profile is stored at:
 *   %LOCALAPPDATA%\GoogleFlowApp\profiles\{profileId}\profile.json
 *
 * Chrome user data lives alongside it at:
 *   %LOCALAPPDATA%\GoogleFlowApp\profiles\{profileId}\chrome-user-data\
 *
 * This module handles CRUD for these files.
 * It does NOT own the browser session lifecycle — that belongs to ProfileSession.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProfileConfig } from '../../shared/types';
import { getAppDataDir } from '../utils/AppLogger';
import { appLogger } from '../utils/AppLogger';
import { LocalChromeProfileDiscoverer } from './LocalChromeProfileDiscoverer';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Returns the root directory for all profiles. */
export function getProfilesRootDir(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? process.env['APPDATA'];
    if (localAppData) {
      return path.join(localAppData, 'AutomistLabs', 'FlowProfiles');
    }
  }
  return path.join(getAppDataDir(), 'FlowProfiles');
}

/** Returns the directory for a specific profile. */
export function getProfileDir(profileId: string): string {
  return path.join(getProfilesRootDir(), profileId);
}

/** Returns the path to the profile.json config file. */
export function getProfileConfigPath(profileId: string): string {
  return path.join(getProfileDir(profileId), 'profile.json');
}

/** Returns the Chrome user-data directory path for a profile. */
export function getChromeUserDataDir(profileId: string): string {
  return path.join(getProfileDir(profileId), 'chrome-user-data');
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generates a new unique profile ID.
 * Format: "profile_" + 8 hex chars (from crypto random bytes).
 */
function generateProfileId(): string {
  return 'profile_' + crypto.randomBytes(4).toString('hex');
}

// ---------------------------------------------------------------------------
// ProfileConfigManager
// ---------------------------------------------------------------------------

export class ProfileConfigManager {
  /** Returns the root directory where all Flow profiles are stored. */
  static getProfilesRootDir(): string {
    return getProfilesRootDir();
  }

  // ---- Create -------------------------------------------------------------

  /**
   * Creates a new profile with a unique ID, initializes its directory structure,
   * writes the initial profile.json, and returns the config.
   *
   * @param displayName   Human-readable label (e.g. "Marketing Account").
   * @param chromePath    Absolute path to chrome.exe.
   * @param cdpPort       Port assigned by ChromePortAllocator.
   * @param expectedEmail Optional expected Google account email hint.
   * @param notes         Optional user notes.
   */
  static create(params: {
    displayName: string;
    chromePath: string;
    cdpPort: number;
    expectedEmail?: string;
    notes?: string;
  }): ProfileConfig {
    const profileId = generateProfileId();
    const profileDir = getProfileDir(profileId);
    const userDataDir = getChromeUserDataDir(profileId);
    const now = new Date().toISOString();

    // Create directory tree
    fs.mkdirSync(profileDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });

    const config: ProfileConfig = {
      profileId,
      displayName: params.displayName,
      userDataDir,
      chromeProfileName: 'Default',
      chromePath: params.chromePath,
      cdpPort: params.cdpPort,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      flowUrlLocale: null,
      detectedEmail: null,
      expectedEmail: params.expectedEmail?.trim() || null,
      notes: params.notes ?? '',
    };

    this.write(config);

    appLogger.info('profile_config', `Profile created`, {
      profileId,
      displayName: params.displayName,
      profileDir,
    });

    return config;
  }

  // ---- Read ---------------------------------------------------------------

  /** Reads and parses a profile config from disk. Throws if not found. */
  static read(profileId: string): ProfileConfig {
    const configPath = getProfileConfigPath(profileId);

    if (!fs.existsSync(configPath)) {
      throw new Error(`Profile config not found: ${configPath}`);
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as ProfileConfig;

      // Identity self-healing: verify against local Chrome profile data if present
      if (config.userDataDir && fs.existsSync(config.userDataDir)) {
        const localEmail = LocalChromeProfileDiscoverer.extractEmailFromUserDataDir(
          config.userDataDir,
          config.chromeProfileName || 'Default'
        );
        if (localEmail && localEmail !== config.detectedEmail) {
          appLogger.info('profile_config', `Self-healing profile identity for ${profileId}: updating detectedEmail from '${config.detectedEmail}' to '${localEmail}'`);
          config.detectedEmail = localEmail;
          if (!config.expectedEmail || config.expectedEmail !== localEmail) {
            config.expectedEmail = localEmail;
          }
          config.updatedAt = new Date().toISOString();
          try {
            this.write(config);
          } catch {
            // Non-fatal write failure during read
          }
        }
      }

      return config;
    } catch (err) {
      throw new Error(
        `Failed to parse profile config for ${profileId}: ${(err as Error).message}`
      );
    }
  }

  /** Returns all profiles found in the profiles root directory. */
  static readAll(): ProfileConfig[] {
    const rootDir = getProfilesRootDir();

    if (!fs.existsSync(rootDir)) {
      return [];
    }

    const profileIds = fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('profile_'))
      .map((d) => d.name);

    const configs: ProfileConfig[] = [];
    for (const id of profileIds) {
      try {
        configs.push(this.read(id));
      } catch (err) {
        appLogger.warn('profile_config', `Skipping unreadable profile config: ${id}`, {
          error: (err as Error).message,
        });
      }
    }

    return configs;
  }

  /** Alias for readAll() */
  static list(): ProfileConfig[] {
    return this.readAll();
  }

  // ---- Update -------------------------------------------------------------

  /** Writes an updated config to disk. Updates the updatedAt timestamp. */
  static update(profileId: string, patch: Partial<Omit<ProfileConfig, 'profileId' | 'createdAt'>>): ProfileConfig {
    const existing = this.read(profileId);
    const updated: ProfileConfig = {
      ...existing,
      ...patch,
      profileId: existing.profileId, // Immutable
      createdAt: existing.createdAt, // Immutable
      updatedAt: new Date().toISOString(),
    };

    this.write(updated);
    return updated;
  }

  // ---- Delete -------------------------------------------------------------

  /**
   * Deletes the profile directory and all its contents (including Chrome data).
   * This is irreversible; the caller must confirm with the user before calling.
   */
  static delete(profileId: string): void {
    const profileDir = getProfileDir(profileId);

    if (!fs.existsSync(profileDir)) {
      appLogger.warn('profile_config', `Delete called on non-existent profile`, { profileId });
      return;
    }

    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (err) {
      appLogger.warn('profile_config', `Profile directory deletion had locked files: ${(err as Error).message}`, { profileId });
      try {
        const configPath = getProfileConfigPath(profileId);
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      } catch {
        /* ignore */
      }
    }

    appLogger.info('profile_config', `Profile deleted`, { profileId, profileDir });
  }

  // ---- Validation ---------------------------------------------------------

  /** Returns true if the profile directory and profile.json both exist. */
  static exists(profileId: string): boolean {
    return fs.existsSync(getProfileConfigPath(profileId));
  }

  // ---- Private helpers ----------------------------------------------------

  private static write(config: ProfileConfig): void {
    const configPath = getProfileConfigPath(config.profileId);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
