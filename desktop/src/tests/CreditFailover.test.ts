import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreditFailureDetector } from '../main/engine/CreditFailureDetector';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import type { ProfileWorker } from '../main/scheduler/ProfileWorker';
import type { Page } from 'playwright';

describe('CreditFailureDetector & Safe Failover Tests', () => {
  describe('CreditFailureDetector Classifications', () => {
    it('should accurately classify credit exhaustion from page DOM', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          classification: 'credit_exhausted',
          evidence: 'You do not have enough credits to generate this video.',
          source: 'dom_alert',
        }),
      } as unknown as Page;

      const result = await CreditFailureDetector.detectFromPage(mockPage);
      expect(result).not.toBeNull();
      expect(result?.classification).toBe('credit_exhausted');
    });

    it('should accurately classify quota exhaustion from page DOM', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          classification: 'quota_exhausted',
          evidence: 'Daily generation quota limit reached.',
          source: 'dom_alert',
        }),
      } as unknown as Page;

      const result = await CreditFailureDetector.detectFromPage(mockPage);
      expect(result).not.toBeNull();
      expect(result?.classification).toBe('quota_exhausted');
    });

    it('should accurately classify auth required', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          classification: 'auth_required',
          evidence: 'Sign in with Google to continue',
          source: 'dom_alert',
        }),
      } as unknown as Page;

      const result = await CreditFailureDetector.detectFromPage(mockPage);
      expect(result).not.toBeNull();
      expect(result?.classification).toBe('auth_required');
    });

    it('should classify network error payload with RESOURCE_EXHAUSTED', () => {
      const result = CreditFailureDetector.detectFromNetwork(
        429,
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Out of credits for user account',
          },
        })
      );
      expect(result).not.toBeNull();
      expect(result?.classification).toBe('credit_exhausted');
    });

    it('should NOT classify generic timeout or 403 alone as credit exhaustion', () => {
      const result1 = CreditFailureDetector.detectFromNetwork(403, 'Forbidden');
      expect(result1).toBeNull();

      const classification2 = CreditFailureDetector.classifyErrorText('Video generation timed out after 360s. No new video media detected.');
      expect(classification2).toBe('timeout');
    });
  });

  describe('WorkerPool Memory Quarantine', () => {
    let pool: WorkerPool;

    beforeEach(() => {
      pool = new WorkerPool();
      // Register two mock workers
      const mockWorkerA = {
        profileId: 'profile_A',
        isAvailable: true,
        isAtCapacity: false,
        activeJobCount: 0,
        maxConcurrentJobs: 1,
      } as unknown as ProfileWorker;

      const mockWorkerB = {
        profileId: 'profile_B',
        isAvailable: true,
        isAtCapacity: false,
        activeJobCount: 0,
        maxConcurrentJobs: 1,
      } as unknown as ProfileWorker;

      pool.registerWorker(mockWorkerA);
      pool.registerWorker(mockWorkerB);
    });

    it('should exclude quarantined profiles from available workers', () => {
      expect(pool.isQuarantined('profile_A')).toBe(false);

      pool.quarantineProfile('profile_A', 'credit_exhausted', 3600000, 'Insufficient credits for I2V');
      expect(pool.isQuarantined('profile_A')).toBe(true);

      const available = pool.getAvailableWorker();
      expect(available?.profileId).toBe('profile_B');
    });

    it('should return null when all workers are quarantined', () => {
      pool.quarantineProfile('profile_A', 'credit_exhausted', 3600000, 'Out of credits');
      pool.quarantineProfile('profile_B', 'quota_exhausted', 3600000, 'Out of quota');

      expect(pool.isQuarantined('profile_A')).toBe(true);
      expect(pool.isQuarantined('profile_B')).toBe(true);

      const available = pool.getAvailableWorker();
      expect(available).toBeNull();
    });

    it('should lift quarantine when manually requested or expired', () => {
      pool.quarantineProfile('profile_A', 'credit_exhausted', 3600000, 'Out of credits');
      expect(pool.isQuarantined('profile_A')).toBe(true);

      pool.liftQuarantine('profile_A');
      expect(pool.isQuarantined('profile_A')).toBe(false);
    });
  });
});
