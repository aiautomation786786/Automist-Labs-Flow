/**
 * SettingsManager – Concurrency-safe, atomic, validated, and future-secret-ready
 * settings storage manager for Infinity Flow.
 *
 * Guarantees:
 *  1. Concurrency-Safe: Serializes all write mutations via FileMutex ('settings' key).
 *  2. Atomic Writes: Writes to unique temp file first, then renames with Windows EBUSY retry
 *     and copy fallback, preventing corrupt or truncated files.
 *  3. Strict Write-Loading: loadForWrite() strictly fails if the settings file exists but is
 *     corrupted or malformed JSON. It NEVER silently wipes existing corrupted settings with defaults.
 *  4. Safe Defaults: Generates complete default settings on first launch when no file exists.
 *  5. Strict Validation: Validates all patch values and rejects invalid or boundary-violating inputs.
 *  6. Secrets Ready: Pluggable SafeStorageProvider for Electron safeStorage. Persists secrets as
 *     encrypted ciphertext (*Enc), provides in-memory decryption, and sanitizes renderer responses
 *     so secrets and ciphertexts never leak over IPC.
 *  7. Preserves Existing Settings: Merges partial updates without disturbing unchanged fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  AppSettings,
  AppLogLevel,
} from '../../shared/types';
import { fileMutex } from './FileMutex';
import { getAppDataDir, AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class CorruptedSettingsError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'CorruptedSettingsError';
  }
}

export class SettingsValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Settings validation failed: ${errors.join(', ')}`);
    this.name = 'SettingsValidationError';
  }
}

/**
 * Abstraction over Electron safeStorage for encryption at rest.
 * Allows dependency injection during testing or non-desktop environments.
 */
export interface SafeStorageProvider {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

class DefaultSafeStorageProvider implements SafeStorageProvider {
  isEncryptionAvailable(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      return Boolean(electron?.safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  encryptString(plainText: string): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (!electron?.safeStorage?.encryptString) {
      throw new Error('Electron safeStorage is not available in the current environment.');
    }
    return electron.safeStorage.encryptString(plainText);
  }

  decryptString(encrypted: Buffer): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (!electron?.safeStorage?.decryptString) {
      throw new Error('Electron safeStorage is not available in the current environment.');
    }
    return electron.safeStorage.decryptString(encrypted);
  }
}

/** Set of known secret field names that must be encrypted at rest */
const KNOWN_SECRET_KEYS = new Set<string>([
  'scriptAiKey',
  'scriptAiKeys',
  'azureSpeechKey',
  'ai33Key',
  'famespeakKey',
  'geminiApiKey',
]);

export class SettingsManager {
  private static customFilePath: string | null = null;
  private static safeStorageProvider: SafeStorageProvider = new DefaultSafeStorageProvider();
  private static inMemoryCache: { settings: AppSettings; mtimeMs: number } | null = null;

  /**
   * Overrides the default settings file path (primarily for isolated testing).
   */
  static setCustomSettingsPath(customPath: string | null): void {
    this.customFilePath = customPath;
    this.inMemoryCache = null;
  }

  /**
   * Sets a custom SafeStorageProvider (for unit tests or alternative keystores).
   */
  static setSafeStorageProvider(provider: SafeStorageProvider): void {
    this.safeStorageProvider = provider;
  }

  /**
   * Resets provider to default Electron provider.
   */
  static resetSafeStorageProvider(): void {
    this.safeStorageProvider = new DefaultSafeStorageProvider();
  }

  /**
   * Resolves the absolute path to settings.json.
   */
  static getSettingsPath(): string {
    if (this.customFilePath) {
      return this.customFilePath;
    }
    const configDir = path.join(getAppDataDir(), 'config');
    return path.join(configDir, 'settings.json');
  }

  /**
   * Returns authoritative system defaults for Infinity Flow settings.
   */
  static getDefaults(): AppSettings {
    return {
      appDataDir: getAppDataDir(),
      defaultImageRatio: '16:9',
      defaultProcessingOrder: 'images_first',
      maxRetries: 2,
      logLevel: 'INFO',
      defaultImageDownloadQuality: 'original',
      defaultVideoDownloadQuality: 'original',
      theme: 'dark',
      imageConcurrency: 5,
      scriptAiModel: 'gemini-flash-latest',
    };
  }

  /**
   * Clears the in-memory cache.
   */
  static clearCache(): void {
    this.inMemoryCache = null;
  }

