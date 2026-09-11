/**
 * Ai33TtsProvider – Multi-Source Cloud Voice Provider for Infinity Flow.
 *
 * Implements ZBot §7 specification for ai33.pro:
 *  - Async multipart task submission: POST /v1/task
 *  - Polling task status: GET /v1/task/:id
 *  - Audio download: metadata.audio_url
 *  - SRT transcript parsing to extract word timings for subtitle alignment
 *  - Upstream voice categories: elevenlabs, minimax, fishaudio, edge, vbee, clone
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ITtsProvider,
  TtsProviderId,
  TtsEngineBadge,
  VoiceInfo,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  WordTiming,
} from './TtsTypes';
import { SettingsManager } from '../storage/SettingsManager';
import { AudioDurationMeasurer } from './AudioDurationMeasurer';
import { classifyTtsError, TtsError } from './TtsErrorClassifier';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class Ai33TtsProvider implements ITtsProvider {
  readonly id: TtsProviderId = 'ai33';
  readonly name = 'ai33.pro (Multi-Source Library)';
  readonly badge: TtsEngineBadge = 'API KEY';
  readonly audioExtension = 'mp3' as const;
  readonly defaultVoiceId = 'elevenlabs:rachel';
  readonly supportsWordTimings = true;

  private static testKey: string | null = null;
  private static testBaseUrl: string | null = null;
  private static testHandler: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  private static testPollIntervalMs: number | null = null;

  // Voice library categorized by upstream provider
  private static readonly VOICES: VoiceInfo[] = [
    // ElevenLabs upstream
    {
      id: 'elevenlabs:rachel',
      name: 'Rachel (ElevenLabs - Default)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'female',
      description: 'Warm, engaging, natural narrative voice',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'elevenlabs:adam',
      name: 'Adam (ElevenLabs)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'male',
      description: 'Deep, authoritative American narrator',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'elevenlabs:antoni',
      name: 'Antoni (ElevenLabs)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'male',
      description: 'Energetic, expressive storyteller',
      tier: 'premium',
      isAvailable: false,
    },
    // MiniMax upstream
    {
      id: 'minimax:moss',
      name: 'Moss (MiniMax)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'male',
      description: 'Smooth, cinematic deep tone',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'minimax:catherine',
      name: 'Catherine (MiniMax)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'female',
      description: 'Crisp, articulate documentary speaker',
      tier: 'premium',
      isAvailable: false,
    },
    // Fish Audio upstream
    {
      id: 'fishaudio:narrator_01',
      name: 'Echo (Fish Audio)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'female',
      description: 'Expressive anime/gaming persona',
      tier: 'premium',
      isAvailable: false,
    },
    // Edge upstream
    {
      id: 'edge:en-US-ChristopherNeural',
      name: 'Christopher (Edge Proxy)',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'male',
      description: 'Reliable news and documentary style',
      tier: 'free',
      isAvailable: false,
    },
    // Vbee & Clone
    {
      id: 'vbee:vietnamese_male',
      name: 'Nam (Vbee)',
      provider: 'ai33',
      locale: 'vi-VN',
      gender: 'male',
      description: 'Natural Vietnamese speaker',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'clone:custom_voice_01',
      name: 'Custom Clone 1',
      provider: 'ai33',
      locale: 'en-US',
      gender: 'neutral',
      description: 'Custom uploaded voice clone slot',
      tier: 'premium',
      isAvailable: false,
    },
  ];

  static setTestCredentials(key: string | null, baseUrl?: string): void {
    this.testKey = key;
    if (baseUrl) this.testBaseUrl = baseUrl;
  }

  static setTestHandler(handler: ((url: string, init?: RequestInit) => Promise<Response>) | null): void {
    this.testHandler = handler;
  }

  static setTestPollIntervalMs(ms: number | null): void {
    this.testPollIntervalMs = ms;
  }

  static resetTestCredentials(): void {
    this.testKey = null;
    this.testBaseUrl = null;
    this.testHandler = null;
    this.testPollIntervalMs = null;
  }

  private getKey(): string | null {
    if (Ai33TtsProvider.testKey !== null) {
      return Ai33TtsProvider.testKey;
    }
    const fromSettings = SettingsManager.getSecret('ai33Key');
    if (fromSettings && fromSettings.trim()) {
      return fromSettings.trim();
    }
    const fromEnv = process.env.AI33_API_KEY;
    if (fromEnv && fromEnv.trim()) {
      return fromEnv.trim();
    }
    return null;
  }

  private getBaseUrl(): string {
    if (Ai33TtsProvider.testBaseUrl) {
      return Ai33TtsProvider.testBaseUrl;
    }
    return process.env.AI33_BASE_URL || 'https://api.ai33.pro';
  }

  private async executeFetch(url: string, init?: RequestInit): Promise<Response> {
    if (Ai33TtsProvider.testHandler) {
      return await Ai33TtsProvider.testHandler(url, init);
    }
    return await fetch(url, init);
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getKey();
    return Boolean(key && key.trim().length > 0);
  }

  getUnavailableReason(): string | null {
    const key = this.getKey();
    if (!key) {
      return 'ai33.pro API Key is not configured. Add your API key in Settings -> Voice Engines.';
    }
    return null;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const available = await this.isAvailable();
    const reason = this.getUnavailableReason() || undefined;

    return Ai33TtsProvider.VOICES.map((v) => ({
      ...v,
      isAvailable: available,
      unavailableReason: available ? undefined : reason,
    }));
  }

  /**
   * Parses SRT timestamp string (e.g. "00:00:01,234") into milliseconds.
   */
  static parseSrtTimestamp(ts: string): number {
    const match = ts.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const ms = parseInt(match[4], 10);
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
  }

  /**
   * Parses SRT transcript into WordTiming cues.
   */
  static parseSrtToWordTimings(srtContent: string): WordTiming[] {
    if (!srtContent || !srtContent.trim()) return [];

    const blocks = srtContent.trim().split(/\r?\n\r?\n/);
    const wordTimings: WordTiming[] = [];

    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      // Line with timestamp: "00:00:00,100 --> 00:00:02,400"
      const timeLine = lines.find((l) => l.includes('-->'));
      if (!timeLine) continue;

      const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
      const startMs = Ai33TtsProvider.parseSrtTimestamp(startStr);
      const endMs = Ai33TtsProvider.parseSrtTimestamp(endStr);
      const cueDuration = Math.max(100, endMs - startMs);

      // Remaining lines are text
      const textLines = lines.filter((l) => l !== timeLine && !/^\d+$/.test(l));
      const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();
      const words = text.split(/\s+/).filter(Boolean);

      if (words.length === 0) continue;

      const msPerWord = Math.floor(cueDuration / words.length);
      for (let i = 0; i < words.length; i++) {
        wordTimings.push({
          word: words[i],
          startMs: startMs + i * msPerWord,
          durationMs: msPerWord,
        });
      }
    }

    return wordTimings;
  }

  /**
   * Synthesizes text using ai33.pro multipart task submission and polling.
   */
  async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    if (options.signal?.aborted) {
      throw new TtsError('ai33 synthesis was aborted before start.', 'cancelled', 'ai33');
    }

    const trimmedText = (options.text || '').trim();
    if (!trimmedText) {
      throw new TtsError('Narration text is empty.', 'invalid_voice', 'ai33');
    }

    const key = this.getKey();
    if (!key) {
      throw new TtsError(
        'ai33.pro API Key is not configured. Add your API key in Settings -> Voice Engines.',
        'missing_key',
        'ai33'
      );
    }

    const voiceId = options.voiceId || this.defaultVoiceId;
    const knownVoice = Ai33TtsProvider.VOICES.find((v) => v.id === voiceId);
    if (!knownVoice) {
      throw new TtsError(`Invalid or unsupported ai33 voice ID: '${voiceId}'.`, 'invalid_voice', 'ai33');
    }

    const baseUrl = this.getBaseUrl();

    // 1. Submit multipart task
    const formData = new FormData();
    formData.append('text', trimmedText);
    formData.append('voice', voiceId);
    if (options.speed && options.speed >= 0.5 && options.speed <= 1.5) {
      formData.append('speed', String(options.speed));
    }

    let taskId: string;
    try {
      const taskRes = await this.executeFetch(`${baseUrl}/v1/task`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: formData,
        signal: options.signal,
      });

      if (!taskRes.ok) {
        const errorText = await taskRes.text().catch(() => '');
        const msg = `ai33 task creation failed HTTP ${taskRes.status} (${taskRes.statusText}): ${errorText}`;
        if (taskRes.status === 401) throw new TtsError(msg, 'invalid_key', 'ai33', null, 401);
        if (taskRes.status === 402 || taskRes.status === 403) throw new TtsError(msg, 'quota', 'ai33', null, taskRes.status);
        if (taskRes.status === 429) throw new TtsError(msg, 'rate_limit', 'ai33', null, 429);
        throw new TtsError(msg, 'network', 'ai33', null, taskRes.status);
      }

      const taskJson: any = await taskRes.json();
      taskId = taskJson?.data?.task_id || taskJson?.task_id || taskJson?.id;
      if (!taskId) {
        throw new TtsError(`ai33 API did not return a task_id: ${JSON.stringify(taskJson)}`, 'malformed_response', 'ai33');
      }
      logger.info('ai33_tts', `Created ai33 task ${taskId} for voice ${voiceId}`);
    } catch (err: any) {
      throw classifyTtsError(err, 'ai33');
    }

    // 2. Poll for completion (up to 60 seconds)
    const maxPollAttempts = 60;
    let pollAttempt = 0;
    let audioUrl: string | null = null;
    let srtContent: string | null = null;

    while (pollAttempt < maxPollAttempts) {
      if (options.signal?.aborted) {
        throw new TtsError('ai33 task polling was aborted.', 'cancelled', 'ai33');
      }

      pollAttempt++;
      // Wait between polls (configurable for tests)
      await new Promise((r) => setTimeout(r, Ai33TtsProvider.testPollIntervalMs ?? 1000));

      try {
        const pollRes = await this.executeFetch(`${baseUrl}/v1/task/${taskId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: options.signal,
        });

        if (!pollRes.ok) {
          if (pollRes.status === 401) throw new TtsError('ai33 polling 401 Unauthorized', 'invalid_key', 'ai33', null, 401);
          if (pollRes.status === 429) continue; // retry on rate limit during poll
          throw new TtsError(`ai33 polling HTTP ${pollRes.status}`, 'network', 'ai33', null, pollRes.status);
        }

        const pollJson: any = await pollRes.json();
        const status = pollJson?.status || pollJson?.data?.status;

        if (status === 'completed' || status === 'success') {
          audioUrl = pollJson?.metadata?.audio_url || pollJson?.data?.audio_url || pollJson?.audio_url;
          srtContent = pollJson?.metadata?.srt || pollJson?.metadata?.subtitles || pollJson?.data?.srt || null;
          break;
        } else if (status === 'failed') {
          const failMsg = pollJson?.error || pollJson?.data?.error || 'ai33 task execution failed';
          throw new TtsError(failMsg, 'quota', 'ai33');
        }
      } catch (err: any) {
        const classified = classifyTtsError(err, 'ai33');
        if (classified.classification === 'cancelled' || classified.classification === 'invalid_key') {
          throw classified;
        }
        // Transient network error on polling: continue up to limit
        if (pollAttempt >= maxPollAttempts) throw classified;
      }
    }

    if (!audioUrl) {
      throw new TtsError(`ai33 task ${taskId} timed out before audio completed.`, 'network', 'ai33');
    }

    // 3. Download audio file
    let audioBuffer: Buffer;
    try {
      const audioRes = await this.executeFetch(audioUrl, { signal: options.signal });
      if (!audioRes.ok) {
        throw new TtsError(`Failed to download ai33 audio from ${audioUrl} HTTP ${audioRes.status}`, 'network', 'ai33');
      }
      const arrayBuf = await audioRes.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);

      if (audioBuffer.length === 0) {
        throw new TtsError('ai33 returned empty (0 bytes) audio file.', 'invalid_audio', 'ai33');
      }
    } catch (err: any) {
      throw classifyTtsError(err, 'ai33');
    }

    // 4. Parse SRT if provided
    let wordTimings: WordTiming[] | undefined = undefined;
    if (srtContent) {
      wordTimings = Ai33TtsProvider.parseSrtToWordTimings(srtContent);
    }

    // 5. Persist output if requested
    if (options.outputPath) {
      const dir = path.dirname(options.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(options.outputPath, audioBuffer);
    }

    // 6. Measure exact duration
    let durationSeconds: number;
    if (options.outputPath && fs.existsSync(options.outputPath)) {
      durationSeconds = await AudioDurationMeasurer.measureDurationSeconds(options.outputPath, { wordTimings });
    } else {
      // Bitrate estimate: 48kbps = 6,000 bytes/sec
      durationSeconds = Math.max(0.5, Math.round((audioBuffer.length / 6000) * 100) / 100);
    }

    return {
      audioBuffer,
      outputPath: options.outputPath,
      sizeBytes: audioBuffer.length,
      durationSeconds,
      format: 'mp3',
      wordTimings,
      providerUsed: 'ai33',
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const key = this.getKey();
    if (!key) {
      return { success: false, message: 'ai33.pro API Key is not configured.' };
    }
    const baseUrl = this.getBaseUrl();
    try {
      const res = await this.executeFetch(`${baseUrl}/v1/voices`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        return { success: true, message: 'Connected to ai33.pro successfully.' };
      }
      if (res.status === 401) {
        return { success: false, message: 'Authentication failed (401): Invalid ai33.pro API key.' };
      }
      return { success: false, message: `ai33.pro responded HTTP ${res.status}: ${res.statusText}` };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }
}
