/**
 * GenerationEventBus – Strongly typed internal event bus for generation and scheduler updates.
 *
 * SAFETY RULE:
 *  Payloads contain ONLY serializable JSON data (IDs, slot indexes, statuses, file paths).
 *  Never expose Playwright Page, Browser, Context, or child_process handles.
 */

import { EventEmitter } from 'events';
import type {
  JobProgressEvent,
  SlotUpdatedEvent,
  ProjectEntity,
  GenerationJobEntity,
} from '../../shared/types';

export interface GenerationEventMap {
  'project:created': (project: ProjectEntity) => void;
  'project:updated': (project: ProjectEntity) => void;

  'slot:updated': (event: SlotUpdatedEvent) => void;

  'job:created': (job: GenerationJobEntity) => void;
  'job:queued': (job: GenerationJobEntity) => void;
  'job:assigned': (job: GenerationJobEntity, profileId: string) => void;
  'job:started': (job: GenerationJobEntity) => void;
  'job:progress': (event: JobProgressEvent) => void;
  'job:completed': (job: GenerationJobEntity) => void;
  'job:failed': (job: GenerationJobEntity) => void;
  'job:retrying': (job: GenerationJobEntity, retryCount: number) => void;
  'job:cancelled': (job: GenerationJobEntity) => void;

  'worker:available': (profileId: string) => void;
  'worker:busy': (profileId: string, jobId: string) => void;
  'worker:error': (profileId: string, errorMessage: string) => void;

  'media:downloaded': (data: {
    projectId: string;
    jobId: string;
    slotIndex: number;
    filePath: string;
    bytes: number;
  }) => void;
}

export class GenerationEventBus extends EventEmitter {
  /**
   * Typed emission helper.
   */
  emitTyped<K extends keyof GenerationEventMap>(
    event: K,
    ...args: Parameters<GenerationEventMap[K]>
  ): boolean {
    return this.emit(event, ...args);
  }

  /**
   * Typed subscription helper.
   */
  onTyped<K extends keyof GenerationEventMap>(
    event: K,
    listener: GenerationEventMap[K]
  ): this {
    return this.on(event, listener as (...args: unknown[]) => void);
  }
}

/** Global singleton event bus for the desktop application */
export const generationEventBus = new GenerationEventBus();
