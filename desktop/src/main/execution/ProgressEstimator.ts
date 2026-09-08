/**
 * ProgressEstimator – Provides model-specific estimated progress curves
 * for active Google Flow generation jobs.
 *
 * Responsibilities:
 *  - Calculates baseline expected duration based on model name, media type, and resolution.
 *  - Emits smooth asymptotic progress (5% -> ~92%) while generation is in flight.
 *  - Holds safely in the high-80s/low-90s if generation takes longer than baseline.
 *  - Transitions to 'downloading' (96%) upon media detection.
 *  - Concludes at 100% strictly upon disk verification.
 */

import { generationEventBus } from '../events/GenerationEventBus';
import type { JobProgressEvent, JobStatus } from '../../shared/types';

export interface ProgressEstimatorConfig {
  jobId: string;
  projectId: string;
  promptId: string;
  slotIndex: number;
  promptType: 'image' | 'video';
  modelName?: string;
  resolution?: string;
  durationSeconds?: number;
}

export class ProgressEstimator {
  private readonly config: ProgressEstimatorConfig;
  private readonly estimatedDurationSeconds: number;
  private readonly startTime: number;
  private timer: NodeJS.Timeout | null = null;
  private currentPercent = 5;
  private currentStage: JobProgressEvent['stage'] = 'starting';
  private isStopped = false;

  constructor(config: ProgressEstimatorConfig) {
    this.config = config;
    this.estimatedDurationSeconds = ProgressEstimator.getEstimatedDuration(config);
    this.startTime = Date.now();
  }

  /**
   * Resolves model-specific duration baseline in seconds.
   */
  static getEstimatedDuration(config: ProgressEstimatorConfig): number {
    const model = (config.modelName || '').toLowerCase();

    if (config.promptType === 'image') {
      if (model.includes('lite')) return 10;
      if (model.includes('pro')) return 18;
      return 14; // Default Nano Banana 2
    }

    // Video models
    if (model.includes('omni') || model.includes('flash')) {
      if (config.resolution === '360p') return 35;
      return 65; // Omni Flash 720p
    }
    if (model.includes('fast')) return 70;
    if (model.includes('lite')) return 65;
    if (model.includes('quality') || model.includes('veo')) return 95;

    return 60; // Default fallback
  }

  /**
   * Starts periodic progress estimation updates.
   */
  start(): void {
    this.currentStage = 'generating';
    this.emitProgress(5, 'Generating in Google Flow...');

    this.timer = setInterval(() => {
      if (this.isStopped) return;

      const elapsed = (Date.now() - this.startTime) / 1000;
      const ratio = elapsed / Math.max(1, this.estimatedDurationSeconds);

      // Asymptotic curve: progresses swiftly at first, decelerating gently towards ~92%
      // 1 - exp(-1.8 * ratio) yields:
      // ratio 0.25 -> 36%
      // ratio 0.50 -> 59%
      // ratio 0.75 -> 74%
      // ratio 1.00 -> 83%
      // ratio 1.50 -> 90%
      // ratio 2.00 -> 92% (max hold before media sniffed)
      const calculated = Math.round(5 + 87 * (1 - Math.exp(-1.8 * ratio)));
      const nextPercent = Math.min(93, Math.max(this.currentPercent, calculated));

      this.currentPercent = nextPercent;
      this.emitProgress(this.currentPercent, 'Generating in Google Flow...');
    }, 600);
  }

  /**
   * Called immediately upon media detection (sniffed or DOM delta).
   */
  setDownloading(stepDescription = 'Downloading media in background...'): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentStage = 'downloading';
    this.currentPercent = 96;
    this.emitProgress(96, stepDescription);
  }

  /**
   * Called strictly after safe download and disk verification.
   */
  setCompleted(stepDescription = 'Generation completed and verified'): void {
    this.stop();
    this.currentStage = 'completed';
    this.currentPercent = 100;
    this.emitProgress(100, stepDescription, 'completed');
  }

  /**
   * Called on job failure or cancellation.
   */
  setFailed(errorMessage: string): void {
    this.stop();
    this.currentStage = 'failed';
    this.emitProgress(this.currentPercent, `Failed: ${errorMessage}`, 'failed');
  }

  /**
   * Stops the timer and releases resources.
   */
  stop(): void {
    this.isStopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emitProgress(percent: number, description: string, status: JobStatus = 'generating'): void {
    const elapsedSeconds = Math.round((Date.now() - this.startTime) / 1000);
    const event: JobProgressEvent = {
      jobId: this.config.jobId,
      projectId: this.config.projectId,
      promptId: this.config.promptId,
      slotIndex: this.config.slotIndex,
      status,
      stepDescription: description,
      timestamp: new Date().toISOString(),
      progressPercent: percent,
      stage: this.currentStage,
      elapsedSeconds,
      estimatedDurationSeconds: this.estimatedDurationSeconds,
    };

    generationEventBus.emitTyped('job:progress', event);
  }
}
