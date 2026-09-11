/**
 * FinalAudioMixer – Filtergraph builder for speech + background music mixing.
 *
 * Capabilities:
 *  - Indefinite music looping (-stream_loop -1) for tracks shorter than video
 *  - Deterministic trimming to exact video duration with smooth outro fade (1.5s)
 *  - Configurable music volume (0.0 to 1.0, default 0.20)
 *  - Hardware/software sidechain compression ducking (sidechaincompress)
 *  - Speech pad split (asplit=2) preventing FFmpeg multi-consumer pad reuse errors
 *  - Broadcast standard loudness normalization (loudnorm=I=-14:TP=-1.5:LRA=11)
 */

import * as fs from 'fs';
import type { AudioMixFilterResult } from './FinalRenderTypes';

export interface AudioMixerOptions {
  speechPad: string; // e.g. '[a_speech]'
  bgmInputIndex: number; // e.g. 3 if 3 video inputs [0, 1, 2] precede it
  bgmPath?: string;
  finalDuration: number; // in seconds
  musicEnabled?: boolean;
  musicVolume?: number; // 0.0 to 1.0, default 0.20
  duckingEnabled?: boolean; // default true
  applyLoudnorm?: boolean; // default true
}

export class FinalAudioMixer {
  /**
   * Builds the FFmpeg input arguments and filtergraph parts for final audio mixing.
   */
  static buildAudioMixFilter(options: AudioMixerOptions): AudioMixFilterResult {
    const {
      speechPad,
      bgmInputIndex,
      bgmPath,
      finalDuration,
      musicEnabled = true,
      musicVolume = 0.20,
      duckingEnabled = true,
      applyLoudnorm = true,
    } = options;

    const safeDuration = Math.max(0.5, finalDuration);
    const hasValidMusic = Boolean(
      musicEnabled &&
      bgmPath &&
      typeof bgmPath === 'string' &&
      bgmPath.trim().length > 0 &&
      fs.existsSync(bgmPath)
    );

    if (!hasValidMusic) {
      // Speech-only mode: normalize or passthrough
      if (applyLoudnorm) {
        const filterParts = [`${speechPad}loudnorm=I=-14:TP=-1.5:LRA=11[a_final]`];
        return {
          extraInputArgs: [],
          filterComplexParts: filterParts,
          outputAudioPad: '[a_final]',
        };
      }
      return {
        extraInputArgs: [],
        filterComplexParts: [],
        outputAudioPad: speechPad,
      };
    }

    // Music mode:
    const safeBgmPath = bgmPath!.trim();
    const clampedVolume = Math.min(1.0, Math.max(0.0, musicVolume));
    const outroFadeDuration = Math.min(1.5, Math.max(0.3, safeDuration * 0.2));
    const outroStartTime = Math.max(0.0, safeDuration - outroFadeDuration);

    // Extra input arguments: loop music indefinitely before input index
    const extraInputArgs = ['-stream_loop', '-1', '-i', safeBgmPath];

    const filterParts: string[] = [];

    // Step 1: Trim music to exact duration, apply user volume, and apply outro fade-out
    const bgmSourcePad = `[${bgmInputIndex}:a]`;
    const trimmedBgmPad = '[bgm_trimmed]';
    filterParts.push(
      `${bgmSourcePad}volume=${clampedVolume.toFixed(3)},atrim=0:${safeDuration.toFixed(3)},afade=t=out:st=${outroStartTime.toFixed(3)}:d=${outroFadeDuration.toFixed(3)}${trimmedBgmPad}`
    );

    if (duckingEnabled) {
      // Step 2: Split speech into 2 pads: one for sidechain ducking detector, one for voice mixing
      // This is crucial: FFmpeg filtergraph pads cannot be consumed more than once!
      const scVoicePad = '[sc_voice]';
      const mixVoicePad = '[mix_voice]';
      filterParts.push(`${speechPad}asplit=2${scVoicePad}${mixVoicePad}`);

      // Step 3: Apply sidechain compressor to music using spoken voice as control signal
      const duckedBgmPad = '[ducked_bgm]';
      filterParts.push(
        `${trimmedBgmPad}${scVoicePad}sidechaincompress=threshold=0.08:ratio=4:attack=20:release=250${duckedBgmPad}`
      );

      // Step 4: Mix spoken voice with ducked background music
      const mixedPad = '[a_mixed]';
      filterParts.push(
        `${mixVoicePad}${duckedBgmPad}amix=inputs=2:duration=first:dropout_transition=2,volume=1.5${mixedPad}`
      );

      // Step 5: Final broadcast loudness normalization
      if (applyLoudnorm) {
        filterParts.push(`${mixedPad}loudnorm=I=-14:TP=-1.5:LRA=11[a_final]`);
        return {
          extraInputArgs,
          filterComplexParts: filterParts,
          outputAudioPad: '[a_final]',
          musicTrackMetadata: {
            originalFilename: safeBgmPath,
            projectAudioPath: safeBgmPath,
            volume: clampedVolume,
            duckingEnabled: true,
            looped: true,
            trimmed: true,
          },
        };
      } else {
        return {
          extraInputArgs,
          filterComplexParts: filterParts,
          outputAudioPad: mixedPad,
          musicTrackMetadata: {
            originalFilename: safeBgmPath,
            projectAudioPath: safeBgmPath,
            volume: clampedVolume,
            duckingEnabled: true,
            looped: true,
            trimmed: true,
          },
        };
      }
    } else {
      // No ducking: directly mix speech and trimmed music
      const mixedPad = '[a_mixed]';
      filterParts.push(
        `${speechPad}${trimmedBgmPad}amix=inputs=2:duration=first:dropout_transition=2${mixedPad}`
      );

      if (applyLoudnorm) {
        filterParts.push(`${mixedPad}loudnorm=I=-14:TP=-1.5:LRA=11[a_final]`);
        return {
          extraInputArgs,
          filterComplexParts: filterParts,
          outputAudioPad: '[a_final]',
          musicTrackMetadata: {
            originalFilename: safeBgmPath,
            projectAudioPath: safeBgmPath,
            volume: clampedVolume,
            duckingEnabled: false,
            looped: true,
            trimmed: true,
          },
        };
      } else {
        return {
          extraInputArgs,
          filterComplexParts: filterParts,
          outputAudioPad: mixedPad,
          musicTrackMetadata: {
            originalFilename: safeBgmPath,
            projectAudioPath: safeBgmPath,
            volume: clampedVolume,
            duckingEnabled: false,
            looped: true,
            trimmed: true,
          },
        };
      }
    }
  }
}
