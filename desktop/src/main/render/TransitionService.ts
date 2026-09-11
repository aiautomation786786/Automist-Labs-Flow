/**
 * TransitionService – Scene transition processing (Hard Cut & Cross Fade).
 *
 * Capabilities:
 *  - Hard Cut: Clean cut concatenation between scenes without dark artifacts or overlap
 *  - Cross Fade: Visual xfade + audio acrossfade with deterministic overlap duration
 *  - Generates transition preview clips for testing and validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TransitionStyle } from './RenderTypes';
import { SceneRenderer } from './SceneRenderer';
import { AudioDurationMeasurer } from '../tts/AudioDurationMeasurer';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export class TransitionService {
  /**
   * Renders a transition clip between two scene clips to verify transition behavior.
   */
  static async renderTransitionPreview(params: {
    sceneAVideoPath: string;
    sceneBVideoPath: string;
    outputPath: string;
    transitionStyle?: TransitionStyle;
    crossfadeDuration?: number;
  }): Promise<{ success: boolean; outputPath: string; duration: number; error?: string }> {
    const { sceneAVideoPath, sceneBVideoPath, outputPath, transitionStyle = 'hard_cut' } = params;

    if (!fs.existsSync(sceneAVideoPath)) {
      throw new Error(`Scene A video not found at ${sceneAVideoPath}`);
    }
    if (!fs.existsSync(sceneBVideoPath)) {
      throw new Error(`Scene B video not found at ${sceneBVideoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Measure scene A duration
    const durA = await AudioDurationMeasurer.measureDurationSeconds(sceneAVideoPath);
    const durB = await AudioDurationMeasurer.measureDurationSeconds(sceneBVideoPath);

    const ffmpegBin = SceneRenderer.getFfmpegPath();
    const xfadeDur = Math.min(0.75, Math.max(0.25, params.crossfadeDuration ?? 0.5));

    let filterComplex: string;
    let expectedDuration: number;

    if (transitionStyle === 'cross_fade') {
      const offset = Math.max(0.1, durA - xfadeDur);
      expectedDuration = Math.max(0.5, durA + durB - xfadeDur);
      filterComplex = `[0:v][1:v]xfade=transition=fade:duration=${xfadeDur}:offset=${offset.toFixed(3)}[v];[0:a][1:a]acrossfade=d=${xfadeDur}[a]`;
    } else {
      // Hard Cut
      expectedDuration = durA + durB;
      filterComplex = `[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]`;
    }

    const args = [
      '-y',
      '-i', sceneAVideoPath,
      '-i', sceneBVideoPath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ];

    logger.info('transition', `Rendering ${transitionStyle} preview between scenes`, {
      durA,
      durB,
      expectedDuration,
    });

    try {
      await execFileAsync(ffmpegBin, args, { timeout: 25000 });

      const measuredDuration = await AudioDurationMeasurer.measureDurationSeconds(outputPath);
      return {
        success: true,
        outputPath,
        duration: measuredDuration,
      };
    } catch (err: any) {
      logger.error('transition', `Failed to render ${transitionStyle} transition`, err as Error);
      return {
        success: false,
        outputPath,
        duration: 0,
        error: err.message,
      };
    }
  }
}
