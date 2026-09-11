/**
 * GeminiApiKeyManager.test.ts – Comprehensive automated tests for GeminiApiKeyManager.
 *
 * Tests:
 *  1. Multi-key pool capacity (1, 5, 50 keys, zero arbitrary low limits).
 *  2. Duplicate key prevention (exact and trimmed duplicates rejected).
 *  3. Empty/blank key validation.
 *  4. Key removal and persistence.
 *  5. Secret masking & leak prevention (safe masked summaries, plaintext reveal on-demand only).
 *  6. Idempotent legacy migration from SettingsManager.
 *  7. Race-safe round-robin selection across healthy keys.
 *  8. Exclusion during failover (excludeId).
 *  9. Health status transitions (healthy, quota_limited, temporarily_unavailable, invalid).
 * 10. Automatic quarantine cooldown and eligibility restoration upon expiry.
 * 11. Cooldown fallback when all keys are rate-limited.
 * 12. Full failure when all keys are invalid.
 * 13. Success recording resets counters and cooldowns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiApiKeyManager } from '../main/ai/GeminiApiKeyManager';
import { SettingsManager } from '../main/storage/SettingsManager';

vi.mock('../main/storage/SettingsManager', () => ({
  SettingsManager: {
    getScriptAiKeys: vi.fn().mockReturnValue([]),
    getSecret: vi.fn().mockReturnValue(null),
    saveScriptAiKeys: vi.fn().mockResolvedValue({}),
  },
}));

describe('GeminiApiKeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    GeminiApiKeyManager.resetInstance();
  });

  afterEach(() => {
    GeminiApiKeyManager.resetInstance();
  });

  describe('1. Key Addition and Pool Sizing', () => {
    it('supports adding multiple keys without artificial limits (1, 5, 50 keys)', async () => {
      const manager = GeminiApiKeyManager.getInstance();

      // Add 1st key
      const res1 = await manager.addKey('AIzaSyKey001_Alpha');
      expect(res1.success).toBe(true);
      expect(manager.getKeyCount()).toBe(1);

      // Add up to 5 keys
      for (let i = 2; i <= 5; i++) {
        const res = await manager.addKey(`AIzaSyKey00${i}_PoolTest`);
        expect(res.success).toBe(true);
      }
      expect(manager.getKeyCount()).toBe(5);

      // Add up to 50 keys to prove no small limit
      for (let i = 6; i <= 50; i++) {
        const res = await manager.addKey(`AIzaSyKey0${i < 10 ? '0' + i : i}_HighScalePool`);
        expect(res.success).toBe(true);
      }
      expect(manager.getKeyCount()).toBe(50);
      expect(SettingsManager.saveScriptAiKeys).toHaveBeenCalledTimes(50);
    });

    it('rejects duplicate keys (exact and whitespace-padded)', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('AIzaSyUniqueKey12345');

      const dup1 = await manager.addKey('AIzaSyUniqueKey12345');
      expect(dup1.success).toBe(false);
      expect(dup1.error).toMatch(/already added/i);

      const dup2 = await manager.addKey('  AIzaSyUniqueKey12345  ');
      expect(dup2.success).toBe(false);
      expect(dup2.error).toMatch(/already added/i);

      expect(manager.getKeyCount()).toBe(1);
    });

    it('rejects empty, blank, or invalid keys', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      const emptyRes = await manager.addKey('');
      expect(emptyRes.success).toBe(false);

      const blankRes = await manager.addKey('   ');
      expect(blankRes.success).toBe(false);

      const nonStringRes = await manager.addKey(null as any);
      expect(nonStringRes.success).toBe(false);

      expect(manager.getKeyCount()).toBe(0);
    });
  });

  describe('2. Key Removal and Plaintext Reveal', () => {
    it('removes keys by ID and persists the updated pool', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('AIzaSyKeyA_111111');
      await manager.addKey('AIzaSyKeyB_222222');
      expect(manager.getKeyCount()).toBe(2);

      const list = manager.listKeys();
      const targetId = list[0].id;

      const removeRes = await manager.removeKey(targetId);
      expect(removeRes.success).toBe(true);
      expect(manager.getKeyCount()).toBe(1);
      expect(manager.listKeys().find((k) => k.id === targetId)).toBeUndefined();
      expect(SettingsManager.saveScriptAiKeys).toHaveBeenLastCalledWith(['AIzaSyKeyB_222222']);
    });

    it('reveals plaintext key only when explicitly queried by ID', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('AIzaSySecretPlaintext999');

      const list = manager.listKeys();
      const keyId = list[0].id;

      expect(manager.revealKey(keyId)).toBe('AIzaSySecretPlaintext999');
      expect(manager.revealKey('non_existent_id')).toBeNull();
    });
  });

  describe('3. Masking and Secret Protection', () => {
    it('masks keys preserving only the last 4 characters', () => {
      expect(GeminiApiKeyManager.maskKey('AIzaSyD-1234567890abcdef')).toBe('••••••••••••cdef');
      expect(GeminiApiKeyManager.maskKey('short')).toBe('••••••••');
      expect(GeminiApiKeyManager.maskKey('')).toBe('••••••••');
    });

    it('never exposes raw plaintext keys in listKeys summaries', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('AIzaSySecretPlainTextKeyXYZ');

      const summaries = manager.listKeys();
      expect(summaries).toHaveLength(1);
      expect((summaries[0] as any).key).toBeUndefined();
      expect(summaries[0].masked).toBe('••••••••••••yXYZ');
      expect(summaries[0].status).toBe('healthy');
    });
  });

  describe('4. Idempotent Legacy Migration', () => {
    it('migrates legacy single and array keys from SettingsManager without duplicates', async () => {
      vi.mocked(SettingsManager.getScriptAiKeys).mockReturnValue([
        'AIzaSyLegacyKey1',
        'AIzaSyLegacyKey2',
        '  AIzaSyLegacyKey1  ', // duplicate with whitespace
      ]);

      const manager = GeminiApiKeyManager.getInstance();
      await manager.initialize();

      expect(manager.getKeyCount()).toBe(2);
      const summaries = manager.listKeys();
      expect(summaries[0].status).toBe('healthy');
      expect(summaries[1].status).toBe('healthy');
      expect(SettingsManager.saveScriptAiKeys).toHaveBeenCalledWith([
        'AIzaSyLegacyKey1',
        'AIzaSyLegacyKey2',
      ]);
    });
  });

  describe('5. Round-Robin Load Balancing and Exclusion', () => {
    it('distributes requests across healthy keys using round-robin', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Alpha_1111');
      await manager.addKey('Key_Beta_2222');
      await manager.addKey('Key_Gamma_3333');

      const k1 = manager.getNextKey();
      const k2 = manager.getNextKey();
      const k3 = manager.getNextKey();
      const k4 = manager.getNextKey();

      expect(k1?.key).toBe('Key_Alpha_1111');
      expect(k2?.key).toBe('Key_Beta_2222');
      expect(k3?.key).toBe('Key_Gamma_3333');
      expect(k4?.key).toBe('Key_Alpha_1111'); // wraps around
    });

    it('skips excluded key during failover when multiple healthy keys exist', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Alpha_1111');
      await manager.addKey('Key_Beta_2222');

      const keyA = manager.listKeys()[0];
      const selected = manager.getNextKey(keyA.id);

      expect(selected?.key).toBe('Key_Beta_2222');
    });

    it('returns null when no keys are configured', () => {
      const manager = GeminiApiKeyManager.getInstance();
      expect(manager.getNextKey()).toBeNull();
    });
  });

  describe('6. Health Tracking, Quarantine, and Cooldown Restoration', () => {
    it('quarantines quota_limited key with cooldown and skips it during selection', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Healthy_1');
      await manager.addKey('Key_Quota_2');

      const keys = manager.listKeys();
      const quotaKeyId = keys.find((k) => k.masked.includes('ta_2'))!.id;

      // Mark 429 quota exhaustion with 30s cooldown
      manager.recordFailure(quotaKeyId, 'quota_limited', 'HTTP 429 Quota Exceeded', 30000);

      const summary = manager.listKeys().find((k) => k.id === quotaKeyId);
      expect(summary?.status).toBe('quota_limited');
      expect(summary?.cooldownUntil).toBeGreaterThan(Date.now());
      expect(summary?.failureCount).toBe(1);

      // getNextKey should now consistently pick only the healthy key
      const next1 = manager.getNextKey();
      const next2 = manager.getNextKey();
      expect(next1?.key).toBe('Key_Healthy_1');
      expect(next2?.key).toBe('Key_Healthy_1');
    });

    it('marks invalid key and completely skips it', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Valid');
      await manager.addKey('Key_BadAuth');

      const keys = manager.listKeys();
      const badKeyId = keys.find((k) => k.masked.includes('Auth'))!.id;

      // Mark 401/403 invalid key
      manager.recordFailure(badKeyId, 'invalid', 'HTTP 401 Unauthorized');

      const summary = manager.listKeys().find((k) => k.id === badKeyId);
      expect(summary?.status).toBe('invalid');
      expect(summary?.cooldownUntil).toBeNull();

      // Only valid key should be returned
      const picked = manager.getNextKey();
      expect(picked?.key).toBe('Key_Valid');
    });

    it('automatically restores quarantined key to healthy when cooldown expires', async () => {
      vi.useFakeTimers();
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Restoring');

      const keyId = manager.listKeys()[0].id;
      // Record 429 with 10s cooldown
      manager.recordFailure(keyId, 'quota_limited', 'Quota Exceeded', 10000);

      expect(manager.listKeys()[0].status).toBe('quota_limited');

      // Advance system time past cooldown (15 seconds)
      vi.setSystemTime(startTime + 15000);

      const restoredList = manager.listKeys();
      expect(restoredList[0].status).toBe('healthy');
      expect(restoredList[0].cooldownUntil).toBeNull();

      const next = manager.getNextKey();
      expect(next?.key).toBe('Key_Restoring');

      vi.useRealTimers();
    });

    it('falls back to earliest expiring key when all healthy keys are in cooldown', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Cooldown_Soon');
      await manager.addKey('Key_Cooldown_Later');

      const [k1, k2] = manager.listKeys();
      // Quarantines: k1 expires in 20s, k2 expires in 60s
      manager.recordFailure(k1.id, 'quota_limited', '429', 20000);
      manager.recordFailure(k2.id, 'quota_limited', '429', 60000);

      // Both in cooldown, should pick k1 because its cooldown is earliest
      const fallback = manager.getNextKey();
      expect(fallback?.id).toBe(k1.id);
    });

    it('returns null if all configured keys are marked invalid', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_Bad_1');
      await manager.addKey('Key_Bad_2');

      const [k1, k2] = manager.listKeys();
      manager.recordFailure(k1.id, 'invalid', '401');
      manager.recordFailure(k2.id, 'invalid', '403');

      expect(manager.getNextKey()).toBeNull();
      expect(manager.getHealthyKeyCount()).toBe(0);
    });

    it('resets failure count and status on recordSuccess', async () => {
      const manager = GeminiApiKeyManager.getInstance();
      await manager.addKey('Key_ToRecover');

      const keyId = manager.listKeys()[0].id;
      manager.recordFailure(keyId, 'temporarily_unavailable', '503 Spike', 15000);

      expect(manager.listKeys()[0].status).toBe('temporarily_unavailable');
      expect(manager.listKeys()[0].failureCount).toBe(1);

      // Now record success
      manager.recordSuccess(keyId);

      const summary = manager.listKeys()[0];
      expect(summary.status).toBe('healthy');
      expect(summary.failureCount).toBe(0);
      expect(summary.cooldownUntil).toBeNull();
    });
  });
});
