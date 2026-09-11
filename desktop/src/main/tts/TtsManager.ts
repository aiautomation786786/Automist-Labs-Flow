/**
 * TtsManager – Central orchestrator for Infinity Flow Text-to-Speech engines.
 *
 * Responsibilities:
 *  1. Provider Registry: all 5 engines (Edge TTS, Kokoro ONNX, Azure Speech, ai33.pro, FameSpeak).
 *  2. Centralized Fallback Engine (ZBot §7):
 *     Selected Engine → Immediate Retry Once → Kokoro → Edge TTS.
 *     - Never fails a video run merely because an external voice API fails.
 *     - Voice preview strictly never cross-falls back across providers.
 *     - User cancellation (AbortSignal) terminates immediately and never triggers fallback.
 *  3. Standalone Audio Only workflow:
 *     - Synthesizes narration per-scene.
 *     - Measures exact durations with ffprobe.
 *     - Concatenates scene audio into a master audio file (audio/final_audio.mp3).
 *     - Validates master audio via ffprobe.
 *  4. Safe persistence of metadata/audio.json and story.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  ITtsProvider,
  TtsProviderId,
  TtsEngineMetadata,
  VoiceInfo,
  TtsAudioManifest,
  TtsSceneAudioResult,
  TtsSynthesizeResult,
} from './TtsTypes';
import type { StoryEntity } from '../../shared/types';
import { EdgeTtsProvider } from './EdgeTtsProvider';
import { KokoroProvider } from './KokoroProvider';
import { AzureTtsProvider } from './AzureTtsProvider';
import { Ai33TtsProvider } from './Ai33TtsProvider';
import { FameSpeakTtsProvider } from './FameSpeakTtsProvider';
import { AssetManager } from '../storage/AssetManager';
import { StoryRepository } from '../storage/StoryRepository';
import { fileMutex } from '../storage/FileMutex';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { AudioDurationMeasurer } from './AudioDurationMeasurer';
import { classifyTtsError, TtsError } from './TtsErrorClassifier';
import { AppLogger } from '../utils/AppLogger';

const execFileAsync = promisify(execFile);
const logger = new AppLogger({ mirrorToStderr: false });

export class TtsManager {
  private static providers: Map<TtsProviderId, ITtsProvider> = new Map<TtsProviderId, ITtsProvider>([
    ['edge-tts', new EdgeTtsProvider()],
    ['kokoro', new KokoroProvider()],
    ['azure', new AzureTtsProvider()],
    ['ai33', new Ai33TtsProvider()],
    ['famespeak', new FameSpeakTtsProvider()],
  ]);

  /**
   * Registers or overrides a TTS provider.
   */
  static registerProvider(provider: ITtsProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Retrieves a TTS provider by ID, defaulting to edge-tts.
   */
  static getProvider(id: TtsProviderId = 'edge-tts'): ITtsProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      const fallback = this.providers.get('edge-tts');
      if (fallback) return fallback;
      throw new Error(`TTS Provider '${id}' not found.`);
    }
    return provider;
  }

  /**
   * Returns metadata for all 5 registered engines with live availability.
   */
  static async getEnginesMetadata(): Promise<TtsEngineMetadata[]> {
    const metadataList: TtsEngineMetadata[] = [];
    for (const provider of this.providers.values()) {
      const isAvailable = await provider.isAvailable();
      const unavailableReason = isAvailable ? undefined : (provider.getUnavailableReason() || undefined);
      metadataList.push({
        id: provider.id,
        name: provider.name,
        badge: provider.badge,
        audioExtension: provider.audioExtension,
        supportsWordTimings: provider.supportsWordTimings,
        isAvailable,
        unavailableReason,
        requiresConfig: provider.badge === 'API KEY',
      });
    }
    return metadataList;
  }

  /**
   * Resolves a voice ID to a valid voice. If empty or unknown, returns the provider default.
   */
  static resolveVoice(providerId: TtsProviderId, voiceId?: string): { provider: ITtsProvider; voiceId: string } {
    const provider = this.getProvider(providerId);
    if (!voiceId || !voiceId.trim()) {
      return { provider, voiceId: provider.defaultVoiceId };
    }
    return { provider, voiceId: voiceId.trim() };
  }

  /**
   * Gathers all available voices across all registered providers.
   */
  static async listAllVoices(providerId?: TtsProviderId): Promise<VoiceInfo[]> {
    if (providerId) {
      const provider = this.providers.get(providerId);
      if (provider) {
        return await provider.listVoices();
      }
    }

    const allVoices: VoiceInfo[] = [];
    for (const provider of this.providers.values()) {
      try {
        const voices = await provider.listVoices();
        allVoices.push(...voices);
      } catch (err) {
        logger.warn('tts', `Failed to query voices for provider ${provider.id}`, { error: String(err) });
      }
    }
    return allVoices;
  }

  /**
   * Generates a voice preview strictly without falling back across providers.
   * (ZBot Rule: A preview in another engine's voice is a lie).
   */
  static async previewVoice(
    providerId: TtsProviderId,
    voiceId: string,
    sampleText = 'Welcome to Infinity Flow. This is a voice preview.'
  ): Promise<{ success: boolean; audioDataUri?: string; durationSeconds?: number; error?: string }> {
    try {
      const provider = this.getProvider(providerId);
      const resolvedVoice = voiceId && voiceId.trim() ? voiceId.trim() : provider.defaultVoiceId;

      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        return {
          success: false,
          error: provider.getUnavailableReason() || `Provider '${providerId}' is not configured or unavailable.`,
        };
      }

      const res = await provider.synthesize({
        text: sampleText,
        voiceId: resolvedVoice,
      });

      const base64 = res.audioBuffer.toString('base64');
      const mime = res.format === 'wav' ? 'audio/wav' : 'audio/mp3';
      const dataUri = `data:${mime};base64,${base64}`;

      return {
        success: true,
        audioDataUri: dataUri,
        durationSeconds: res.durationSeconds,
      };
    } catch (err: any) {
      const classified = classifyTtsError(err, providerId);
      return {
        success: false,
        error: classified.message,
      };
    }
  }

  /**
   * Centralized Fallback Synthesizer for a single scene narration.
   *
   * Flow:
   *   Selected Provider
   *         ↓ (if error, immediate retry once)
   *   Selected Provider (Retry)
   *         ↓ (if still failing)
   *   Kokoro Local ONNX
   *         ↓ (if Kokoro unavailable or error)
   *   Edge TTS (guaranteed free fallback)
   *
   * Invariant: User cancellation immediately stops execution without fallback.
   */
  static async synthesizeSceneWithFallback(
    text: string,
    requestedProviderId: TtsProviderId,
    requestedVoiceId?: string,
    outputPath?: string,
    signal?: AbortSignal,
  ): Promise<{ result: TtsSynthesizeResult; providerUsed: TtsProviderId; fallbackOccurred: boolean }> {
    if (signal?.aborted) {
      throw new TtsError('Synthesis cancelled before execution.', 'cancelled', requestedProviderId);
    }

    const trimmed = (text || '').trim();
    if (!trimmed) {
      throw new TtsError('Narration text is empty.', 'invalid_voice', requestedProviderId);
    }

    const primary = this.getProvider(requestedProviderId);
    const primaryVoiceId = requestedVoiceId && requestedVoiceId.trim() ? requestedVoiceId.trim() : primary.defaultVoiceId;

    // 1. Attempt Primary Provider
    const primaryAvail = await primary.isAvailable();
    if (primaryAvail) {
      try {
        const res = await primary.synthesize({
          text: trimmed,
          voiceId: primaryVoiceId,
          outputPath,
          signal,
        });
        return { result: res, providerUsed: requestedProviderId, fallbackOccurred: false };
      } catch (firstErr: any) {
        const classified = classifyTtsError(firstErr, requestedProviderId);
        if (classified.classification === 'cancelled' || signal?.aborted) {
          throw classified;
        }

        logger.warn('tts', `Primary provider '${requestedProviderId}' failed on attempt 1: ${firstErr.message}. Retrying once.`);

        // Immediate retry once
        try {
          const retryRes = await primary.synthesize({
            text: trimmed,
            voiceId: primaryVoiceId,
            outputPath,
            signal,
          });
          return { result: retryRes, providerUsed: requestedProviderId, fallbackOccurred: false };
        } catch (retryErr: any) {
          const retryClassified = classifyTtsError(retryErr, requestedProviderId);
          if (retryClassified.classification === 'cancelled' || signal?.aborted) {
            throw retryClassified;
          }
          logger.warn('tts', `Primary provider '${requestedProviderId}' failed on retry: ${retryErr.message}. Initiating Kokoro fallback.`);
        }
      }
    } else {
      logger.warn('tts', `Requested provider '${requestedProviderId}' is unavailable (${primary.getUnavailableReason()}). Falling back.`);
    }

    if (signal?.aborted) {
      throw new TtsError('Synthesis was cancelled.', 'cancelled', requestedProviderId);
    }

    // 2. Attempt Kokoro Local Fallback
    if (requestedProviderId !== 'kokoro') {
      const kokoro = this.getProvider('kokoro');
      const kokoroAvail = await kokoro.isAvailable();
      if (kokoroAvail) {
        try {
          logger.info('tts', `Synthesizing scene with Kokoro fallback (voice: ${kokoro.defaultVoiceId})`);
          const kokoroRes = await kokoro.synthesize({
            text: trimmed,
            voiceId: kokoro.defaultVoiceId,
            outputPath,
            signal,
          });
          return { result: kokoroRes, providerUsed: 'kokoro', fallbackOccurred: true };
        } catch (kokoroErr: any) {
          const kokoroClassified = classifyTtsError(kokoroErr, 'kokoro');
          if (kokoroClassified.classification === 'cancelled' || signal?.aborted) {
            throw kokoroClassified;
          }
          logger.warn('tts', `Kokoro fallback failed: ${kokoroErr.message}. Falling back to Edge TTS.`);
        }
      }
    }

    if (signal?.aborted) {
      throw new TtsError('Synthesis was cancelled.', 'cancelled', requestedProviderId);
    }

    // 3. Guaranteed Edge TTS Fallback
    logger.info('tts', `Executing final guaranteed Edge TTS fallback for scene.`);
    const edge = this.getProvider('edge-tts');
    try {
      const edgeRes = await edge.synthesize({
        text: trimmed,
        voiceId: edge.defaultVoiceId,
        outputPath,
        signal,
      });
      return { result: edgeRes, providerUsed: 'edge-tts', fallbackOccurred: requestedProviderId !== 'edge-tts' };
    } catch (edgeErr: any) {
      throw classifyTtsError(edgeErr, 'edge-tts');
    }
  }

  /**
   * Synthesizes narration audio for all scenes in a project with fallback.
   */
  static async synthesizeProjectNarration(
    projectId: string,
    options?: {
      provider?: TtsProviderId;
      voiceId?: string;
      onProgress?: (current: number, total: number, sceneNum: number) => void;
      signal?: AbortSignal;
    }
  ): Promise<TtsAudioManifest> {
    return await fileMutex.runExclusive(`tts:${projectId}`, async () => {
      AssetManager.ensureProjectDirectories(projectId);
      const projectDir = AssetManager.getProjectDir(projectId);
      const audioDir = path.join(projectDir, 'audio');
      const metadataDir = path.join(projectDir, 'metadata');

      if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
      if (!fs.existsSync(metadataDir)) fs.mkdirSync(metadataDir, { recursive: true });

      const story: StoryEntity | null = await StoryRepository.getStory(projectId);
      if (!story || !story.scenes || story.scenes.length === 0) {
        throw new Error(`Cannot synthesize narration: story.json does not exist or has no scenes for project ${projectId}`);
      }

      const requestedProvider = options?.provider || 'edge-tts';
      const requestedVoiceId = options?.voiceId;

      const totalScenes = story.scenes.length;
      const sceneResults: TtsSceneAudioResult[] = [];
      let totalDuration = 0;
      let projectFallbackOccurred = false;
      let lastActualProvider: TtsProviderId = requestedProvider;

      for (let i = 0; i < totalScenes; i++) {
        if (options?.signal?.aborted) {
          throw new TtsError('TTS project synthesis aborted by caller.', 'cancelled', requestedProvider);
        }

        const scene = story.scenes[i]!;
        const sceneNum = scene.sceneNumber ?? i + 1;
        const paddedNum = String(sceneNum).padStart(3, '0');
        const fileName = `scene-${paddedNum}.mp3`;
        const relativeAudioPath = `audio/${fileName}`;
        const absoluteAudioPath = path.join(audioDir, fileName);

        if (options?.onProgress) {
          options.onProgress(i + 1, totalScenes, sceneNum);
        }

        const narrationText = (scene.narration || '').trim();
        if (!narrationText) {
          sceneResults.push({
            sceneNumber: sceneNum,
            narration: '',
            audioFile: '',
            absolutePath: '',
            durationSeconds: scene.durationSeconds || 3,
            fileSizeBytes: 0,
            status: 'skipped',
            error: 'No narration text provided for this scene.',
          });
          continue;
        }

        try {
          const { result, providerUsed, fallbackOccurred } = await this.synthesizeSceneWithFallback(
            narrationText,
            requestedProvider,
            requestedVoiceId,
            absoluteAudioPath,
            options?.signal
          );

          if (fallbackOccurred) projectFallbackOccurred = true;
          lastActualProvider = providerUsed;

          const measuredDuration = result.durationSeconds;
          totalDuration += measuredDuration;
          scene.durationSeconds = measuredDuration;

          sceneResults.push({
            sceneNumber: sceneNum,
            narration: narrationText,
            audioFile: relativeAudioPath,
            absolutePath: absoluteAudioPath,
            durationSeconds: measuredDuration,
            fileSizeBytes: result.sizeBytes,
            status: 'completed',
            wordTimings: result.wordTimings,
            providerUsed,
            voiceUsed: requestedVoiceId || primaryVoiceFallback(providerUsed),
            fallbackOccurred,
            primaryProvider: requestedProvider,
          });
        } catch (err: any) {
          const classified = classifyTtsError(err, requestedProvider);
          if (classified.classification === 'cancelled') {
            throw classified;
          }

          logger.error('tts', `Failed to synthesize audio for scene ${sceneNum}`, { error: String(err) });
          sceneResults.push({
            sceneNumber: sceneNum,
            narration: narrationText,
            audioFile: relativeAudioPath,
            absolutePath: absoluteAudioPath,
            durationSeconds: scene.durationSeconds || 3,
            fileSizeBytes: 0,
            status: 'failed',
            error: classified.message,
            primaryProvider: requestedProvider,
          });
        }
      }

      await StoryRepository.saveStory(projectId, story);

      const manifest: TtsAudioManifest = {
        projectId,
        provider: requestedProvider,
        voiceId: requestedVoiceId || primaryVoiceFallback(requestedProvider),
        totalScenes,
        totalDurationSeconds: Math.round(totalDuration * 100) / 100,
        generatedAt: new Date().toISOString(),
        scenes: sceneResults,
        fallbackOccurred: projectFallbackOccurred,
        actualProvider: lastActualProvider,
      };

      const manifestPath = path.join(metadataDir, 'audio.json');
      const tempPath = `${manifestPath}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf-8');
      try {
        fs.renameSync(tempPath, manifestPath);
      } catch {
        fs.copyFileSync(tempPath, manifestPath);
        try { fs.unlinkSync(tempPath); } catch {}
      }

      return manifest;
    });
  }

  /**
   * Standalone Audio Only: Concatenates all scene audio into a master audio track.
   */
  static async combineProjectAudio(
    projectId: string,
    outputFilename = 'final_audio.mp3'
  ): Promise<{ masterAudioPath: string; durationSeconds: number }> {
    return await fileMutex.runExclusive(`tts:combine:${projectId}`, async () => {
      const projectDir = AssetManager.getProjectDir(projectId);
      const audioDir = path.join(projectDir, 'audio');
      const metadataDir = path.join(projectDir, 'metadata');
      const manifestPath = path.join(metadataDir, 'audio.json');

      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Cannot combine audio: audio manifest not found for project ${projectId}`);
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as TtsAudioManifest;

      const completedScenes = manifest.scenes
        .filter((s) => s.status === 'completed' && s.absolutePath && fs.existsSync(s.absolutePath))
        .sort((a, b) => a.sceneNumber - b.sceneNumber);

      if (completedScenes.length === 0) {
        throw new Error(`Cannot combine audio: zero completed scene audio files exist for project ${projectId}`);
      }

      const masterAudioPath = path.join(audioDir, outputFilename);
      const ffmpegBin = FfmpegResolver.findFfmpeg();

      if (ffmpegBin) {
        try {
          // Build FFmpeg audio concat filter:
          // -i scene-001.mp3 -i scene-002.mp3 ... -filter_complex "[0:a][1:a]...concat=n=N:v=0:a=1[aout]" -map "[aout]"
          const args: string[] = ['-y'];
          const filterInputs: string[] = [];

          for (let i = 0; i < completedScenes.length; i++) {
            args.push('-i', completedScenes[i].absolutePath);
            filterInputs.push(`[${i}:a]`);
          }

          const filterComplex = `${filterInputs.join('')}concat=n=${completedScenes.length}:v=0:a=1[aout]`;
          args.push('-filter_complex', filterComplex, '-map', '[aout]', '-b:a', '192k', masterAudioPath);

          await execFileAsync(ffmpegBin, args, { timeout: 30000 });
        } catch (err: any) {
          logger.warn('tts', `FFmpeg audio concatenation failed: ${err.message}. Concatenating byte streams.`);
          // Fallback simple binary concatenation for MP3 frames
          const combined = Buffer.concat(completedScenes.map((s) => fs.readFileSync(s.absolutePath)));
          fs.writeFileSync(masterAudioPath, combined);
        }
      } else {
        const combined = Buffer.concat(completedScenes.map((s) => fs.readFileSync(s.absolutePath)));
        fs.writeFileSync(masterAudioPath, combined);
      }

      const durationSeconds = await AudioDurationMeasurer.measureDurationSeconds(masterAudioPath);

      // Update manifest with master audio details
      manifest.masterAudioFile = `audio/${outputFilename}`;
      manifest.masterAudioPath = masterAudioPath;
      manifest.totalDurationSeconds = durationSeconds;

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      logger.info('tts', `Combined master audio for project ${projectId} (${durationSeconds}s) -> ${masterAudioPath}`);

      return {
        masterAudioPath,
        durationSeconds,
      };
    });
  }

  /**
   * Retrieves the audio manifest for a project.
   */
  static async getAudioManifest(projectId: string): Promise<TtsAudioManifest | null> {
    const projectDir = AssetManager.getProjectDir(projectId);
    const manifestPath = path.join(projectDir, 'metadata', 'audio.json');

    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as TtsAudioManifest;
    } catch (err) {
      logger.error('tts', `Failed to parse audio manifest for project ${projectId}`, { error: String(err) });
      return null;
    }
  }
}

function primaryVoiceFallback(providerId: TtsProviderId): string {
  switch (providerId) {
    case 'edge-tts': return 'en-US-ChristopherNeural';
    case 'kokoro': return 'am_eric';
    case 'azure': return 'en-US-JennyNeural';
    case 'ai33': return 'elevenlabs:rachel';
    case 'famespeak': return 'fs_morgan_freeman';
  }
}
