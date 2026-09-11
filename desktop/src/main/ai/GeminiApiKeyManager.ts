/**
 * GeminiApiKeyManager – Centralized coordinator for Google Gemini API keys.
 *
 * Implements production-grade key management:
 *  1. Multi-key pool with no artificial small limit (1, 5, 10, 50, etc.).
 *  2. Idempotent legacy migration from `geminiApiKey`, `scriptAiKey`, `scriptAiKeys`.
 *  3. Race-safe concurrent round-robin load balancing across healthy keys.
 *  4. Health tracking with automatic quarantine cooldowns (429, 503, transient errors).
 *  5. Automatic eligibility restoration upon cooldown expiry.
 *  6. Zero secret leaks: masks keys in summaries and logs; persists encrypted at rest.
 */

import * as crypto from 'crypto';
import { SettingsManager } from '../storage/SettingsManager';
import type { GeminiKeyStatus, GeminiKeySummary } from '../../shared/types';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface ManagedGeminiKey {
  id: string;
  key: string;
  masked: string;
  status: GeminiKeyStatus;
  cooldownUntil?: number | null;
  lastUsedAt?: number | null;
  failureCount: number;
  lastFailureReason?: string;
}

export class GeminiApiKeyManager {
  private static instance: GeminiApiKeyManager | null = null;
  private keys: ManagedGeminiKey[] = [];
  private roundRobinIndex = 0;
  private initialized = false;

  private constructor() {}

  public static getInstance(): GeminiApiKeyManager {
    if (!this.instance) {
      this.instance = new GeminiApiKeyManager();
    }
    return this.instance;
  }

  /**
   * Resets the singleton instance (primarily for isolated test suites).
   */
  public static resetInstance(): void {
    if (this.instance) {
      this.instance.keys = [];
      this.instance.roundRobinIndex = 0;
      this.instance.initialized = false;
    }
    this.instance = null;
  }

  /**
   * Masks an API key for safe display and logging.
   * e.g. "AIzaSyD-1234567890abcdef" -> "••••••••••••cdef"
   */
  public static maskKey(key: string): string {
    if (!key || typeof key !== 'string') return '••••••••';
    const trimmed = key.trim();
    if (trimmed.length <= 8) return '••••••••';
    const last4 = trimmed.slice(-4);
    return `••••••••••••${last4}`;
  }

  /**
   * Generates a stable unique ID for a key based on its SHA-256 hash prefix.
   */
  public static generateKeyId(key: string): string {
    const hash = crypto.createHash('sha256').update(key.trim()).digest('hex');
    return `gemini-key-${hash.slice(0, 10)}`;
  }

  /**
   * Initializes the key manager from storage, executing legacy migration idempotently.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('gemini_keys', 'Initializing GeminiApiKeyManager and migrating legacy keys...');
    await this.loadAndMigrate();
    this.initialized = true;
  }

  /**
   * Loads keys from SettingsManager, migrating any legacy single-key entries
   * into the centralized multi-key storage without duplication.
   */
  public async loadAndMigrate(): Promise<void> {
    const rawKeys = SettingsManager.getScriptAiKeys();
    const uniqueKeys: string[] = [];

    for (const k of rawKeys) {
      if (typeof k === 'string') {
        const trimmed = k.trim();
        if (trimmed && !uniqueKeys.includes(trimmed)) {
          uniqueKeys.push(trimmed);
        }
      }
    }

    // Preserve status of already tracked keys if reloading
    const existingMap = new Map<string, ManagedGeminiKey>();
    for (const mk of this.keys) {
      existingMap.set(mk.key, mk);
    }

    this.keys = uniqueKeys.map((key) => {
      const existing = existingMap.get(key);
      if (existing) {
        return existing;
      }
      return {
        id: GeminiApiKeyManager.generateKeyId(key),
        key,
        masked: GeminiApiKeyManager.maskKey(key),
        status: 'healthy',
        failureCount: 0,
      };
    });

    // Save back if migration unified new keys
    const currentStored = SettingsManager.getSecret('scriptAiKeys');
    let needsSave = false;
    try {
      const parsed = currentStored ? JSON.parse(currentStored) : [];
      if (!Array.isArray(parsed) || parsed.length !== uniqueKeys.length) {
        needsSave = true;
      }
    } catch {
      needsSave = true;
    }

    if (needsSave && uniqueKeys.length > 0) {
      await SettingsManager.saveScriptAiKeys(uniqueKeys);
      logger.info('gemini_keys', `Successfully migrated and persisted ${uniqueKeys.length} Gemini API keys.`);
    }
  }

  /**
   * Restores any quarantined keys whose cooldown duration has elapsed.
   */
  private restoreExpiredCooldowns(): void {
    const now = Date.now();
    for (const k of this.keys) {
      if (k.status !== 'healthy' && k.status !== 'invalid') {
        if (k.cooldownUntil && k.cooldownUntil <= now) {
          logger.info('gemini_keys', `Cooldown expired for key ${k.masked}. Restoring to healthy.`);
          k.status = 'healthy';
          k.cooldownUntil = null;
        }
      }
    }
  }

  /**
   * Returns safe sanitized summaries of all configured keys for the Settings UI.
   */
  public listKeys(): GeminiKeySummary[] {
    this.restoreExpiredCooldowns();
    return this.keys.map((k) => ({
      id: k.id,
      masked: k.masked,
      status: k.status,
      cooldownUntil: k.cooldownUntil || null,
      lastUsedAt: k.lastUsedAt || null,
      failureCount: k.failureCount,
    }));
  }

