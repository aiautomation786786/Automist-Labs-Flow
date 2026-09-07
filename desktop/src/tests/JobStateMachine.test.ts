/**
 * Tests for JobStateMachine.
 *
 * Verifies valid transitions, rejection of illegal transitions, and state helpers.
 */

import { describe, it, expect } from 'vitest';
import { JobStateMachine } from '../shared/job-states';

describe('JobStateMachine', () => {
  describe('validateTransition', () => {
    it('should allow valid forward transitions', () => {
      expect(() => JobStateMachine.validateTransition('pending', 'queued')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('queued', 'assigned')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('assigned', 'starting')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('starting', 'configuring')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('configuring', 'generating')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('generating', 'waiting_for_result')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('waiting_for_result', 'downloading')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('downloading', 'completed')).not.toThrow();
    });

    it('should be idempotent when transitioning from state to same state', () => {
      expect(() => JobStateMachine.validateTransition('queued', 'queued')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('completed', 'completed')).not.toThrow();
    });

    it('should allow failure branches from in-flight states', () => {
      expect(() => JobStateMachine.validateTransition('assigned', 'failed')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('generating', 'failed')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('downloading', 'failed')).not.toThrow();
    });

    it('should allow manual_action_required from configuring, generating, waiting_for_result', () => {
      expect(() => JobStateMachine.validateTransition('configuring', 'manual_action_required')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('generating', 'manual_action_required')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('waiting_for_result', 'manual_action_required')).not.toThrow();
    });

    it('should allow cancellation from queued and starting states', () => {
      expect(() => JobStateMachine.validateTransition('queued', 'cancelled')).not.toThrow();
      expect(() => JobStateMachine.validateTransition('starting', 'cancelled')).not.toThrow();
    });

    it('REJECTS illegal transitions with descriptive error', () => {
      // Completed job cannot be restarted directly
      expect(() => JobStateMachine.validateTransition('completed', 'generating', 'job_test_01')).toThrow(
        'Illegal job state transition for job "job_test_01": cannot transition from "completed" to "generating"'
      );

      // Pending cannot jump directly to completed
      expect(() => JobStateMachine.validateTransition('pending', 'completed')).toThrow(
        'Illegal job state transition: cannot transition from "pending" to "completed"'
      );

      // Cancelled is terminal
      expect(() => JobStateMachine.validateTransition('cancelled', 'downloading')).toThrow(
        'Illegal job state transition: cannot transition from "cancelled" to "downloading"'
      );
    });
  });

  describe('canTransition', () => {
    it('should return true for legal transitions and false for illegal', () => {
      expect(JobStateMachine.canTransition('queued', 'assigned')).toBe(true);
      expect(JobStateMachine.canTransition('completed', 'queued')).toBe(false);
      expect(JobStateMachine.canTransition('downloading', 'completed')).toBe(true);
    });
  });

  describe('isTransient and isTerminal', () => {
    it('should correctly identify transient states for crash recovery', () => {
      expect(JobStateMachine.isTransient('starting')).toBe(true);
      expect(JobStateMachine.isTransient('generating')).toBe(true);
      expect(JobStateMachine.isTransient('downloading')).toBe(true);
      expect(JobStateMachine.isTransient('waiting_for_result')).toBe(true);

      expect(JobStateMachine.isTransient('pending')).toBe(false);
      expect(JobStateMachine.isTransient('completed')).toBe(false);
      expect(JobStateMachine.isTransient('failed')).toBe(false);
    });

    it('should correctly identify terminal states', () => {
      expect(JobStateMachine.isTerminal('completed')).toBe(true);
      expect(JobStateMachine.isTerminal('failed')).toBe(true);
      expect(JobStateMachine.isTerminal('cancelled')).toBe(true);

      expect(JobStateMachine.isTerminal('generating')).toBe(false);
      expect(JobStateMachine.isTerminal('queued')).toBe(false);
    });
  });
});
