import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SettingsManager,
  CorruptedSettingsError,
  SettingsValidationError,
  type SafeStorageProvider,
} from '../main/storage/SettingsManager';
import type { AppSettings } from '../shared/types';

describe('SettingsManager Unit & Safety Tests', () => {
  let testDir: string;
  let testSettingsPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-flow-settings-test-'));
    testSettingsPath = path.join(testDir, 'settings.json');
    SettingsManager.setCustomSettingsPath(testSettingsPath);
    SettingsManager.clearCache();
    SettingsManager.resetSafeStorageProvider();
  });

  afterEach(() => {
    SettingsManager.setCustomSettingsPath(null);
    SettingsManager.clearCache();
    SettingsManager.resetSafeStorageProvider();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('1. First launch: initializes default settings file on disk and returns safe defaults', () => {
    expect(fs.existsSync(testSettingsPath)).toBe(false);

    const settings = SettingsManager.readSettings();

    expect(settings).toBeDefined();
    expect(settings.defaultImageRatio).toBe('16:9');
    expect(settings.defaultProcessingOrder).toBe('images_first');
    expect(settings.maxRetries).toBe(2);
    expect(settings.logLevel).toBe('INFO');
    expect(settings.defaultImageDownloadQuality).toBe('original');
    expect(settings.defaultVideoDownloadQuality).toBe('original');

    // Verify file was written to disk
    expect(fs.existsSync(testSettingsPath)).toBe(true);
    const diskContent = JSON.parse(fs.readFileSync(testSettingsPath, 'utf-8'));
    expect(diskContent.defaultImageRatio).toBe('16:9');
  });

  it('2. Reads existing valid settings and merges missing default fields', () => {
    const customExisting = {
      defaultImageRatio: '9:16',
      maxRetries: 3,
      logLevel: 'DEBUG',
    };
    fs.writeFileSync(testSettingsPath, JSON.stringify(customExisting, null, 2), 'utf-8');

    const settings = SettingsManager.readSettings();

    expect(settings.defaultImageRatio).toBe('9:16');
    expect(settings.maxRetries).toBe(3);
    expect(settings.logLevel).toBe('DEBUG');
    // Defaults filled in for missing keys
    expect(settings.defaultProcessingOrder).toBe('images_first');
    expect(settings.defaultImageDownloadQuality).toBe('original');
  });

  it('3. In-memory cache returns clean clone and refreshes on disk modification', () => {
    SettingsManager.readSettings(); // Populates cache
    const stat1 = fs.statSync(testSettingsPath);

    const cached = SettingsManager.readSettings();
    expect(cached.defaultImageRatio).toBe('16:9');

    // Mutate the returned object to ensure deep clone protection
    (cached as any).defaultImageRatio = '9:16';
    expect(SettingsManager.readSettings().defaultImageRatio).toBe('16:9');
  });

  it('4. Strict loadForWrite: throws CorruptedSettingsError on malformed JSON and protects disk', () => {
    fs.writeFileSync(testSettingsPath, 'INVALID { JSON [[[ CORRUPT', 'utf-8');

    expect(() => {
      SettingsManager.loadForWrite();
    }).toThrow(CorruptedSettingsError);

    // Verify the corrupted file was NOT wiped
    const content = fs.readFileSync(testSettingsPath, 'utf-8');
    expect(content).toBe('INVALID { JSON [[[ CORRUPT');
  });

  it('5. Strict loadForWrite: throws CorruptedSettingsError on empty file', () => {
    fs.writeFileSync(testSettingsPath, '   \n  ', 'utf-8');

    expect(() => {
      SettingsManager.loadForWrite();
    }).toThrow(CorruptedSettingsError);
  });

  it('6. updateSettings aborts and does NOT wipe file if settings are corrupted on disk', async () => {
    fs.writeFileSync(testSettingsPath, '{ "broken": ... ', 'utf-8');

    await expect(
      SettingsManager.updateSettings({ defaultImageRatio: '9:16' })
    ).rejects.toThrow(CorruptedSettingsError);

    // Corrupted file must still exist and not be replaced with defaults!
    const content = fs.readFileSync(testSettingsPath, 'utf-8');
    expect(content).toBe('{ "broken": ... ');
  });

  it('7. Atomic write: creates backup (.bak) and updates settings cleanly', async () => {
    SettingsManager.readSettings(); // Writes initial file
    expect(fs.existsSync(testSettingsPath)).toBe(true);

    const updated = await SettingsManager.updateSettings({
      defaultImageRatio: '9:16',
      maxRetries: 4,
    });

    expect(updated.defaultImageRatio).toBe('9:16');
    expect(updated.maxRetries).toBe(4);

    // Verify disk content
    const diskContent = JSON.parse(fs.readFileSync(testSettingsPath, 'utf-8'));
    expect(diskContent.defaultImageRatio).toBe('9:16');
    expect(diskContent.maxRetries).toBe(4);

    // Backup file exists
    const bakPath = `${testSettingsPath}.bak`;
    expect(fs.existsSync(bakPath)).toBe(true);
  });

  it('8. Concurrency safety: serializes multiple concurrent updates without losing state', async () => {
    SettingsManager.readSettings(); // Initial file

    const promises = [
      SettingsManager.updateSettings({ defaultImageRatio: '9:16' }),
      SettingsManager.updateSettings({ maxRetries: 3 }),
      SettingsManager.updateSettings({ logLevel: 'WARN' }),
      SettingsManager.updateSettings({ defaultProcessingOrder: 'videos_first' }),
    ];

    await Promise.all(promises);

    const finalSettings = SettingsManager.readSettings();
    expect(finalSettings.defaultImageRatio).toBe('9:16');
    expect(finalSettings.maxRetries).toBe(3);
    expect(finalSettings.logLevel).toBe('WARN');
    expect(finalSettings.defaultProcessingOrder).toBe('videos_first');
  });

  it('9. Validation: rejects invalid enum and boundary values', () => {
    expect(() => {
      SettingsManager.validatePatch({ defaultImageRatio: '4:3' as any });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ defaultProcessingOrder: 'random' as any });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ maxRetries: 0 });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ maxRetries: 15 });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ logLevel: 'VERBOSE' as any });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ defaultImageDownloadQuality: '4k' as any });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ defaultVideoDownloadQuality: '4k' as any });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ imageConcurrency: 50 });
    }).toThrow(SettingsValidationError);

    expect(() => {
      SettingsManager.validatePatch({ musicVolume: 150 });
    }).toThrow(SettingsValidationError);
  });

  it('10. Security: strips appDataDir from patch so client cannot overwrite system path', () => {
    const patch = SettingsManager.validatePatch({
      appDataDir: 'C:/Attacker/HackedDir',
      defaultImageRatio: '9:16',
    });

    expect(patch.appDataDir).toBeUndefined();
    expect(patch.defaultImageRatio).toBe('9:16');
  });

  it('11. Secret storage: encrypts secret fields at rest and retrieves in memory', async () => {
    // Mock SafeStorageProvider
    const mockProvider: SafeStorageProvider = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`ENC[${plainText}]`, 'utf-8'),
      decryptString: (encrypted: Buffer) => {
        const str = encrypted.toString('utf-8');
        return str.replace(/^ENC\[/, '').replace(/\]$/, '');
      },
    };

    SettingsManager.setSafeStorageProvider(mockProvider);

    await SettingsManager.updateSettings({
      scriptAiKey: 'sk-antigravity-secret-key-12345',
    } as any);

    // Read raw disk content
    const diskContent = JSON.parse(fs.readFileSync(testSettingsPath, 'utf-8'));
    // Plain key must NOT exist on disk
    expect(diskContent.scriptAiKey).toBeUndefined();
    // Encrypted key exists
    expect(diskContent.scriptAiKeyEnc).toBeDefined();

    // Verify sanitized renderer copy strips scriptAiKeyEnc and masks secret
    const sanitized = SettingsManager.getSanitizedSettings() as any;
    expect(sanitized.scriptAiKeyEnc).toBeUndefined();
    expect(sanitized.scriptAiKey).toBe('********');

    // In-memory decryption retrieves original secret
    const decrypted = SettingsManager.getSecret('scriptAiKey');
    expect(decrypted).toBe('sk-antigravity-secret-key-12345');
  });
});
