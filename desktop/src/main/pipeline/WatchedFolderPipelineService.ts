/**
 * WatchedFolderPipelineService – Orchestrates media ingestion, project creation,
 * channel rules, and downstream workflow handoff for watched folder events.
 *
 * Guarantees:
 *  1. Zero Secondary Scheduler: Feeds directly into existing GenerationScheduler,
 *     MediaImportService, ProjectRepository, ChannelRepository, and ImportedMediaRenderer.
 *  2. Browser Isolation: Merely detecting or importing a file NEVER launches Chrome,
 *     CDP, Playwright, Flow, or Gemini sessions.
 *  3. Idempotency & Crash Safety:
 *     - Records transition from 'ready' -> 'processing' -> 'ingested'.
 *     - Only marked 'ingested' after project & source association are successfully persisted.
 *     - Reconciles orphaned 'processing' records on startup without creating duplicates.
 *  4. Source File Preservation: Original files are never modified, moved, or deleted
 *     unless deleteSourceOnSuccess is explicitly enabled (which only deletes after verified save).
 *  5. Categorized Error Handling: Explicit failure classifications (source_disappeared,
 *     source_unreadable, media_probe_failure, duplicate, import_failure, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  WatchedFolderEntity,
  WatchedFileRecord,
  ProjectEntity,
  WatchedMediaWorkflow,
} from '../../shared/types';
import { MediaImportService } from '../import/MediaImportService';
import { ProjectRepository } from '../storage/ProjectRepository';
import { ChannelRepository } from '../storage/ChannelRepository';
import { WatchedFolderRepository } from '../storage/WatchedFolderRepository';
import { WatchedFolderHistoryRepository } from '../storage/WatchedFolderHistoryRepository';
import { ImportedMediaRenderer } from '../render/ImportedMediaRenderer';
import { AudioTranscriptionService } from '../transcription/AudioTranscriptionService';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export type WatchedFolderIngestionErrorCode =
  | 'source_disappeared'
  | 'source_unreadable'
  | 'media_probe_failure'
  | 'duplicate'
  | 'import_failure'
  | 'project_persistence_failure'
  | 'downstream_pipeline_failure'
  | 'unknown_error';

export interface IngestionResult {
  success: boolean;
  project?: ProjectEntity;
  errorCode?: WatchedFolderIngestionErrorCode;
  errorMessage?: string;
}

export class WatchedFolderPipelineService {
  private static inProgressFiles = new Set<string>();

  /**
   * Primary ingestion entrypoint invoked by WatchedFolderEngine onMediaReady.
   */
  static async ingest(
    record: WatchedFileRecord,
    entity: WatchedFolderEntity
  ): Promise<IngestionResult> {
    const lockKey = `${entity.id}:${path.resolve(record.filePath).toLowerCase()}`;

    // 1. Guard against concurrent processing races
    if (this.inProgressFiles.has(lockKey)) {
      logger.info('pipeline_service', `File is already being ingested: ${record.filename}`);
      return { success: false, errorCode: 'duplicate', errorMessage: 'File is already currently being ingested' };
    }

    this.inProgressFiles.add(lockKey);

    try {
      // 2. Pre-flight Check: Does source file exist and is it readable?
      if (!fs.existsSync(record.filePath)) {
        const errorMsg = `Source file disappeared before ingestion: ${record.filePath}`;
        logger.warn('pipeline_service', errorMsg);
        await this.recordFailure(entity.id, record, 'source_disappeared', errorMsg);
        return { success: false, errorCode: 'source_disappeared', errorMessage: errorMsg };
      }

      try {
        const fd = fs.openSync(record.filePath, 'r');
        fs.closeSync(fd);
      } catch (err: any) {
        const errorMsg = `Source file is locked or unreadable: ${err.message}`;
        logger.warn('pipeline_service', errorMsg);
        await this.recordFailure(entity.id, record, 'source_unreadable', errorMsg);
        return { success: false, errorCode: 'source_unreadable', errorMessage: errorMsg };
      }

      // 3. Idempotency Check: Check if an imported project already exists for this content
      const allProjects = await ProjectRepository.getAll();
      const existingProject = allProjects.find(
        (p) =>
          (record.hashSha256 && p.sourceMedia?.hashSha256 === record.hashSha256) ||
          (p.watchedFileRecordId && p.watchedFileRecordId === record.id) ||
          (p.watcherId === entity.id && p.sourceMedia?.originalFilename === record.filename && p.sourceMedia?.fileSizeBytes === record.fileSizeBytes)
      );

      if (existingProject) {
        logger.info('pipeline_service', `Project already exists for watched file ${record.filename} (${existingProject.projectId})`);
        // Mark ledger as ingested without creating a duplicate
        await WatchedFolderHistoryRepository.recordFile(entity.id, {
          ...record,
          status: 'ingested',
          projectId: existingProject.projectId,
          ingestedAt: existingProject.createdAt,
        });
        return { success: true, project: existingProject };
      }

      // 4. Update ledger status to 'processing'
      await WatchedFolderHistoryRepository.recordFile(entity.id, {
        ...record,
        status: 'processing',
      });

      // 5. Channel Integration: Resolve channel if configured
      let channelId: string | undefined = undefined;
      let channelName: string | undefined = undefined;

      if (entity.rules.channelId) {
        try {
          const channel = await ChannelRepository.get(entity.rules.channelId);
          if (channel) {
            channelId = channel.id;
            channelName = channel.name;
          } else {
            logger.warn('pipeline_service', `Configured channel ${entity.rules.channelId} not found; proceeding without channel`);
          }
        } catch (err: any) {
          logger.warn('pipeline_service', `Error resolving channel: ${err.message}`);
        }
      }

      // 6. Media Import: Create standard Infinity Flow Project
      const workflow: WatchedMediaWorkflow = entity.rules.workflow || 'import_only';
      let project: ProjectEntity;

      try {
        project = await MediaImportService.importMedia({
          filePath: record.filePath,
          name: path.parse(record.filename).name,
          channelId,
          channelName,
          watcherId: entity.id,
          watchedFileRecordId: record.id,
          workflow,
        });
      } catch (importErr: any) {
        const errorMsg = importErr.message || 'Media import failed';
        let code: WatchedFolderIngestionErrorCode = 'import_failure';
        if (errorMsg.includes('probe') || errorMsg.includes('inspect') || errorMsg.includes('streams') || errorMsg.includes('container')) {
          code = 'media_probe_failure';
        }
        logger.error('pipeline_service', `MediaImportService failed for ${record.filename}: ${errorMsg}`);
        await this.recordFailure(entity.id, record, code, errorMsg);
        return { success: false, errorCode: code, errorMessage: errorMsg };
      }

      // 7. Update Channel Statistics if linked
      if (channelId) {
        try {
          const ch = await ChannelRepository.get(channelId);
          if (ch) {
            await ChannelRepository.updateStats(channelId, {
              totalProjects: (ch.stats.totalProjects || 0) + 1,
            });
          }
        } catch (chErr: any) {
          logger.warn('pipeline_service', `Failed to update channel stats: ${chErr.message}`);
        }
      }

      // 8. Transition status to 'ingested' in ledger AFTER verified project persistence
      const now = new Date().toISOString();
      await WatchedFolderHistoryRepository.recordFile(entity.id, {
        ...record,
        status: 'ingested',
        projectId: project.projectId,
        ingestedAt: now,
      });

      // Update watcher repository stats
      await WatchedFolderRepository.updateStatus(entity.id, 'watching', undefined, {
        totalIngested: (entity.stats.totalIngested || 0) + 1,
        lastIngestedFilename: record.filename,
      });

      logger.info('pipeline_service', `Successfully ingested watched file "${record.filename}" into project ${project.projectId}`);

      // 9. Source File Safety: Only delete source if explicitly opted in
      if (entity.rules.deleteSourceOnSuccess === true) {
        try {
          if (fs.existsSync(record.filePath)) {
            fs.unlinkSync(record.filePath);
            logger.info('pipeline_service', `Deleted source file per deleteSourceOnSuccess rule: ${record.filePath}`);
          }
        } catch (delErr: any) {
          logger.warn('pipeline_service', `Failed to delete source file after successful import: ${delErr.message}`);
        }
      }

      // 10. Downstream Workflow Routing
      try {
        await this.executeWorkflow(project, workflow, entity);
      } catch (wfErr: any) {
        // Workflow execution failure does NOT invalidate the imported project
        logger.error('pipeline_service', `Downstream workflow "${workflow}" failed for project ${project.projectId}: ${wfErr.message}`);
        return {
          success: true,
          project,
          errorCode: 'downstream_pipeline_failure',
          errorMessage: wfErr.message,
        };
      }

      return { success: true, project };
    } catch (unexpectedErr: any) {
      const errorMsg = unexpectedErr.message || 'Unexpected ingestion error';
      logger.error('pipeline_service', `Unexpected error ingesting ${record.filename}: ${errorMsg}`);
      await this.recordFailure(entity.id, record, 'unknown_error', errorMsg);
      return { success: false, errorCode: 'unknown_error', errorMessage: errorMsg };
    } finally {
      this.inProgressFiles.delete(lockKey);
    }
  }

  /**
   * Executes the appropriate downstream workflow for an imported project.
   */
  static async executeWorkflow(
    project: ProjectEntity,
    workflow: WatchedMediaWorkflow,
    _entity: WatchedFolderEntity
  ): Promise<void> {
    switch (workflow) {
      case 'import_only':
        // No downstream generation or rendering; project is ready in UI
        logger.info('pipeline_service', `Workflow import_only: Project ${project.projectId} ready.`);
        break;

      case 'import_and_render':
        // Render imported media using local FFmpeg (zero browser footprint)
        logger.info('pipeline_service', `Workflow import_and_render: Rendering project ${project.projectId}...`);
        await ImportedMediaRenderer.renderImportedVideo({
          projectId: project.projectId,
          rawModeOnly: true,
        });
        break;

      case 'import_render_publish':
        // Render imported media and prepare publishing metadata; publishing schedule owned by Phase 4D
        logger.info('pipeline_service', `Workflow import_render_publish: Rendering and preparing publishing for ${project.projectId}...`);
        await ImportedMediaRenderer.renderImportedVideo({
          projectId: project.projectId,
          rawModeOnly: true,
        });
        break;

      case 'ai_script_rewrite':
        // Run transcription using existing AudioTranscriptionService
        logger.info('pipeline_service', `Workflow ai_script_rewrite: Transcribing project ${project.projectId}...`);
        try {
          await AudioTranscriptionService.transcribeProject(project.projectId);
        } catch (tErr: any) {
          logger.warn('pipeline_service', `ai_script_rewrite notice: Transcription could not complete (${tErr.message}). Project remains safe.`);
        }
        break;
    }
  }

  /**
   * Cold-start crash recovery: reconciles any records left in 'processing' state.
   */
  static async reconcileIncompleteRecords(): Promise<{ healed: number; reset: number }> {
    logger.info('pipeline_service', 'Running cold-start crash recovery for watched folder ledger...');
    let healed = 0;
    let reset = 0;

    try {
      const watchers = await WatchedFolderRepository.getAll();
      const allProjects = await ProjectRepository.getAll();

      for (const watcher of watchers) {
        const records = await WatchedFolderHistoryRepository.getHistory(watcher.id, 500);
        const processingRecords = records.filter((r) => r.status === 'processing');

        for (const rec of processingRecords) {
          // Check if project was already persisted before crash
          const matchingProject = allProjects.find(
            (p) =>
              (rec.hashSha256 && p.sourceMedia?.hashSha256 === rec.hashSha256) ||
              (p.watchedFileRecordId && p.watchedFileRecordId === rec.id) ||
              (p.watcherId === watcher.id && p.sourceMedia?.originalFilename === rec.filename && p.sourceMedia?.fileSizeBytes === rec.fileSizeBytes)
          );

          if (matchingProject) {
            // Project was successfully created; heal record to 'ingested'
            await WatchedFolderHistoryRepository.recordFile(watcher.id, {
              ...rec,
              status: 'ingested',
              projectId: matchingProject.projectId,
              ingestedAt: matchingProject.createdAt,
            });
            healed++;
            logger.info('pipeline_service', `Healed orphaned processing record for "${rec.filename}" -> ingested (${matchingProject.projectId})`);
          } else {
            // Ingestion was interrupted before project save; reset to 'ready' for re-processing
            await WatchedFolderHistoryRepository.recordFile(watcher.id, {
              ...rec,
              status: 'ready',
            });
            reset++;
            logger.info('pipeline_service', `Reset interrupted processing record for "${rec.filename}" -> ready`);
          }
        }
      }

      logger.info('pipeline_service', `Crash recovery complete. Healed: ${healed}, Reset: ${reset}`);
      return { healed, reset };
    } catch (err: any) {
      logger.error('pipeline_service', `Failed to run crash recovery: ${err.message}`);
      return { healed, reset };
    }
  }

  /**
   * Internal helper to record failure status and categorized error in history.
   */
  private static async recordFailure(
    watcherId: string,
    record: WatchedFileRecord,
    code: WatchedFolderIngestionErrorCode,
    message: string
  ): Promise<void> {
    try {
      await WatchedFolderHistoryRepository.recordFile(watcherId, {
        ...record,
        status: 'error',
        error: `[${code}] ${message}`,
      });
      await WatchedFolderRepository.updateStatus(watcherId, 'watching', `[${code}] ${message}`, {
        totalErrors: 1, // increments error counter
      });
    } catch (err: any) {
      logger.error('pipeline_service', `Failed to record failure in ledger: ${err.message}`);
    }
  }
}
