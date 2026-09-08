import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressEstimator } from '../main/execution/ProgressEstimator';
import { generationEventBus } from '../main/events/GenerationEventBus';
import type { JobProgressEvent } from '../shared/types';

describe('ProgressEstimator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    generationEventBus.removeAllListeners();
  });

  describe('Model-specific duration estimation', () => {
    it('returns correct baselines for image models', () => {
      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'image', modelName: 'Nano Banana 2 Lite',
      })).toBe(10);

      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'image', modelName: 'Nano Banana 2',
      })).toBe(14);

      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'image', modelName: 'Nano Banana Pro',
      })).toBe(18);
    });

    it('returns correct baselines for video models and resolutions', () => {
      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'video', modelName: 'Omni 1.1 Flash', resolution: '360p',
      })).toBe(35);

      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'video', modelName: 'Omni 1.1 Flash', resolution: '720p',
      })).toBe(65);

      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'video', modelName: 'Veo 3.1 Fast',
      })).toBe(70);

      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'video', modelName: 'Veo 3.1 Lite',
      })).toBe(65);

      expect(ProgressEstimator.getEstimatedDuration({
        jobId: 'j1', projectId: 'p1', promptId: 'pr1', slotIndex: 0,
        promptType: 'video', modelName: 'Veo 3.1 Quality',
      })).toBe(95);
    });
  });

  describe('Lifecycle and Progress Curve', () => {
    it('emits initial progress and monotonically increases smoothly without exceeding 93% while generating', () => {
      const events: JobProgressEvent[] = [];
      generationEventBus.onTyped('job:progress', (ev) => {
        if (ev.jobId === 'test_job_1') {
          events.push(ev);
        }
      });

      const estimator = new ProgressEstimator({
        jobId: 'test_job_1',
        projectId: 'proj_1',
        promptId: 'prompt_1',
        slotIndex: 0,
        promptType: 'image',
        modelName: 'Nano Banana 2', // 14s duration
      });

      estimator.start();

      expect(events.length).toBe(1);
      expect(events[0].progressPercent).toBe(5);
      expect(events[0].stage).toBe('generating');

      // Advance by 5 seconds (approx 35% of baseline)
      vi.advanceTimersByTime(5000);
      expect(events.length).toBeGreaterThan(1);
      const midProgress = events[events.length - 1].progressPercent;
      expect(midProgress).toBeGreaterThan(5);
      expect(midProgress).toBeLessThan(90);

      // Advance well past baseline (e.g. 40 seconds total)
      vi.advanceTimersByTime(35000);
      const lateProgress = events[events.length - 1].progressPercent;
      // Must hold in high-80s/low-90s, capped at 93%
      expect(lateProgress).toBeGreaterThanOrEqual(85);
      expect(lateProgress).toBeLessThanOrEqual(93);

      estimator.stop();
    });

    it('transitions immediately to 96% and downloading stage upon media detection', () => {
      const events: JobProgressEvent[] = [];
      generationEventBus.onTyped('job:progress', (ev) => {
        if (ev.jobId === 'test_job_2') {
          events.push(ev);
        }
      });

      const estimator = new ProgressEstimator({
        jobId: 'test_job_2',
        projectId: 'proj_1',
        promptId: 'prompt_2',
        slotIndex: 1,
        promptType: 'video',
        modelName: 'Omni 1.1 Flash',
      });

      estimator.start();
      vi.advanceTimersByTime(2000);

      estimator.setDownloading('Downloading generated media in background...');

      const lastEvent = events[events.length - 1];
      expect(lastEvent.progressPercent).toBe(96);
      expect(lastEvent.stage).toBe('downloading');
      expect(lastEvent.stepDescription).toContain('Downloading');

      // Further time should not change percentage or stage
      vi.advanceTimersByTime(5000);
      expect(events[events.length - 1].progressPercent).toBe(96);

      estimator.stop();
    });

    it('completes at 100% strictly upon disk verification', () => {
      const events: JobProgressEvent[] = [];
      generationEventBus.onTyped('job:progress', (ev) => {
        if (ev.jobId === 'test_job_3') {
          events.push(ev);
        }
      });

      const estimator = new ProgressEstimator({
        jobId: 'test_job_3',
        projectId: 'proj_1',
        promptId: 'prompt_3',
        slotIndex: 2,
        promptType: 'video',
      });

      estimator.start();
      estimator.setDownloading();
      estimator.setCompleted('Asset verified on disk');

      const lastEvent = events[events.length - 1];
      expect(lastEvent.progressPercent).toBe(100);
      expect(lastEvent.stage).toBe('completed');
      expect(lastEvent.status).toBe('completed');
      expect(lastEvent.stepDescription).toBe('Asset verified on disk');
    });

    it('handles failure states gracefully', () => {
      const events: JobProgressEvent[] = [];
      generationEventBus.onTyped('job:progress', (ev) => {
        if (ev.jobId === 'test_job_4') {
          events.push(ev);
        }
      });

      const estimator = new ProgressEstimator({
        jobId: 'test_job_4',
        projectId: 'proj_1',
        promptId: 'prompt_4',
        slotIndex: 3,
        promptType: 'image',
      });

      estimator.start();
      vi.advanceTimersByTime(1200);
      estimator.setFailed('Network timeout');

      const lastEvent = events[events.length - 1];
      expect(lastEvent.stage).toBe('failed');
      expect(lastEvent.status).toBe('failed');
      expect(lastEvent.stepDescription).toContain('Failed: Network timeout');
    });
  });
});
