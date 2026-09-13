/**
 * AudioTranscriptionService – Speech-to-text transcription engine using FFmpeg audio extraction
 * and Google Gemini multimodal audio API.
 *
 * Guarantees:
 *  1. Production Key Guard: If no Gemini API key is configured, transcription is rejected
 *     with an actionable error. Never silently generates mock transcripts in production.
 *  2. Test-Only Mock Isolation: Test-only mock providers are used strictly when explicitly
 *     configured in automated test harnesses.
 *  3. Single Unified FFmpeg Engine: Reuses FfmpegResolver, stall watchdog, -nostdin,
 *     -progress pipe:1, cancellation signal, and mapFfmpegErrorMessage.
 *  4. Verified Segment Cues: Validates startMs, endMs, text; never fabricates timestamps
 *     or claims unverified word-level accuracy.
 *  5. Concurrency & Cancellation: Supports cancellation via AbortSignal; cleans up temporary
 *     audio files upon abort or completion.
 *  6. Atomic Persistence: Writes metadata/transcript.json atomically.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { spawn } from 'child_process';
import type {
  TranscriptEntity,
  TranscriptCue,
} from '../../shared/types';
import { AssetManager } from '../storage/AssetManager';
import { ProjectRepository } from '../storage/ProjectRepository';
import { FfmpegResolver } from '../utils/FfmpegResolver';
import { FfmpegProgressParser, mapFfmpegErrorMessage } from '../render/FfmpegProgressParser';
import { SettingsManager } from '../storage/SettingsManager';
import { GeminiApiKeyManager } from '../ai/GeminiApiKeyManager';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface ITestMockTranscriptionProvider {
  transcribe(audioBuffer: Buffer, signal?: AbortSignal): Promise<{ fullText: string; cues: TranscriptCue[] }>;
}

export class AudioTranscriptionService {
  private static activeJobs = new Map<string, AbortController>();
  private static testMockProvider: ITestMockTranscriptionProvider | null = null;

  /**
   * Injects a test-only mock transcription provider for automated unit tests.
   * In production, this is null.
   */
  static setTestMockProvider(provider: ITestMockTranscriptionProvider | null): void {
    this.testMockProvider = provider;
  }

  /**
   * Cancels any active transcription task for a project.
   */
  static cancelTranscription(projectId: string): void {
    const controller = this.activeJobs.get(projectId);
    if (controller) {
      controller.abort();
      this.activeJobs.delete(projectId);
      logger.info('transcription', `Cancelled active transcription for project ${projectId}`);
    }
  }

  /**
   * Extracts a 16kHz mono audio MP3 track from a video using FFmpeg.
   */
  static async extractAudio(
    videoPath: string,
    outputAudioPath: string,
    options: {
      watchdogTimeoutMs?: number;
      signal?: AbortSignal;
      onProgress?: (percent: number) => void;
    } = {}
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Source video not found for audio extraction: ${videoPath}`);
    }

    const ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';
    const watchdogTimeoutMs = options.watchdogTimeoutMs ?? 60_000;
    const signal = options.signal;

    if (signal?.aborted) {
      throw new Error('Audio extraction cancelled before start.');
    }

    const ffmpegArgs = [
      '-y',
      '-nostdin',
      '-progress', 'pipe:1',
      '-i', videoPath,
      '-vn',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '64k',
      outputAudioPath,
    ];

    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      let watchdogTimer: NodeJS.Timeout | null = null;

      const child = spawn(ffmpegBin, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const progressParser = new FfmpegProgressParser((data) => {
        if (data.progress === 'end') {
          options.onProgress?.(100);
          return;
        }
        if (typeof data.outTimeSec === 'number') {
          options.onProgress?.(Math.min(95, Math.round(data.outTimeSec * 10)));
        }
      });

      if (child.stdout) {
        child.stdout.on('data', (chunk) => progressParser.feed(chunk));
      }

      let stderrOutput = '';
      if (child.stderr) {
        child.stderr.on('data', (d) => {
          stderrOutput += d.toString();
        });
      }

      const cleanup = () => {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        if (!isDone) {
          isDone = true;
          if (fs.existsSync(outputAudioPath)) {
            try { fs.unlinkSync(outputAudioPath); } catch {}
          }
        }
      };

      watchdogTimer = setTimeout(() => {
        logger.error('transcription', `Audio extraction watchdog triggered after ${watchdogTimeoutMs}ms.`);
        cleanup();
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`Audio extraction timed out after ${watchdogTimeoutMs}ms (watchdog triggered).`));
      }, watchdogTimeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          try { child.kill('SIGKILL'); } catch {}
          reject(new Error('Audio extraction was cancelled by user.'));
        });
      }

      child.on('error', (err) => {
        cleanup();
        reject(new Error(`FFmpeg spawn error during audio extraction: ${err.message}`));
      });

      child.on('close', (code) => {
        if (isDone) return;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        isDone = true;

        if (code === 0) {
          progressParser.flush();
          resolve();
        } else {
          cleanup();
          const tailErr = stderrOutput.slice(-400);
          logger.error('transcription', `Audio extraction failed with exit code ${code}`, { stderr: tailErr });
          const userMessage = mapFfmpegErrorMessage(code, tailErr, 'Audio extraction failed');
          reject(new Error(userMessage));
        }
      });
    });

    if (!fs.existsSync(outputAudioPath) || fs.statSync(outputAudioPath).size === 0) {
      throw new Error('Audio extraction completed but resulting audio file is missing or empty.');
    }

    return outputAudioPath;
  }

  /**
   * Validates and normalizes raw Gemini JSON transcript response.
   */
  static validateTranscriptCues(rawText: string): { fullText: string; cues: TranscriptCue[] } {
    let clean = rawText.trim();
    // Strip markdown code fences if wrapped in ```json ... ```
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch (err: any) {
      throw new Error(`Malformed JSON returned from Gemini transcription: ${err.message}`);
    }

    let rawCues: any[] = [];
    if (Array.isArray(parsed)) {
      rawCues = parsed;
    } else if (parsed && Array.isArray(parsed.cues)) {
      rawCues = parsed.cues;
    } else if (parsed && Array.isArray(parsed.segments)) {
      rawCues = parsed.segments;
    } else {
      throw new Error('Gemini transcription response did not contain a cues array.');
    }

    const validatedCues: TranscriptCue[] = [];
    for (let i = 0; i < rawCues.length; i++) {
      const item = rawCues[i];
      if (!item || typeof item !== 'object') continue;

      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!text) continue;

      let startMs = typeof item.startMs === 'number' ? Math.round(item.startMs) : -1;
      let endMs = typeof item.endMs === 'number' ? Math.round(item.endMs) : -1;

      // Handle seconds fallback if returned as start/end
      if (startMs < 0 && typeof item.start === 'number') {
        startMs = Math.round(item.start * 1000);
      }
      if (endMs < 0 && typeof item.end === 'number') {
        endMs = Math.round(item.end * 1000);
      }

      if (startMs < 0 || endMs <= startMs) {
        // Skip cues with invalid or non-chronological timestamps (do not fabricate)
        continue;
      }

      const cue: TranscriptCue = {
        cueIndex: validatedCues.length,
        startMs,
        endMs,
        text,
      };

      if (Array.isArray(item.words)) {
        cue.words = item.words
          .filter((w: any) => w && typeof w.word === 'string' && typeof w.startMs === 'number' && typeof w.endMs === 'number' && w.endMs > w.startMs)
          .map((w: any) => ({
            word: w.word.trim(),
            startMs: Math.round(w.startMs),
            endMs: Math.round(w.endMs),
          }));
      }

      validatedCues.push(cue);
    }

    // Sort strictly by startMs ascending
    validatedCues.sort((a, b) => a.startMs - b.startMs);
    // Re-index cues sequentially
    validatedCues.forEach((c, idx) => { c.cueIndex = idx; });

    const fullText = validatedCues.map((c) => c.text).join(' ');
    return { fullText, cues: validatedCues };
  }

  /**
   * Calls the Google Gemini multimodal generateContent API with base64 audio.
   */
  private static async callGeminiAudioApi(
    audioBuffer: Buffer,
    apiKey: string,
    model = 'gemini-3.6-flash',
    signal?: AbortSignal
  ): Promise<string> {
    const base64Audio = audioBuffer.toString('base64');
    const prompt =
      'Transcribe this audio precisely. Return ONLY a valid JSON array of segment cues without markdown formatting. ' +
      'Each element must have: "cueIndex" (number), "startMs" (integer start time in milliseconds), "endMs" (integer end time in milliseconds), "text" (transcribed speech text). ' +
      'Do not fabricate timestamps. Return [] if no speech is detected.';

    const payload = JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: 'audio/mp3',
                data: base64Audio,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: 'application/json',
      },
    });

    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`);

    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Transcription request aborted.'));
      }

      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 45_000,
        },
        (res) => {
          let responseBody = '';
          res.on('data', (chunk) => { responseBody += chunk; });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const jsonRes = JSON.parse(responseBody);
                const candidateText = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (typeof candidateText === 'string') {
                  resolve(candidateText);
                } else {
                  reject(new Error(`Unexpected Gemini response format: ${responseBody.slice(0, 200)}`));
                }
              } catch (e: any) {
                reject(new Error(`Failed to parse Gemini response JSON: ${e.message}`));
              }
            } else if (res.statusCode === 429) {
              reject(new Error('Gemini API quota exhausted (429 RESOURCE_EXHAUSTED).'));
            } else {
              reject(new Error(`Gemini API error (status ${res.statusCode}): ${responseBody.slice(0, 300)}`));
            }
          });
        }
      );

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Transcription cancelled by caller.'));
        });
      }

      req.on('error', (err) => reject(new Error(`Gemini network error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Gemini request timed out after 45s.'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Coordinates full audio transcription workflow for an imported project.
   */
  static async transcribeProject(projectId: string): Promise<TranscriptEntity> {
    const project = await ProjectRepository.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found.`);
    }

    if (!project.sourceMedia) {
      throw new Error(`Project ${projectId} is not an imported media project (no sourceMedia).`);
    }

    if (!project.sourceMedia.hasAudio) {
      throw new Error('This video has no audio track, so transcription is unavailable.');
    }

    // PRODUCTION KEY GUARD: Check if Gemini key is present or test mock is injected
    const keyManager = GeminiApiKeyManager.getInstance();
    const settingsKeys = SettingsManager.getScriptAiKeys();
    const hasKeys = keyManager.getKeyCount() > 0 || settingsKeys.length > 0;

    if (!hasKeys && !this.testMockProvider) {
      throw new Error('Gemini transcription requires a configured Gemini API key. Please add your API key in Settings.');
    }

    // Register active abort controller
    const abortController = new AbortController();
    this.activeJobs.set(projectId, abortController);
    const signal = abortController.signal;

    const projectDir = AssetManager.getProjectDir(projectId);
    const videoFullPath = path.join(projectDir, project.sourceMedia.mediaPath);
    const tempAudioPath = path.join(os.tmpdir(), `extract_${projectId}_${Date.now()}.mp3`);

    try {
      // 1. Stage: Extracting Audio
      generationEventBus.emit('transcript:progress', {
        projectId,
        percent: 15,
        stage: 'Extracting speech audio from video...',
      });

      await this.extractAudio(videoFullPath, tempAudioPath, {
        signal,
        watchdogTimeoutMs: 60_000,
        onProgress: (p) => {
          generationEventBus.emit('transcript:progress', {
            projectId,
            percent: 15 + Math.round(p * 0.25),
            stage: 'Extracting speech audio...',
          });
        },
      });

      // 2. Stage: Transcribing Audio
      generationEventBus.emit('transcript:progress', {
        projectId,
        percent: 50,
        stage: 'Transcribing speech with Gemini Audio API...',
      });

      const audioBuffer = fs.readFileSync(tempAudioPath);
      let fullText = '';
      let cues: TranscriptCue[] = [];
      let providerName: 'gemini' | 'mock' = 'gemini';

      if (this.testMockProvider) {
        // Test-only mock execution
        const mockResult = await this.testMockProvider.transcribe(audioBuffer, signal);
        fullText = mockResult.fullText;
        cues = mockResult.cues;
        providerName = 'mock';
      } else {
        // Production execution: Rotate across keys on 429 if needed
        let rawResponse = '';
        const keysToTry = settingsKeys.length > 0 ? settingsKeys : [keyManager.getNextKey()?.key || ''];
        let lastError: Error | null = null;

        for (const apiKey of keysToTry) {
          if (!apiKey) continue;
          try {
            rawResponse = await this.callGeminiAudioApi(audioBuffer, apiKey, 'gemini-3.6-flash', signal);
            lastError = null;
            break;
          } catch (apiErr: any) {
            lastError = apiErr;
            logger.warn('transcription', `Gemini key failed, checking next key: ${apiErr.message}`);
          }
        }

        if (lastError || !rawResponse) {
          throw lastError || new Error('Transcription failed on all configured Gemini keys.');
        }

        // 3. Stage: Validating Cues
        generationEventBus.emit('transcript:progress', {
          projectId,
          percent: 85,
          stage: 'Validating transcript segments and timestamps...',
        });

        const validated = this.validateTranscriptCues(rawResponse);
        fullText = validated.fullText;
        cues = validated.cues;
      }

      // 4. Stage: Persisting Transcript
      const transcriptEntity: TranscriptEntity = {
        version: 1,
        projectId,
        sourceMediaPath: project.sourceMedia.mediaPath,
        fullText,
        cues,
        createdAt: new Date().toISOString(),
        provider: providerName,
      };

      const transcriptPath = path.join(projectDir, 'metadata', 'transcript.json');
      const tmpPath = `${transcriptPath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(transcriptEntity, null, 2), 'utf-8');
      fs.renameSync(tmpPath, transcriptPath);

      // Attach transcript to project entity
      await ProjectRepository.update(projectId, {
        transcript: transcriptEntity,
      } as any);

      generationEventBus.emit('transcript:progress', {
        projectId,
        percent: 100,
        stage: 'Transcription complete.',
      });

      logger.info('transcription', `Transcription successfully completed for project ${projectId}`, {
        cueCount: cues.length,
        totalChars: fullText.length,
        provider: providerName,
      });

      return transcriptEntity;
    } finally {
      this.activeJobs.delete(projectId);
      if (fs.existsSync(tempAudioPath)) {
        try { fs.unlinkSync(tempAudioPath); } catch {}
      }
    }
  }

  /**
   * Retrieves the persisted transcript entity for a project if it exists.
   */
  static async getTranscript(projectId: string): Promise<TranscriptEntity | null> {
    const transcriptPath = path.join(AssetManager.getProjectDir(projectId), 'metadata', 'transcript.json');
    if (!fs.existsSync(transcriptPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      return JSON.parse(content) as TranscriptEntity;
    } catch {
      return null;
    }
  }
}
