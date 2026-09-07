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
          // No valid output file -> job was interrupted mid-flight.
          if (job.retryCount < job.maxRetries) {
            logger.info('recovery', `Marking interrupted job ${job.jobId} as retry_waiting`);
            await JobRepository.updateJob(project.projectId, job.jobId, {
              status: 'retry_waiting',
              errorMessage: 'Interrupted by application restart/crash. Scheduled for recovery retry.',
            });

            await ProjectRepository.updateSlot(project.projectId, job.slotIndex, {
              status: 'queued',
            });

            report.recoveredForRetry++;
          } else {
            logger.warn('recovery', `Interrupted job ${job.jobId} has exhausted retries. Marking manual_action_required.`);
            await JobRepository.updateJob(project.projectId, job.jobId, {
              status: 'manual_action_required',
              errorMessage: 'Interrupted by application restart. Retries exhausted.',
            });

            await ProjectRepository.updateSlot(project.projectId, job.slotIndex, {
              status: 'failed',
            });

            report.recoveredManualAction++;
          }
        }
      }
    }

    logger.info('recovery', 'Crash recovery scan complete', report as unknown as Record<string, unknown>);
    return report;
  }
}
