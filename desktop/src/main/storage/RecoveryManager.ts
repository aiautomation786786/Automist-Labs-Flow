/**
 * RecoveryManager – Recovers interrupted in-flight jobs after an unexpected application crash.
 *
 * CRASH RECOVERY POLICY:
 *  - At application startup, scans all persistent jobs.
 *  - Identifies jobs left in transient states (starting, configuring, generating, waiting_for_result, downloading).
 *  - Never silently marks an interrupted job as completed unless a verified non-empty output file exists.
 *  - If output file exists and is valid -> marks job completed.
 *  - If output file does not exist -> marks job retry_waiting (or manual_action_required if retries exhausted).
 *  - Reconciles the corresponding prompt slot status accordingly.
 */

import { JobRepository } from './JobRepository';
import { ProjectRepository } from './ProjectRepository';
import { StoryRepository } from './StoryRepository';
import { PipelineStageValidator } from '../pipeline/PipelineStageValidator';
import { AssetManager } from './AssetManager';
import { JobStateMachine } from '../../shared/job-states';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface RecoveryReport {
  scannedProjects: number;
  transientJobsFound: number;
  recoveredCompleted: number;
  recoveredForRetry: number;
  recoveredManualAction: number;
  scannedPipelines?: number;
  recoveredPipelines?: number;
}

