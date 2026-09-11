/**
 * FinalRenderTypes – Shared types for Phase 6 Final Video Assembly, Music & Muxing.
 */

import type {
  TransitionStyle,
  FinalRenderStatus,
  FinalAssemblyOptions,
  FinalRenderProgressEvent,
  FinalRenderManifest,
} from '../../shared/types';

export interface SceneClipInfo {
  sceneNumber: number;
  videoPath: string;
  audioPath?: string;
  durationSeconds: number;
}

export interface AudioMixFilterResult {
  extraInputArgs: string[];
  filterComplexParts: string[];
  outputAudioPad: string;
  musicTrackMetadata?: {
    originalFilename: string;
    projectAudioPath: string;
    volume: number;
    duckingEnabled: boolean;
    looped: boolean;
    trimmed: boolean;
  };
}

export interface FinalAssemblyServiceParams {
  projectId: string;
  sceneClips: SceneClipInfo[];
  outputVideoPath: string;
  outputThumbnailPath: string;
  outputPosterPath: string;
  options: FinalAssemblyOptions;
  signal?: AbortSignal;
  onProgress?: (event: FinalRenderProgressEvent) => void;
}

export interface FinalAssemblyServiceResult {
  success: boolean;
  outputVideoPath: string;
  thumbnailPath?: string;
  posterPath?: string;
  durationSeconds: number;
  fileSizeBytes: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  musicTrack?: {
    originalFilename: string;
    projectAudioPath: string;
    volume: number;
    duckingEnabled: boolean;
    looped: boolean;
    trimmed: boolean;
  };
  error?: string;
}

export interface FinalVideoProbeResult {
  valid: boolean;
  durationSeconds: number;
  fileSizeBytes: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  error?: string;
}

export type {
  TransitionStyle,
  FinalRenderStatus,
  FinalAssemblyOptions,
  FinalRenderProgressEvent,
  FinalRenderManifest,
};