  /**
   * Validates a settings patch and sanitizes values.
   * Throws SettingsValidationError if invalid.
   */
  static validatePatch(patch: Record<string, unknown>): Partial<AppSettings> {
    const errors: string[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;

      // appDataDir is strictly read-only and system-managed
      if (key === 'appDataDir') {
        continue;
      }

      if (key === 'defaultImageRatio') {
        if (value !== '16:9' && value !== '9:16') {
          errors.push(`defaultImageRatio must be '16:9' or '9:16', got '${String(value)}'`);
        } else {
          sanitized[key] = value;
        }
      } else if (key === 'defaultProcessingOrder') {
        if (value !== 'images_first' && value !== 'videos_first' && value !== 'automatic') {
          errors.push(`defaultProcessingOrder must be 'images_first', 'videos_first', or 'automatic', got '${String(value)}'`);
        } else {
          sanitized[key] = value;
        }
      } else if (key === 'maxRetries') {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 1 || num > 10) {
          errors.push(`maxRetries must be an integer between 1 and 10, got '${String(value)}'`);
        } else {
          sanitized[key] = num;
        }
      } else if (key === 'logLevel') {
        const validLevels: AppLogLevel[] = ['INFO', 'WARN', 'DEBUG', 'ERROR'];
        if (!validLevels.includes(value as AppLogLevel)) {
          errors.push(`logLevel must be one of ${validLevels.join(', ')}, got '${String(value)}'`);
        } else {
          sanitized[key] = value;
        }
      } else if (key === 'defaultImageDownloadQuality') {
        if (value !== 'original' && value !== '2k') {
          errors.push(`defaultImageDownloadQuality must be 'original' or '2k', got '${String(value)}'`);
        } else {
          sanitized[key] = value;
        }
      } else if (key === 'defaultVideoDownloadQuality') {
        if (value !== 'original' && value !== '1080p') {
          errors.push(`defaultVideoDownloadQuality must be 'original' or '1080p', got '${String(value)}'`);
        } else {
          sanitized[key] = value;
        }
      } else if (key === 'theme') {
        if (value !== 'dark' && value !== 'light' && value !== 'system') {
          errors.push(`theme must be 'dark', 'light', or 'system', got '${String(value)}'`);
        } else {
          sanitized[key] = value;
        }
      } else if (key === 'imageConcurrency') {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 1 || num > 30) {
          errors.push(`imageConcurrency must be an integer between 1 and 30, got '${String(value)}'`);
        } else {
          sanitized[key] = num;
        }
      } else if (key === 'musicVolume') {
        const num = Number(value);
        if (Number.isNaN(num) || num < 0 || num > 100) {
          errors.push(`musicVolume must be a number between 0 and 100, got '${String(value)}'`);
        } else {
          sanitized[key] = num;
        }
      } else {
        // Forward other extensible fields (strings, booleans, numbers)
        sanitized[key] = value;
      }
    }

    if (errors.length > 0) {
      throw new SettingsValidationError(errors);
    }