export class RecoveryManager {
  /**
   * Scans and recovers all interrupted jobs across all stored projects.
   */
  static async recoverAll(): Promise<RecoveryReport> {
    logger.info('recovery', 'Starting crash recovery scan...');

    const projects = await ProjectRepository.getAll();
    const report: RecoveryReport = {
      scannedProjects: projects.length,
      transientJobsFound: 0,
      recoveredCompleted: 0,
      recoveredForRetry: 0,
      recoveredManualAction: 0,
    };

    for (const project of projects) {
      const jobs = await JobRepository.getJobsByProject(project.projectId);

      for (const job of jobs) {
        if (!JobStateMachine.isTransient(job.status)) {
          continue;
        }

        report.transientJobsFound++;
        logger.warn('recovery', `Found interrupted job ${job.jobId} in transient state "${job.status}"`, {
          projectId: project.projectId,
          slotIndex: job.slotIndex,
        });

        // Check if an output file was actually saved before the crash
        const expectedImagePath = AssetManager.getImageDestinationPath(
          project.projectId,
          job.slotIndex,
          job.promptId,
          job.jobId
        );

        const fileCheck = AssetManager.verifyOutputFile(expectedImagePath, project.projectId);

        if (fileCheck.valid) {
          // Output file exists and is valid! Recover as completed.
          logger.info('recovery', `Found valid output file for interrupted job ${job.jobId}. Marking completed.`);
          await JobRepository.updateJob(project.projectId, job.jobId, {
            status: 'completed',
            outputPath: expectedImagePath,
          });

          await ProjectRepository.updateSlot(project.projectId, job.slotIndex, {
            status: 'completed',
            result: {
              assetId: `recovered_${job.jobId}`,
              mediaPath: expectedImagePath,
              modelUsed: 'Nano Banana 2',
              ratioUsed: project.settings.imageRatio,
              completedAt: new Date().toISOString(),
              fileSizeBytes: fileCheck.sizeBytes,
            },
          });

          report.recoveredCompleted++;
        } else {
          // No valid output file -> check if cancelled or retry exhausted
          const isCancelled = job.status === 'cancelled' || job.retryState?.cancelledByUser;
          const isExhausted =
            job.retryCount >= job.maxRetries ||
            job.retryState?.retryReason === 'RETRY_LIMIT_EXCEEDED' ||
            job.retryState?.retryReason === 'IDENTICAL_ERROR_BAILOUT' ||
            job.retryState?.retryReason === 'NON_RETRYABLE_ERROR';

          if (isCancelled) {
            logger.info('recovery', `Interrupted job ${job.jobId} was cancelled by user. Retaining cancelled status.`);
            await JobRepository.updateJob(project.projectId, job.jobId, {
              status: 'cancelled',
              errorMessage: 'Cancelled by user prior to interruption.',
            });
            await ProjectRepository.updateSlot(project.projectId, job.slotIndex, {
              status: 'cancelled',
            });
          } else if (isExhausted) {
            logger.warn('recovery', `Interrupted job ${job.jobId} has exhausted retries or triggered identical error bailout. Marking manual_action_required.`);
            await JobRepository.updateJob(project.projectId, job.jobId, {
              status: 'manual_action_required',
              errorMessage: job.retryState?.retryReason === 'IDENTICAL_ERROR_BAILOUT'
                ? 'Interrupted job hit identical-error bailout. Manual action required.'
                : 'Interrupted job retries exhausted.',
            });
            await ProjectRepository.updateSlot(project.projectId, job.slotIndex, {
              status: 'failed',
            });
            report.recoveredManualAction++;
          } else {
            logger.info('recovery', `Marking interrupted job ${job.jobId} as retry_waiting`);
            await JobRepository.updateJob(project.projectId, job.jobId, {
              status: 'retry_waiting',
              errorMessage: 'Interrupted by application restart/crash. Scheduled for recovery retry.',
            });

            await ProjectRepository.updateSlot(project.projectId, job.slotIndex, {
              status: 'queued',
            });

            report.recoveredForRetry++;
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Phase 2: Video Factory Pipeline Crash Recovery
    // -------------------------------------------------------------------------
    report.scannedPipelines = 0;
    report.recoveredPipelines = 0;

    for (const project of projects) {
      const pipelineState = await StoryRepository.getPipelineState(project.projectId);
      if (!pipelineState) continue;

      report.scannedPipelines++;

      // Check if pipeline was left in a transient state
      if (
        pipelineState.status === 'running' ||
        pipelineState.status === 'pausing' ||
        pipelineState.status === 'resuming'
      ) {
        // If pipeline itself was cancelled
        const isPipelineCancelled = Boolean((pipelineState as { cancelledByUser?: boolean }).cancelledByUser);

        if (isPipelineCancelled) {
          logger.info('recovery', `Pipeline for ${project.projectId} was cancelled. Retaining cancelled state.`);
          pipelineState.status = 'cancelled';
          await StoryRepository.savePipelineState(project.projectId, pipelineState);
          continue;
        }

        report.recoveredPipelines++;
        logger.warn('recovery', `Found interrupted Video Factory pipeline for project ${project.projectId} in status "${pipelineState.status}"`);

        let pipelineHasFailedStage = false;

        // Validate outputs of completed stages and recover interrupted running stages
        const stages = Object.keys(pipelineState.stages) as (keyof typeof pipelineState.stages)[];
        for (const stageName of stages) {
          const st = pipelineState.stages[stageName];
          if (st.status === 'completed') {
            const check = await PipelineStageValidator.validateStageOutput(project.projectId, stageName);
            if (!check.valid) {
              logger.warn('recovery', `Completed stage "${stageName}" in project ${project.projectId} has missing or corrupt output. Resetting to pending.`);
              st.status = 'pending';
              st.progress = 0;
              st.error = `Output validation failed on crash recovery: ${check.reason}`;
            }
          } else if (st.status === 'running') {
            // Requirement 4: If an interrupted stage's output is already valid, mark it completed and continue.
            const check = await PipelineStageValidator.validateStageOutput(project.projectId, stageName);
            if (check.valid) {
              logger.info('recovery', `Interrupted stage "${stageName}" in project ${project.projectId} has valid output. Marking completed.`);
              st.status = 'completed';
              st.progress = 100;
              st.completedAt = new Date().toISOString();
            } else {
              // Stage incomplete: check if cancelled or retry exhausted
              const isStageCancelled = st.retryState?.cancelledByUser;
              const isStageExhausted =
                st.retryState?.retryReason === 'IDENTICAL_ERROR_BAILOUT' ||
                st.retryState?.retryReason === 'RETRY_LIMIT_EXCEEDED' ||
                (st.retryState && st.retryState.attempt >= st.retryState.maxAttempts);

              if (isStageCancelled) {
                logger.info('recovery', `Interrupted stage "${stageName}" was cancelled by user. Retaining cancelled.`);
                st.status = 'cancelled';
                st.progress = 0;
                st.error = 'Cancelled by user prior to interruption.';
                pipelineHasFailedStage = true;
              } else if (isStageExhausted) {
                logger.warn('recovery', `Interrupted stage "${stageName}" retry exhausted or identical-error bailout. Retaining failed.`);
                st.status = 'failed';
                st.progress = 0;
                st.error = 'Interrupted after retries exhausted or identical error bailout.';
                pipelineHasFailedStage = true;
              } else {
                logger.info('recovery', `Interrupted stage "${stageName}" in project ${project.projectId} incomplete. Marking pending for resume.`);
                st.status = 'pending';
                st.progress = 0;
                st.error = 'Interrupted by crash/restart. Pending resume.';
              }
            }
          }
        }

        if (pipelineHasFailedStage) {
          pipelineState.status = 'failed';
        } else {
          pipelineState.status = 'paused';
        }
        await StoryRepository.savePipelineState(project.projectId, pipelineState);
        logger.info('recovery', `Recovered pipeline for project ${project.projectId} into ${pipelineState.status} state.`);
      }
    }

    logger.info('recovery', 'Crash recovery scan complete', report as unknown as Record<string, unknown>);
    return report;
  }
}
