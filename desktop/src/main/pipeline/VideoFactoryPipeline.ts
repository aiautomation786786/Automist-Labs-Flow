/**
 * VideoFactoryPipeline – Single-run orchestrator for a Video Factory project.
 *
 * ORCHESTRATION INVARIANTS:
 *  1. Pure Orchestrator: Delegates to TtsManager, RenderManager, FinalRenderManager,
 *     GenerationScheduler, and ChannelDeliveryService. Never duplicates engine logic.
 *  2. Persistent Stage Model: Every transition is persisted atomically to metadata/pipeline.json.
 *  3. Resumability: Never re-runs validated completed stages on restart/resume.
 *  4. Parallel Assets: images, voice, and thumbnail execute concurrently via Promise.allSettled.
 *     Failure in one branch does not destroy completed sibling branches.
 *  5. Cooperative Pause: Stops at safe stage/checkpoint boundaries without corrupting file writes.
 *  6. Real Cancellation: Propagates AbortSignal, marks CANCELLED, halts downstream stages.
 *  7. Output Validation: A stage is only completed when real on-disk media is verified.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  VideoFactoryStage,
  VideoFactoryPipelineState,
  StageState,
  VideoFactoryMode,
  PipelineProgressEvent,
} from '../../shared/types';
import { StoryRepository } from '../storage/StoryRepository';
import { AssetManager } from '../storage/AssetManager';
import { ProjectRepository } from '../storage/ProjectRepository';
import { PipelineStageValidator } from './PipelineStageValidator';
import { TtsManager } from '../tts/TtsManager';
import { RenderManager } from '../render/RenderManager';
import { FinalRenderManager } from '../render/FinalRenderManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { ChannelDeliveryService } from '../channel/ChannelDeliveryService';
import type { GenerationScheduler } from '../scheduler/GenerationScheduler';
import { RetryCoordinator } from '../retry/RetryCoordinator';
import { ErrorClassifier } from '../retry/ErrorClassifier';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class VideoFactoryPipeline {
  readonly projectId: string;
  private mode: VideoFactoryMode;
  private abortController: AbortController = new AbortController();
  private pauseRequested = false;
  private userCancelled = false;
  private scheduler?: GenerationScheduler;
  private state!: VideoFactoryPipelineState;

  constructor(projectId: string, mode: VideoFactoryMode = 'full_video', scheduler?: GenerationScheduler) {
    this.projectId = projectId;
    this.mode = mode;
    this.scheduler = scheduler;
  }

  setScheduler(s: GenerationScheduler): void {
    this.scheduler = s;
  }

  get isAborted(): boolean {
    return this.abortController.signal.aborted;
  }

  get isPauseRequested(): boolean {
    return this.pauseRequested;
  }

  getState(): VideoFactoryPipelineState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Initializes or loads persisted pipeline state.
   */
  async loadOrCreateState(): Promise<VideoFactoryPipelineState> {
    let existing = await StoryRepository.getPipelineState(this.projectId);
    if (!existing) {
      existing = StoryRepository.initializePipelineState(this.projectId, this.mode);
      await StoryRepository.savePipelineState(this.projectId, existing);
    } else {
      this.mode = existing.mode || this.mode;
    }
    this.state = existing;
    return this.state;
  }

  /**
   * Emits a pipeline progress event over the event bus.
   */
  private emitEvent(stageMessage?: string): void {
    const event: PipelineProgressEvent = {
      projectId: this.projectId,
      runId: this.state.runId,
      status: this.state.status,
      currentStage: this.state.currentStage,
      stageStatus: this.state.currentStage ? this.state.stages[this.state.currentStage]?.status : undefined,
      stageProgress: this.state.currentStage ? this.state.stages[this.state.currentStage]?.progress : undefined,
      overallProgress: this.state.overallProgress,
      stageMessage,
      error: this.state.error,
      timestamp: new Date().toISOString(),
      stages: this.state.stages,
    };
    generationEventBus.emit('pipeline:progress' as any, event);
  }

  /**
   * Recalculates overall progress from stage statuses.
   */
  private updateOverallProgress(): void {
    const stagesForMode = this.getStagesForMode();
    if (stagesForMode.length === 0) return;

    let totalScore = 0;
    for (const stage of stagesForMode) {
      const st = this.state.stages[stage];
      if (st.status === 'completed') {
        totalScore += 100;
      } else if (st.status === 'running') {
        totalScore += Math.min(99, Math.max(0, st.progress));
      }
    }

    this.state.overallProgress = Math.round(totalScore / stagesForMode.length);
  }

  /**
   * Returns list of required stages based on active mode.
   */
  getStagesForMode(): VideoFactoryStage[] {
    switch (this.mode) {
      case 'audio_only':
        return ['story', 'voice', 'export'];
      case 'images_only':
        return ['story', 'images', 'export'];
      case 'from_skill':
      case 'full_video':
      default:
        return ['story', 'images', 'voice', 'thumbnail', 'clips', 'review', 'subtitles', 'rendering', 'export'];
    }
  }

  /**
   * Updates and atomically persists stage state.
   */
  async updateStageState(
    stage: VideoFactoryStage,
    patch: Partial<StageState>,
    stageMessage?: string
  ): Promise<void> {
    const current = this.state.stages[stage];
    const updated: StageState = {
      ...current,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.state.stages[stage] = updated;
    this.updateOverallProgress();
    await StoryRepository.savePipelineState(this.projectId, this.state);
    this.emitEvent(stageMessage);
  }

  /**
   * Requests a cooperative pause.
   */
  requestPause(): void {
    this.pauseRequested = true;
    this.state.status = 'pausing';
    RetryCoordinator.getInstance().pauseRetries(this.projectId);
    this.emitEvent('Pause requested, waiting for safe checkpoint...');
  }

  /**
   * Cancels the pipeline run.
   */
  cancel(): void {
    this.userCancelled = true;
    this.abortController.abort();
    this.state.status = 'cancelled';
    RetryCoordinator.getInstance().cancelRetries(this.projectId);
    if (this.state.currentStage) {
      const st = this.state.stages[this.state.currentStage];
      st.status = 'cancelled';
      st.lastUpdatedAt = new Date().toISOString();
      const retryState = RetryCoordinator.getInstance().getRetryState(this.projectId, this.state.currentStage);
      if (retryState) {
        st.retryState = retryState;
      }
    }
    StoryRepository.savePipelineState(this.projectId, this.state).catch(() => {});
    this.emitEvent('Pipeline run cancelled by user.');
    logger.info('pipeline', `Pipeline cancelled for project ${this.projectId}`);
  }

  /**
   * Runs the end-to-end pipeline from current or interrupted stage.
   */
  async run(): Promise<VideoFactoryPipelineState> {
    await this.loadOrCreateState();

    if (this.state.status === 'completed') {
      logger.info('pipeline', `Project ${this.projectId} is already completed.`);
      return this.state;
    }

    if (this.isAborted) {
      this.state.status = 'cancelled';
      await StoryRepository.savePipelineState(this.projectId, this.state);
      this.emitEvent('Pipeline cancelled');
      return this.state;
    }

    if (this.pauseRequested) {
      this.state.status = 'paused';
      await StoryRepository.savePipelineState(this.projectId, this.state);
      this.emitEvent('Pipeline safely paused.');
      return this.state;
    }

    this.state.status = 'running';
    this.state.startedAt = this.state.startedAt || new Date().toISOString();
    await StoryRepository.savePipelineState(this.projectId, this.state);
    this.emitEvent('Pipeline started');

    try {
      if (this.mode === 'audio_only') {
        await this.runAudioOnlyPipeline();
      } else if (this.mode === 'images_only') {
        await this.runImagesOnlyPipeline();
      } else {
        await this.runFullVideoPipeline();
      }

      if (this.state.status === 'running') {
        this.state.status = 'completed';
        this.state.currentStage = null;
        this.state.completedAt = new Date().toISOString();
        this.state.overallProgress = 100;
        await StoryRepository.savePipelineState(this.projectId, this.state);
        this.emitEvent('Pipeline completed successfully');
      }
    } catch (err: any) {
      if (this.isAborted) {
        this.state.status = 'cancelled';
        this.emitEvent('Pipeline cancelled');
      } else if (this.pauseRequested) {
        this.state.status = 'paused';
        this.emitEvent('Pipeline paused at safe checkpoint');
      } else {
        this.state.status = 'failed';
        this.state.error = err.message;
        this.emitEvent(`Pipeline failed: ${err.message}`);
        logger.error('pipeline', `Pipeline failure for project ${this.projectId}`, err);
      }
      await StoryRepository.savePipelineState(this.projectId, this.state);
    }

    return this.state;
  }

  /**
   * Checks cooperative pause and yields if requested.
   */
  private async checkPauseCheckpoint(): Promise<boolean> {
    if (this.pauseRequested) {
      this.state.status = 'paused';
      await StoryRepository.savePipelineState(this.projectId, this.state);
      this.emitEvent('Pipeline safely paused.');
      return true;
    }
    if (this.isAborted) {
      this.state.status = 'cancelled';
      await StoryRepository.savePipelineState(this.projectId, this.state);
      this.emitEvent('Pipeline cancelled.');
      return true;
    }
    return false;
  }

  /**
   * Executes a stage with bounded automatic retry safety, identical error bailout,
   * cancellable delays, and cooperative pause checks.
   */
  private async executeStageWithAutoRetry(
    stage: VideoFactoryStage,
    stageFn: () => Promise<void>
  ): Promise<void> {
    const coordinator = RetryCoordinator.getInstance();

    while (true) {
      if (this.isAborted || this.pauseRequested || this.userCancelled) {
        return;
      }

      try {
        await stageFn();
        coordinator.recordSuccess(this.projectId, stage);
        return;
      } catch (err: any) {
        if (this.isAborted || this.pauseRequested || this.userCancelled || ErrorClassifier.isCancellation(err)) {
          coordinator.cancelRetries(this.projectId, stage);
          throw err;
        }

        const evalResult = coordinator.recordError(this.projectId, stage, err, {
          runId: this.state.runId,
          stage,
          signal: this.abortController.signal,
        });

        await this.updateStageState(stage, {
          error: err.message,
          retryState: evalResult.retryState,
        }, `Stage ${stage} failed: ${err.message}. ${evalResult.shouldRetry ? `Retrying in ${evalResult.delayMs}ms (Attempt ${evalResult.retryState.attempt}/${evalResult.retryState.maxAttempts})` : `Retry stopped: ${evalResult.reason}`}`);

        if (!evalResult.shouldRetry) {
          throw err;
        }

        // Wait with cancellable timer
        const executed = await coordinator.scheduleRetry(
          this.projectId,
          stage,
          this.state.runId,
          evalResult.delayMs,
          async () => {},
          this.abortController.signal
        );

        if (!executed || this.isAborted || this.pauseRequested || this.userCancelled) {
          return;
        }
      }
    }
  }

  // ===========================================================================
  // Full Video Pipeline Execution
  // ===========================================================================

  private async runFullVideoPipeline(): Promise<void> {
    // 1. STORY STAGE
    if (await this.shouldExecuteStage('story')) {
      await this.executeStageWithAutoRetry('story', () => this.executeStoryStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 2. PARALLEL ASSET STAGE: IMAGES + VOICE + THUMBNAIL
    const needImages = await this.shouldExecuteStage('images');
    const needVoice = await this.shouldExecuteStage('voice');
    const needThumb = await this.shouldExecuteStage('thumbnail');

    if (needImages || needVoice || needThumb) {
      await this.executeParallelAssetsStage(needImages, needVoice, needThumb);
    }
    if (await this.checkPauseCheckpoint()) return;

    // 3. CLIPS STAGE (Depends on images + voice)
    if (await this.shouldExecuteStage('clips')) {
      await this.executeStageWithAutoRetry('clips', () => this.executeClipsStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 4. REVIEW STAGE (Real automated clip validation)
    if (await this.shouldExecuteStage('review')) {
      await this.executeStageWithAutoRetry('review', () => this.executeReviewStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 5. SUBTITLES STAGE
    if (await this.shouldExecuteStage('subtitles')) {
      await this.executeStageWithAutoRetry('subtitles', () => this.executeSubtitlesStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 6. FINAL RENDERING STAGE
    if (await this.shouldExecuteStage('rendering')) {
      await this.executeStageWithAutoRetry('rendering', () => this.executeRenderingStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 7. EXPORT STAGE
    if (await this.shouldExecuteStage('export')) {
      await this.executeStageWithAutoRetry('export', () => this.executeExportStage());
    }
  }

  // ===========================================================================
  // Audio Only Pipeline Execution
  // ===========================================================================

  private async runAudioOnlyPipeline(): Promise<void> {
    // 1. STORY
    if (await this.shouldExecuteStage('story')) {
      await this.executeStageWithAutoRetry('story', () => this.executeStoryStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 2. VOICE (with master audio combine)
    if (await this.shouldExecuteStage('voice')) {
      await this.executeStageWithAutoRetry('voice', () => this.executeVoiceStage(true));
    }
    if (await this.checkPauseCheckpoint()) return;

    // 3. EXPORT
    if (await this.shouldExecuteStage('export')) {
      await this.executeStageWithAutoRetry('export', () => this.executeExportStage());
    }
  }

  // ===========================================================================
  // Images Only Pipeline Execution
  // ===========================================================================

  private async runImagesOnlyPipeline(): Promise<void> {
    // 1. STORY
    if (await this.shouldExecuteStage('story')) {
      await this.executeStageWithAutoRetry('story', () => this.executeStoryStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 2. IMAGES
    if (await this.shouldExecuteStage('images')) {
      await this.executeStageWithAutoRetry('images', () => this.executeImagesStage());
    }
    if (await this.checkPauseCheckpoint()) return;

    // 3. EXPORT
    if (await this.shouldExecuteStage('export')) {
      await this.executeStageWithAutoRetry('export', () => this.executeExportStage());
    }
  }

  // ===========================================================================
  // Stage Implementations (Pure Orchestration)
  // ===========================================================================

  private async shouldExecuteStage(stage: VideoFactoryStage): Promise<boolean> {
    const current = this.state.stages[stage];
    if (current.status === 'completed') {
      // Verify outputs are genuinely present
      const check = await PipelineStageValidator.validateStageOutput(this.projectId, stage);
      if (check.valid) {
        return false; // Validated complete! Skip regeneration.
      }
      logger.warn('pipeline', `Stage ${stage} was marked completed but output validation failed: ${check.reason}. Re-executing.`);
    }
    return true;
  }

  private async executeStoryStage(): Promise<void> {
    this.state.currentStage = 'story';
    await this.updateStageState('story', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.story.attempt || 0) + 1,
      progress: 30,
    }, 'Validating story & script configuration...');

    const check = await PipelineStageValidator.validateStory(this.projectId);
    if (!check.valid) {
      await this.updateStageState('story', {
        status: 'failed',
        error: check.reason,
      }, `Story validation failed: ${check.reason}`);
      throw new Error(`Story validation failed: ${check.reason}`);
    }

    await this.updateStageState('story', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Story validated.');
  }

  /**
   * Executes IMAGES, VOICE, and THUMBNAIL in parallel using Promise.allSettled.
   */
  private async executeParallelAssetsStage(runImages: boolean, runVoice: boolean, runThumb: boolean): Promise<void> {
    const tasks: Promise<any>[] = [];

    if (runImages) tasks.push(this.executeStageWithAutoRetry('images', () => this.executeImagesStage()));
    if (runVoice) tasks.push(this.executeStageWithAutoRetry('voice', () => this.executeVoiceStage(false)));
    if (runThumb) tasks.push(this.executeStageWithAutoRetry('thumbnail', () => this.executeThumbnailStage()));

    const results = await Promise.allSettled(tasks);
    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    if (failures.length > 0) {
      const err = failures[0].reason;
      throw new Error(`Asset stage failed in branch: ${err?.message || err}`);
    }
  }

  async executeImagesStage(): Promise<void> {
    this.state.currentStage = 'images';
    await this.updateStageState('images', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.images.attempt || 0) + 1,
      progress: 20,
    }, 'Generating scene imagery...');

    const story = await StoryRepository.getStory(this.projectId);
    const config = await StoryRepository.getConfig(this.projectId);
    const aspectRatio = config?.aspectRatio || '16:9';

    if (this.scheduler) {
      logger.info('pipeline', `GenerationScheduler active for project ${this.projectId}`);
    }

    // If slots are queued, wait for scheduler or generate images
    for (let i = 0; i < (story?.scenes?.length || 0); i++) {
      if (this.isAborted || this.pauseRequested) break;
      const sceneNum = story!.scenes[i].sceneNumber || (i + 1);
      await RenderManager['ensureSceneImage'](this.projectId, sceneNum, aspectRatio);
      const progress = Math.round(((i + 1) / story!.scenes.length) * 90);
      await this.updateStageState('images', { progress }, `Prepared image for Scene ${sceneNum}`);
    }

    const check = await PipelineStageValidator.validateImages(this.projectId);
    if (!check.valid) {
      await this.updateStageState('images', {
        status: 'failed',
        error: check.reason,
      }, `Images validation failed: ${check.reason}`);
      throw new Error(`Images validation failed: ${check.reason}`);
    }

    await this.updateStageState('images', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'All scene images ready.');
  }

  async executeVoiceStage(combineMaster: boolean = false): Promise<void> {
    this.state.currentStage = 'voice';
    await this.updateStageState('voice', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.voice.attempt || 0) + 1,
      progress: 10,
    }, 'Synthesizing voice narration...');

    const config = await StoryRepository.getConfig(this.projectId);
    const voiceEngine = (config?.voiceEngine || 'edge-tts') as any;
    const voiceId = config?.voiceId;

    // Delegate to TtsManager (Phase 1 engine with ZBot fallback)
    try {
      await TtsManager.synthesizeProjectNarration(this.projectId, {
        provider: voiceEngine,
        voiceId,
        signal: this.abortController.signal,
      });

      if (combineMaster) {
        await this.updateStageState('voice', { progress: 85 }, 'Combining master narration audio...');
        await TtsManager.combineProjectAudio(this.projectId, 'final_audio.mp3');
      }
    } catch (synthErr: any) {
      await this.updateStageState('voice', {
        status: 'failed',
        error: synthErr.message,
      }, `Voice narration failed: ${synthErr.message}`);
      throw synthErr;
    }

    const check = await PipelineStageValidator.validateVoice(this.projectId);
    if (!check.valid) {
      await this.updateStageState('voice', {
        status: 'failed',
        error: check.reason,
      }, `Voice validation failed: ${check.reason}`);
      throw new Error(`Voice validation failed: ${check.reason}`);
    }

    await this.updateStageState('voice', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Voice narration completed.');
  }

  async executeThumbnailStage(): Promise<void> {
    this.state.currentStage = 'thumbnail';
    await this.updateStageState('thumbnail', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.thumbnail.attempt || 0) + 1,
      progress: 40,
    }, 'Generating thumbnail asset...');

    const dirs = AssetManager.ensureProjectDirectories(this.projectId);
    const thumbPath = path.join(dirs.imagesDir, 'thumbnail.png');

    if (!fs.existsSync(thumbPath)) {
      // Ensure from first scene image or placeholder
      const config = await StoryRepository.getConfig(this.projectId);
      const scene1 = await RenderManager['ensureSceneImage'](this.projectId, 1, config?.aspectRatio || '16:9');
      if (fs.existsSync(scene1)) {
        fs.copyFileSync(scene1, thumbPath);
      }
    }

    const check = await PipelineStageValidator.validateThumbnail(this.projectId);
    if (!check.valid) {
      await this.updateStageState('thumbnail', {
        status: 'failed',
        error: check.reason,
      }, `Thumbnail generation failed: ${check.reason}`);
      throw new Error(`Thumbnail generation failed: ${check.reason}`);
    }

    await this.updateStageState('thumbnail', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Thumbnail ready.');
  }

  private async executeClipsStage(): Promise<void> {
    this.state.currentStage = 'clips';
    await this.updateStageState('clips', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.clips.attempt || 0) + 1,
      progress: 20,
    }, 'Rendering scene motion clips...');

    const config = await StoryRepository.getConfig(this.projectId);
    const clipsAttempt = (this.state.stages.clips.attempt || 0) + 1;
    try {
      await RenderManager.renderProjectClips(this.projectId, {
        projectId: this.projectId,
        motionEnabled: config?.motionEnabled,
        motionStyle: config?.motionStyle,
        transitionStyle: config?.transitionStyle,
        subtitleStyle: config?.subtitleStyle,
        subtitlesEnabled: config?.subtitlesEnabled,
        attempt: clipsAttempt,
        signal: this.abortController.signal,
      });
    } catch (clipErr: any) {
      await this.updateStageState('clips', {
        status: 'failed',
        error: clipErr.message,
      }, `Clips rendering failed: ${clipErr.message}`);
      throw clipErr;
    }

    const check = await PipelineStageValidator.validateClips(this.projectId);
    if (!check.valid) {
      await this.updateStageState('clips', {
        status: 'failed',
        error: check.reason,
      }, `Clips validation failed: ${check.reason}`);
      throw new Error(`Clips validation failed: ${check.reason}`);
    }

    await this.updateStageState('clips', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Scene clips rendered.');
  }

  private async executeReviewStage(): Promise<void> {
    this.state.currentStage = 'review';
    await this.updateStageState('review', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.review.attempt || 0) + 1,
      progress: 50,
    }, 'Reviewing and validating scene clips...');

    const check = await PipelineStageValidator.validateReview(this.projectId);
    if (!check.valid) {
      await this.updateStageState('review', {
        status: 'failed',
        error: check.reason,
      }, `Review failed: ${check.reason}`);
      throw new Error(`Review stage rejected clips: ${check.reason}`);
    }

    await this.updateStageState('review', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Clips review verified successfully.');
  }

  private async executeSubtitlesStage(): Promise<void> {
    this.state.currentStage = 'subtitles';
    await this.updateStageState('subtitles', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.subtitles.attempt || 0) + 1,
      progress: 70,
    }, 'Verifying and finalizing subtitles...');

    const check = await PipelineStageValidator.validateSubtitles(this.projectId);
    if (!check.valid) {
      await this.updateStageState('subtitles', {
        status: 'failed',
        error: check.reason,
      }, `Subtitles validation failed: ${check.reason}`);
      throw new Error(`Subtitles validation failed: ${check.reason}`);
    }

    await this.updateStageState('subtitles', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Subtitles verified.');
  }

  private async executeRenderingStage(): Promise<void> {
    this.state.currentStage = 'rendering';
    await this.updateStageState('rendering', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.rendering.attempt || 0) + 1,
      progress: 25,
    }, 'Assembling and muxing final video...');

    const config = await StoryRepository.getConfig(this.projectId);
    try {
      await FinalRenderManager.assembleFinalVideo(this.projectId, {
        transitionStyle: config?.transitionStyle,
      });
    } catch (renderErr: any) {
      await this.updateStageState('rendering', {
        status: 'failed',
        error: renderErr.message,
      }, `Final render failed: ${renderErr.message}`);
      throw renderErr;
    }

    const check = await PipelineStageValidator.validateRendering(this.projectId);
    if (!check.valid) {
      await this.updateStageState('rendering', {
        status: 'failed',
        error: check.reason,
      }, `Final video render failed: ${check.reason}`);
      throw new Error(`Final render verification failed: ${check.reason}`);
    }

    await this.updateStageState('rendering', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: check.details,
    }, 'Final video assembly completed.');
  }

  private async executeExportStage(): Promise<void> {
    this.state.currentStage = 'export';
    await this.updateStageState('export', {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempt: (this.state.stages.export.attempt || 0) + 1,
      progress: 20,
    }, 'Finalizing output and export delivery...');

    const project = await ProjectRepository.get(this.projectId);
    const config = await StoryRepository.getConfig(this.projectId);
    const assignedChannelId = project?.channelId || config?.channelId;

    let deliveryRecord: any = undefined;

    if (this.mode === 'audio_only') {
      const projectDir = AssetManager.getProjectDir(this.projectId);
      const masterAudio = path.join(projectDir, 'audio', 'final_audio.mp3');
      if (!fs.existsSync(masterAudio) || fs.statSync(masterAudio).size === 0) {
        throw new Error(`Master audio missing for audio-only project ${this.projectId}`);
      }

      await StoryRepository.saveExportManifest(this.projectId, {
        projectId: this.projectId,
        exportedAt: new Date().toISOString(),
        finalAudioFile: 'audio/final_audio.mp3',
        channelId: assignedChannelId,
        channelDelivered: false,
        destinationType: 'general',
      });
    } else {
      // 1. Locate canonical final video
      const finalMp4_1 = AssetManager.getFinalDestinationPath(this.projectId, 'final.mp4');
      const finalMp4_2 = path.join(AssetManager.getProjectDir(this.projectId), 'renders', 'final_video.mp4');
      const canonicalVideo = fs.existsSync(finalMp4_1) ? finalMp4_1 : finalMp4_2;

      if (!fs.existsSync(canonicalVideo) || fs.statSync(canonicalVideo).size === 0) {
        throw new Error(`Canonical final video missing for project ${this.projectId}. Run Final Assembly first.`);
      }

      let destinationType: 'shorts' | 'longs' | 'general' = 'general';

      // 2. If assigned to a channel, probe dimensions and deliver with strict format routing
      if (assignedChannelId) {
        const probe = await ChannelDeliveryService.detectAspectRatio(canonicalVideo);
        if (probe.error) {
          throw new Error(`Aspect ratio detection failed for canonical video: ${probe.error}`);
        }

        await this.updateStageState('export', { progress: 40 }, `Detected format: ${probe.aspectRatio} (${probe.width}x${probe.height})`);

        await this.updateStageState('export', { progress: 60 }, `Delivering to channel ${assignedChannelId}...`);
        deliveryRecord = await ChannelDeliveryService.deliverProject(this.projectId, assignedChannelId, {
          strictFormatRouting: true,
          runId: this.state.runId,
        });
        destinationType = probe.aspectRatio === '9:16' ? 'shorts' : 'longs';
      } else {
        // No channel assigned: attempt probing if valid media container, else fallback to project config
        try {
          const probe = await ChannelDeliveryService.detectAspectRatio(canonicalVideo);
          if (!probe.error) {
            destinationType = probe.aspectRatio === '9:16' ? 'shorts' : 'longs';
          } else {
            destinationType = config?.aspectRatio === '9:16' ? 'shorts' : 'longs';
          }
        } catch {
          destinationType = config?.aspectRatio === '9:16' ? 'shorts' : 'longs';
        }
      }

      // 3. Save export manifest
      await StoryRepository.saveExportManifest(this.projectId, {
        projectId: this.projectId,
        exportedAt: new Date().toISOString(),
        finalVideoFile: fs.existsSync(finalMp4_1) ? 'final/final.mp4' : 'renders/final_video.mp4',
        channelId: assignedChannelId,
        channelDelivered: Boolean(deliveryRecord && deliveryRecord.status === 'delivered'),
        destinationType,
        collisionHandled: deliveryRecord?.collisionHandled,
        deliveredVideoPath: deliveryRecord?.deliveredVideoPath,
      });
    }

    // 5. Validate export stage output
    const check = await PipelineStageValidator.validateExport(this.projectId);
    if (!check.valid) {
      await this.updateStageState('export', {
        status: 'failed',
        error: check.reason,
      }, `Export stage verification failed: ${check.reason}`);
      throw new Error(`Export stage verification failed: ${check.reason}`);
    }

    await this.updateStageState('export', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: 100,
      outputs: {
        ...check.details,
        channelId: assignedChannelId,
        destinationType: deliveryRecord?.orientation,
        deliveredVideoPath: deliveryRecord?.deliveredVideoPath,
        collisionHandled: deliveryRecord?.collisionHandled,
      },
    }, deliveryRecord ? `Exported to ${deliveryRecord.orientation === 'shorts' ? 'Shorts' : 'Longs'}.` : 'Export completed.');
  }

  /**
   * Retries a specific stage by resetting it and downstream stages to pending.
   * User explicitly requested manual retry: resets safety counters while preserving upstream completed work.
   */
  async retryStage(stage: VideoFactoryStage): Promise<VideoFactoryPipelineState> {
    await this.loadOrCreateState();

    this.userCancelled = false;
    if (this.isAborted) {
      this.abortController = new AbortController();
    }

    const downstream = PipelineStageValidator.getDownstreamStages(stage, this.mode);
    const affected = [stage, ...downstream];

    const now = new Date().toISOString();
    for (const st of affected) {
      const resetRetry = RetryCoordinator.getInstance().recordManualRetry(this.projectId, st, this.state.runId);
      this.state.stages[st] = {
        ...this.state.stages[st],
        status: 'pending',
        progress: 0,
        error: undefined,
        retryState: resetRetry,
        version: (this.state.stages[st].version || 1) + 1,
        lastUpdatedAt: now,
      };
    }

    this.state.status = 'resuming';
    this.state.error = undefined;
    await StoryRepository.savePipelineState(this.projectId, this.state);
    this.emitEvent(`Reset ${stage} and downstream stages for manual retry.`);

    return await this.run();
  }
}