  /**
   * Adds a new API key to the pool and saves it encrypted at rest.
   */
  public async addKey(rawKey: string): Promise<{ success: boolean; error?: string }> {
    if (!rawKey || typeof rawKey !== 'string') {
      return { success: false, error: 'API key cannot be empty.' };
    }

    const trimmed = rawKey.trim();
    if (!trimmed) {
      return { success: false, error: 'API key cannot be blank.' };
    }

    if (this.keys.some((k) => k.key === trimmed)) {
      return { success: false, error: 'This Gemini API key is already added.' };
    }

    const newKey: ManagedGeminiKey = {
      id: GeminiApiKeyManager.generateKeyId(trimmed),
      key: trimmed,
      masked: GeminiApiKeyManager.maskKey(trimmed),
      status: 'healthy',
      failureCount: 0,
    };

    this.keys.push(newKey);
    const plainKeys = this.keys.map((k) => k.key);
    await SettingsManager.saveScriptAiKeys(plainKeys);

    logger.info('gemini_keys', `Added new Gemini API key: ${newKey.masked} (total keys: ${this.keys.length})`);
    return { success: true };
  }

  /**
   * Removes a specific key from the pool by ID and updates persistent storage.
   */
  public async removeKey(id: string): Promise<{ success: boolean }> {
    const initialLength = this.keys.length;
    this.keys = this.keys.filter((k) => k.id !== id);

    if (this.keys.length !== initialLength) {
      const plainKeys = this.keys.map((k) => k.key);
      await SettingsManager.saveScriptAiKeys(plainKeys);
      logger.info('gemini_keys', `Removed Gemini API key ID: ${id} (remaining keys: ${this.keys.length})`);
    }

    return { success: true };
  }

  /**
   * Explicitly reveals the plaintext key for a given ID (user action only).
   */
  public revealKey(id: string): string | null {
    const found = this.keys.find((k) => k.id === id);
    return found ? found.key : null;
  }

  /**
   * Selects the next healthy key in the pool using race-safe round-robin load balancing.
   * If a currently active key fails, caller can pass excludeId to prevent picking it again.
   */
  public getNextKey(excludeId?: string): { id: string; key: string; masked: string } | null {
    this.restoreExpiredCooldowns();

    if (this.keys.length === 0) {
      return null;
    }

    // Filter candidate keys
    let candidates = this.keys.filter((k) => k.status === 'healthy');
    if (excludeId && candidates.length > 1) {
      candidates = candidates.filter((k) => k.id !== excludeId);
    }

    // If all keys are in cooldown, pick the key with the earliest expiring cooldown as fallback
    if (candidates.length === 0) {
      const nonInvalid = this.keys.filter((k) => k.status !== 'invalid');
      if (nonInvalid.length === 0) {
        logger.warn('gemini_keys', 'All configured Gemini API keys are marked invalid.');
        return null;
      }
      nonInvalid.sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0));
      const fallback = nonInvalid[0];
      logger.warn('gemini_keys', `All keys in cooldown. Using earliest expiring key: ${fallback.masked}`);
      fallback.lastUsedAt = Date.now();
      return { id: fallback.id, key: fallback.key, masked: fallback.masked };
    }

    // Round-robin selection
    const index = Math.abs(this.roundRobinIndex++) % candidates.length;
    const selected = candidates[index];
    selected.lastUsedAt = Date.now();

    return {
      id: selected.id,
      key: selected.key,
      masked: selected.masked,
    };
  }

  /**
   * Records a key failure and applies appropriate quarantine / cooldown.
   *
   * @param keyId Unique key ID
   * @param status Failure status classification
   * @param reason Human-readable failure reason (safe, no secret values)
   * @param cooldownMs Duration in ms to quarantine key
   */
  public recordFailure(
    keyId: string,
    status: GeminiKeyStatus,
    reason: string,
    cooldownMs = 60000
  ): void {
    const key = this.keys.find((k) => k.id === keyId);
    if (!key) return;

    key.failureCount++;
    key.status = status;
    key.lastFailureReason = reason;

    if (status === 'quota_limited' || status === 'temporarily_unavailable') {
      key.cooldownUntil = Date.now() + Math.max(cooldownMs, 5000);
      logger.warn('gemini_keys', `Quarantined key ${key.masked} until ${new Date(key.cooldownUntil).toISOString()} (${reason})`);
    } else if (status === 'invalid') {
      logger.error('gemini_keys', `Key ${key.masked} marked invalid (${reason}). Skipped until corrected.`);
    }
  }

  /**
   * Records a successful operation using a key, resetting failure counters.
   */
  public recordSuccess(keyId: string): void {
    const key = this.keys.find((k) => k.id === keyId);
    if (!key) return;

    key.status = 'healthy';
    key.failureCount = 0;
    key.cooldownUntil = null;
  }

  /**
   * Returns count of currently configured keys.
   */
  public getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Returns count of currently healthy keys.
   */
  public getHealthyKeyCount(): number {
    this.restoreExpiredCooldowns();
    return this.keys.filter((k) => k.status === 'healthy').length;
  }

  /**
   * Direct manual injection of keys (for test isolation).
   */
  public setKeysForTesting(keys: string[]): void {
    this.keys = keys.map((k) => ({
      id: GeminiApiKeyManager.generateKeyId(k),
      key: k,
      masked: GeminiApiKeyManager.maskKey(k),
      status: 'healthy',
      failureCount: 0,
    }));
    this.roundRobinIndex = 0;
    this.initialized = true;
  }
}
