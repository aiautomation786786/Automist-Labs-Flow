/**
 * RenderTypes – Shared internal types for Phase 5 Motion & Subtitle rendering.
 */

import type {
  MotionStyle,
  TransitionStyle,
  SupportedAspectRatio,
  RenderSceneStatus,
  RenderProgressEvent,
  RenderSceneResult,
  RenderManifest,
} from '../../shared/types';
import type { WordTiming } from '../tts/TtsTypes';

export type SubtitleStyleId = 'bottom_glass' | 'solid_bar' | 'neon_punch' | 'cinema_yellow';

export interface RenderSceneOptions {
  projectId: string;
  sceneNumber: number;
  imagePath: string;
  audioPath: string;
  durationSeconds: number;
  motionStyle: MotionStyle;
  transitionStyle: TransitionStyle;
  subtitleStyle?: string;
  subtitlesEnabled: boolean;
  aspectRatio: SupportedAspectRatio;
  outputVideoPath: string;
  outputAssPath?: string;
  narrationText?: string;
  wordTimings?: WordTiming[];
  fps?: number;
  signal?: AbortSignal;
  motionEnabled?: boolean;
  attempt?: number;
  maxAttempts?: number;
  clipMotionKey?: string;
  renderVersion?: number;
  watchdogTimeoutMs?: number;
  onProgress?: (progressPercent: number) => void;
}

export interface RenderProjectOptions {
  projectId: string;
  motionStyle?: MotionStyle;
  transitionStyle?: TransitionStyle;
  subtitleStyle?: string;
  subtitlesEnabled?: boolean;
  motionEnabled?: boolean;
  concurrency?: number;
  forceRerender?: boolean;
  attempt?: number;
  watchdogTimeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: RenderProgressEvent) => void;
}

export type {
  MotionStyle,
  TransitionStyle,
  SupportedAspectRatio,
  RenderSceneStatus,
  RenderProgressEvent,
  RenderSceneResult,
  RenderManifest,
  WordTiming,
};