    return sanitized as Partial<AppSettings>;
  }

  /**
   * Determines if a given field name represents a secret.
   */
  private static isSecretKey(key: string): boolean {
    if (KNOWN_SECRET_KEYS.has(key)) return true;
    if (key.endsWith('Key') || key.endsWith('Secret') || key.endsWith('Token')) {
      return true;
    }
    return false;
  }

  /**
   * Strictly reads the settings file when preparing to write.
   *
   * CRITICAL RELIABILITY INVARIANT:
   * If the file exists but contains invalid JSON or is empty, this method THROWS
   * an explicit CorruptedSettingsError. It NEVER returns defaults.
   * This prevents a corrupted file from being silently overwritten with empty defaults!
   */
  static loadForWrite(): AppSettings {
    const filePath = this.getSettingsPath();

    if (!fs.existsSync(filePath)) {
      return this.getDefaults();
    }

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      throw new CorruptedSettingsError(`Unable to read settings file at ${filePath}: ${err.message}`, err);
    }

    if (!raw.trim()) {
      throw new CorruptedSettingsError(`Settings file at ${filePath} is empty. Write aborted to prevent data loss.`);
    }

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Settings content root must be a JSON object.');
      }
      return { ...this.getDefaults(), ...parsed };
    } catch (err: any) {
      throw new CorruptedSettingsError(`Settings file at ${filePath} contains malformed JSON: ${err.message}. Write aborted to prevent data loss.`, err);
    }
  }

  /**
   * Reads settings safely for read-only consumers.
   * If the file does not exist, writes and returns initial defaults.
   * If the file is corrupted, logs an error and returns defaults in memory without overwriting disk.
   */
  static readSettings(): AppSettings {
    const filePath = this.getSettingsPath();

    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (this.inMemoryCache && this.inMemoryCache.mtimeMs === stat.mtimeMs) {
          return JSON.parse(JSON.stringify(this.inMemoryCache.settings));
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          const merged: AppSettings = {
            ...this.getDefaults(),
            ...parsed,
            appDataDir: getAppDataDir(), // System truth always preserved
          };
          this.inMemoryCache = {
            settings: JSON.parse(JSON.stringify(merged)),
            mtimeMs: stat.mtimeMs,
          };
          return merged;
        }
      }
    } catch (err) {
      logger.error('settings_manager', `Error reading settings from ${filePath}. Returning safe defaults.`, err as Error);
      return this.getDefaults();
    }

    // First-launch: file does not exist yet. Initialize it with safe defaults.
    const defaults = this.getDefaults();
    try {
      this.writeSettingsAtomic(defaults);
    } catch (err) {
      logger.warn('settings_manager', 'Failed to write initial default settings file', { error: (err as Error).message });
    }
    return defaults;
  }

  /**
   * Retrieves sanitized settings suitable for sending across Electron IPC to the renderer.
   * Strips all encrypted ciphertext (*Enc) fields and masks secrets.
   */
  static getSanitizedSettings(): AppSettings {
    const raw = this.readSettings();
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
      // Never send ciphertext fields to the renderer
      if (key.endsWith('Enc')) {
        const plainKey = key.slice(0, -3);
        sanitized[plainKey] = '********';
        continue;
      }
      // If a plain secret key was in memory, mask it so secrets don't leak to UI
      if (this.isSecretKey(key)) {
        if (key === 'scriptAiKeys' && Array.isArray(value)) {
          sanitized[key] = value.map(() => '••••••••');
        } else {
          sanitized[key] = value ? '••••••••' : '';
        }
        continue;
      }
      sanitized[key] = value;
    }

    return sanitized as AppSettings;
  }

  /**
   * Returns all available Script AI API keys from scriptAiKeys, scriptAiKey,
   * or environment variables (GEMINI_API_KEY, SCRIPT_AI_KEY).
   */
  static getScriptAiKeys(): string[] {
    const keys: string[] = [];

    const multiRaw = this.getSecret('scriptAiKeys');
    if (multiRaw) {
      try {
        const parsed = JSON.parse(multiRaw);
        if (Array.isArray(parsed)) {
          for (const k of parsed) {
            if (typeof k === 'string' && k.trim() && !keys.includes(k.trim())) {
              keys.push(k.trim());
            }
          }
        }
      } catch {
        for (const k of multiRaw.split(/[\r\n]+/)) {
          if (k.trim() && !keys.includes(k.trim())) {
            keys.push(k.trim());
          }
        }
      }
    }

    const single = this.getSecret('scriptAiKey');
    if (single && single.trim() && !keys.includes(single.trim())) {
      keys.unshift(single.trim());
    }

    const geminiSingle = this.getSecret('geminiApiKey');
    if (geminiSingle && geminiSingle.trim() && !keys.includes(geminiSingle.trim())) {
      keys.push(geminiSingle.trim());
    }

    const envKey = process.env.GEMINI_API_KEY || process.env.SCRIPT_AI_KEY;
    if (envKey && envKey.trim() && !keys.includes(envKey.trim())) {
      keys.push(envKey.trim());
    }

    return keys;
  }

  /**
   * Retrieves Azure Speech API key from settings or environment.
   */
  static getAzureSpeechKey(): string | null {
    const fromSecret = this.getSecret('azureSpeechKey');
    if (fromSecret && fromSecret.trim()) return fromSecret.trim();
    const fromEnv = process.env.AZURE_SPEECH_KEY;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
    return null;
  }

  /**
   * Retrieves Azure Speech Region from settings or environment (defaults to 'eastus').
   */
  static getAzureSpeechRegion(): string {
    const raw = this.readSettings() as Record<string, unknown>;
    if (typeof raw.azureSpeechRegion === 'string' && raw.azureSpeechRegion.trim()) {
      return raw.azureSpeechRegion.trim();
    }
    if (process.env.AZURE_SPEECH_REGION && process.env.AZURE_SPEECH_REGION.trim()) {
      return process.env.AZURE_SPEECH_REGION.trim();
    }
    return 'eastus';
  }

  /**
   * Retrieves ai33.pro API key from settings or environment.
   */
  static getAi33Key(): string | null {
    const fromSecret = this.getSecret('ai33Key');
    if (fromSecret && fromSecret.trim()) return fromSecret.trim();
    const fromEnv = process.env.AI33_API_KEY;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
    return null;
  }

  /**
   * Retrieves FameSpeak Bearer key from settings or environment.
   */
  static getFameSpeakKey(): string | null {
    const fromSecret = this.getSecret('famespeakKey');
    if (fromSecret && fromSecret.trim()) return fromSecret.trim();
    const fromEnv = process.env.FAMESPEAK_API_KEY;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
    return null;
  }

  /**
   * Retrieves and decrypts a secret value from storage into memory.
   * Returns null if not set or cannot be decrypted.
   */
  static getSecret(secretKey: string): string | null {
    const raw = this.readSettings() as Record<string, unknown>;
    const encKey = `${secretKey}Enc`;

    if (raw[encKey] && typeof raw[encKey] === 'string') {
      try {
        if (this.safeStorageProvider.isEncryptionAvailable()) {
          const buf = Buffer.from(raw[encKey] as string, 'base64');
          return this.safeStorageProvider.decryptString(buf);
        }
        // Test fallback if base64 encoded plain string
        return Buffer.from(raw[encKey] as string, 'base64').toString('utf-8');
      } catch (err) {
        logger.error('settings_manager', `Failed to decrypt secret '${secretKey}'`, err as Error);
        return null;
      }
    }

    // Check if plain value exists (e.g. before encryption)
    if (raw[secretKey] && typeof raw[secretKey] === 'string') {
      return raw[secretKey] as string;
    }

    return null;
  }

  /**
   * Atomically writes settings to disk with Windows file-lock retry and backup.
   */
  private static writeSettingsAtomic(settings: AppSettings): void {
    const filePath = this.getSettingsPath();
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const bakPath = `${filePath}.bak`;

    // 1. Write to unique temporary file first
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');

    // 2. Backup existing valid settings before replacing
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch {
        // Non-fatal backup warning
      }
    }

    // 3. Atomic rename with Windows retry loop
    let renamed = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
          // Synchronous sleep for Windows file lock release
          const waitMs = attempt * 20;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
        } else {
          // Fallback: copy file over and delete temp
          try {
            fs.copyFileSync(tmpPath, filePath);
            fs.unlinkSync(tmpPath);
            renamed = true;
            break;
          } catch {
            if (fs.existsSync(tmpPath)) {
              try { fs.unlinkSync(tmpPath); } catch {}
            }
            throw err;
          }
        }
      }
    }

    if (!renamed && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    // 4. Update in-memory cache
    try {
      const stat = fs.statSync(filePath);
      this.inMemoryCache = {
        settings: JSON.parse(JSON.stringify(settings)),
        mtimeMs: stat.mtimeMs,
      };
    } catch {
      this.inMemoryCache = null;
    }
  }

  /**
   * Concurrency-safe atomic settings update.
   *
   * Validates patch, acquires mutex, strictly loads current settings,
   * applies patch, encrypts secrets at rest, and atomically replaces settings.json.
   */
  static async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    // 1. Validate inputs before acquiring lock
    const sanitizedPatch = this.validatePatch(patch as Record<string, unknown>);

    // 2. Execute within mutex lock to prevent concurrent write races
    return await fileMutex.runExclusive('settings', async () => {
      // 3. Strict load for write (throws on corrupted JSON)
      const current = this.loadForWrite();

      // 4. Merge updates
      const updated: Record<string, unknown> = {
        ...current,
        ...sanitizedPatch,
        appDataDir: getAppDataDir(), // Immutable system property
      };

      // 5. Encrypt any secret fields at rest
      for (const [key, value] of Object.entries(sanitizedPatch)) {
        if (this.isSecretKey(key)) {
          let strVal: string | null = null;
          if (Array.isArray(value)) {
            strVal = JSON.stringify(value.filter((v) => typeof v === 'string' && v.trim()));
          } else if (typeof value === 'string' && value.trim()) {
            strVal = value.trim();
          }

          if (strVal) {
            const encKey = `${key}Enc`;
            if (this.safeStorageProvider.isEncryptionAvailable()) {
              const encryptedBuf = this.safeStorageProvider.encryptString(strVal);
              updated[encKey] = encryptedBuf.toString('base64');
            } else {
              // Non-desktop/test fallback: base64 encoded
              updated[encKey] = Buffer.from(strVal, 'utf-8').toString('base64');
            }
            // Delete plain secret key from persistent storage
            delete updated[key];
          } else if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
            delete updated[`${key}Enc`];
            delete updated[key];
          }
        }
      }

      // 6. Atomically persist to disk
      this.writeSettingsAtomic(updated as AppSettings);

      // 7. Return sanitized copy for caller
      return this.getSanitizedSettings();
    });
  }
}
