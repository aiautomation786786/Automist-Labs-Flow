/**
 * FameSpeakTtsProvider – FameSpeak Async Text-to-Speech Engine.
 *
 * Implements ZBot §7 specification for FameSpeak:
 *  - Async generation: POST /api/v1/tts/generations { text, voice } + Idempotency-Key
 *  - Async 202 status: poll GET /api/v1/tts/generations/:id
 *  - Binary audio download: GET /api/v1/tts/generations/:id/audio (MP3)
 *  - Mandatory voice library caching:
 *     - Paginated walk: GET /api/v1/voices?page=N&limit=200
 *     - ~700ms pacing between page requests
 *     - 429 backoff retry
 *     - 7-day TTL disk cache (%LOCALAPPDATA%\GoogleFlowApp\config\famespeak-voices.json)
 *     - Keyed by API-key tail
 *     - Awaited atomic cache writes (no fire-and-forget)
 *     - Serves stale disk cache when refresh walk fails
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  ITtsProvider,
  TtsProviderId,
  TtsEngineBadge,
  VoiceInfo,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
} from './TtsTypes';
import { SettingsManager } from '../storage/SettingsManager';
import { getAppDataDir, AppLogger } from '../utils/AppLogger';
import { AudioDurationMeasurer } from './AudioDurationMeasurer';
import { classifyTtsError, TtsError } from './TtsErrorClassifier';

const logger = new AppLogger({ mirrorToStderr: false });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface FameSpeakDiskCache {
  keyTail: string;
  timestamp: number;
  voices: VoiceInfo[];
}

export class FameSpeakTtsProvider implements ITtsProvider {
  readonly id: TtsProviderId = 'famespeak';
  readonly name = 'FameSpeak (Celebrity & Character Voices)';
  readonly badge: TtsEngineBadge = 'API KEY';
  readonly audioExtension = 'mp3' as const;
  readonly defaultVoiceId = 'fs_morgan_freeman';
  readonly supportsWordTimings = false;

  private static testKey: string | null = null;
  private static testBaseUrl: string | null = null;
  private static testHandler: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  private static testCacheFilePath: string | null = null;
  private static testPacingMs: number | null = null;
  private static testPollIntervalMs: number | null = null;

  // In-memory voice cache
  private static inMemoryCache: FameSpeakDiskCache | null = null;

  // Curated baseline voices if no network and no cache
  private static readonly FALLBACK_VOICES: VoiceInfo[] = [
    {
      id: 'fs_morgan_freeman',
      name: 'Narrator (Wisdom / Cinema - Default)',
      provider: 'famespeak',
      locale: 'en-US',
      gender: 'male',
      description: 'Deep, cinematic, legendary narrator persona',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'fs_david_attenborough',
      name: 'Documentary Guide (Nature)',
      provider: 'famespeak',
      locale: 'en-GB',
      gender: 'male',
      description: 'Prestigious British wildlife documentary tone',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'fs_optimus',
      name: 'Heroic Commander',
      provider: 'famespeak',
      locale: 'en-US',
      gender: 'male',
      description: 'Resonant, powerful sci-fi leader style',
      tier: 'premium',
      isAvailable: false,
    },
    {
      id: 'fs_glados',
      name: 'Synthetic AI Persona',
      provider: 'famespeak',
      locale: 'en-US',
      gender: 'female',
      description: 'Robotic, calm sarcastic AI personality',
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

  static setTestCachePath(customPath: string | null): void {
    this.testCacheFilePath = customPath;
    this.inMemoryCache = null;
  }

  static setTestPacingMs(ms: number | null): void {
    this.testPacingMs = ms;
  }

  static setTestPollIntervalMs(ms: number | null): void {
    this.testPollIntervalMs = ms;
  }

  static resetTestCredentials(): void {
    this.testKey = null;
    this.testBaseUrl = null;
    this.testHandler = null;
    this.testCacheFilePath = null;
    this.testPacingMs = null;
    this.testPollIntervalMs = null;
    this.inMemoryCache = null;
  }

  private getKey(): string | null {
    if (FameSpeakTtsProvider.testKey !== null) {
      return FameSpeakTtsProvider.testKey;
    }
    const fromSettings = SettingsManager.getSecret('famespeakKey');
    if (fromSettings && fromSettings.trim()) {
      return fromSettings.trim();
    }
    const fromEnv = process.env.FAMESPEAK_API_KEY;
    if (fromEnv && fromEnv.trim()) {
      return fromEnv.trim();
    }
    return null;
  }

  private getBaseUrl(): string {
    if (FameSpeakTtsProvider.testBaseUrl) {
      return FameSpeakTtsProvider.testBaseUrl;
    }
    return process.env.FAMESPEAK_BASE_URL || 'https://api.famespeak.com';
  }

  static getCacheFilePath(): string {
    if (this.testCacheFilePath) {
      return this.testCacheFilePath;
    }
    const configDir = path.join(getAppDataDir(), 'config');
    return path.join(configDir, 'famespeak-voices.json');
  }

  private async executeFetch(url: string, init?: RequestInit): Promise<Response> {
    if (FameSpeakTtsProvider.testHandler) {
      return await FameSpeakTtsProvider.testHandler(url, init);
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
      return 'FameSpeak Bearer API Key is not configured. Add your key in Settings -> Voice Engines.';
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Voice Cache & Paced Voice Walk
  // ---------------------------------------------------------------------------

  /**
   * Reads the persisted disk cache if available.
   */
  static readDiskCache(): FameSpeakDiskCache | null {
    const filePath = this.getCacheFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as FameSpeakDiskCache;
      if (data && Array.isArray(data.voices) && typeof data.timestamp === 'number') {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Atomically writes voice list to disk and strictly awaits completion.
   */
  static async writeDiskCache(cacheData: FameSpeakDiskCache): Promise<void> {
    const filePath = this.getCacheFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cacheData, null, 2), 'utf-8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.copyFileSync(tmpPath, filePath);
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  /**
   * Performs the mandatory paced (~700ms) paginated voice walk with backoff.
   */
  private async walkVoices(key: string): Promise<VoiceInfo[]> {
    const baseUrl = this.getBaseUrl();
    const collectedVoices: VoiceInfo[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      if (page > 1) {
        // Enforce ~700ms pacing between requests (configurable for tests)
        await new Promise((r) => setTimeout(r, FameSpeakTtsProvider.testPacingMs ?? 700));
      }

      let attempt = 0;
      let success = false;
      let pageData: any = null;

      while (attempt < 3 && !success) {
        attempt++;
        try {
          const res = await this.executeFetch(`${baseUrl}/api/v1/voices?page=${page}&limit=200`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${key}`,
            },
            signal: AbortSignal.timeout(10000),
          });

          if (res.status === 429) {
            // Rate-limited: back off exponentially and retry
            logger.warn('famespeak_tts', `Rate limit 429 on page ${page}, backoff retry ${attempt}`);
            await new Promise((r) => setTimeout(r, attempt * 1500));
            continue;
          }

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }

          pageData = await res.json();
          success = true;
        } catch (err: any) {
          if (attempt >= 3) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!pageData) {
        break;
      }

      const items = pageData.items || pageData.voices || (Array.isArray(pageData) ? pageData : []);
      totalPages = Number(pageData.totalPages) || 1;

      for (const item of items) {
        if (item && item.id) {
          collectedVoices.push({
            id: String(item.id),
            name: String(item.displayName || item.name || item.id),
            provider: 'famespeak',
            locale: String(item.locale || 'en-US'),
            gender: (String(item.gender || '').toLowerCase() === 'female' ? 'female' : 'male') as 'male' | 'female',
            description: item.description || `FameSpeak ${item.tier || 'Voice'} Model`,
            tier: item.tier === 'free' ? 'free' : 'premium',
            audioUrl: item.audioUrl,
            isAvailable: true,
          });
        }
      }

      page++;
    }

    return collectedVoices;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const key = this.getKey();
    const isAvail = Boolean(key);
    const reason = this.getUnavailableReason() || undefined;

    if (!key) {
      return FameSpeakTtsProvider.FALLBACK_VOICES.map((v) => ({
        ...v,
        isAvailable: false,
        unavailableReason: reason,
      }));
    }

    const keyTail = key.slice(-8);
    const now = Date.now();

    // 1. Check in-memory cache
    if (
      FameSpeakTtsProvider.inMemoryCache &&
      FameSpeakTtsProvider.inMemoryCache.keyTail === keyTail &&
      now - FameSpeakTtsProvider.inMemoryCache.timestamp < SEVEN_DAYS_MS
    ) {
      return FameSpeakTtsProvider.inMemoryCache.voices;
    }

    // 2. Check disk cache
    const diskCache = FameSpeakTtsProvider.readDiskCache();
    if (diskCache && diskCache.keyTail === keyTail && now - diskCache.timestamp < SEVEN_DAYS_MS) {
      FameSpeakTtsProvider.inMemoryCache = diskCache;
      return diskCache.voices;
    }

    // 3. Attempt live paced voice walk
    try {
      const freshVoices = await this.walkVoices(key);
      if (freshVoices.length > 0) {
        const cacheEntry: FameSpeakDiskCache = {
          keyTail,
          timestamp: now,
          voices: freshVoices,
        };

        // Strictly await the atomic disk cache write!
        await FameSpeakTtsProvider.writeDiskCache(cacheEntry);
        FameSpeakTtsProvider.inMemoryCache = cacheEntry;

        return freshVoices;
      }
    } catch (err: any) {
      logger.warn('famespeak_tts', `Live voice walk failed: ${err.message}. Checking stale disk cache.`);
    }

    // 4. Stale cache fallback (serve stale disk cache if walk failed)
    if (diskCache && diskCache.voices.length > 0) {
      logger.info('famespeak_tts', `Serving stale FameSpeak voice cache from disk (${diskCache.voices.length} voices)`);
      FameSpeakTtsProvider.inMemoryCache = diskCache;
      return diskCache.voices;
    }

    // 5. Hard fallback to curated voices
    return FameSpeakTtsProvider.FALLBACK_VOICES.map((v) => ({
      ...v,
      isAvailable: isAvail,
      unavailableReason: isAvail ? undefined : reason,
    }));
  }

  // ---------------------------------------------------------------------------
  // Synthesis Execution
  // ---------------------------------------------------------------------------

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    if (options.signal?.aborted) {
      throw new TtsError('FameSpeak synthesis was aborted before start.', 'cancelled', 'famespeak');
    }

    const trimmedText = (options.text || '').trim();
    if (!trimmedText) {
      throw new TtsError('Narration text is empty.', 'invalid_voice', 'famespeak');
    }

    const key = this.getKey();
    if (!key) {
      throw new TtsError(
        'FameSpeak Bearer API Key is not configured. Add your key in Settings -> Voice Engines.',
        'missing_key',
        'famespeak'
      );
    }

    const voiceId = options.voiceId || this.defaultVoiceId;
    const baseUrl = this.getBaseUrl();
    const idempotencyKey = crypto.randomUUID();

    // 1. Submit generation request with EXACT documented fields only!
    let generationId: string;
    try {
      const genRes = await this.executeFetch(`${baseUrl}/api/v1/tts/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          text: trimmedText,
          voice: voiceId,
        }),
        signal: options.signal,
      });

      if (!genRes.ok) {
        const errText = await genRes.text().catch(() => '');
        const msg = `FameSpeak generation failed HTTP ${genRes.status} (${genRes.statusText}): ${errText}`;
        if (genRes.status === 401) throw new TtsError(msg, 'invalid_key', 'famespeak', null, 401);
        if (genRes.status === 402 || genRes.status === 403) throw new TtsError(msg, 'quota', 'famespeak', null, genRes.status);
        if (genRes.status === 429) throw new TtsError(msg, 'rate_limit', 'famespeak', null, 429);
        throw new TtsError(msg, 'network', 'famespeak', null, genRes.status);
      }

      const genJson: any = await genRes.json();
      generationId = genJson?.id || genJson?.generation_id || genJson?.data?.id;
      if (!generationId) {
        throw new TtsError(`FameSpeak did not return a generation ID: ${JSON.stringify(genJson)}`, 'malformed_response', 'famespeak');
      }
    } catch (err: any) {
      throw classifyTtsError(err, 'famespeak');
    }

    // 2. Poll generation status
    const maxPollAttempts = 60;
    let pollAttempt = 0;
    let isCompleted = false;

    while (pollAttempt < maxPollAttempts) {
      if (options.signal?.aborted) {
        throw new TtsError('FameSpeak polling was aborted.', 'cancelled', 'famespeak');
      }

      pollAttempt++;
      // Wait between polls (configurable for tests)
      await new Promise((r) => setTimeout(r, FameSpeakTtsProvider.testPollIntervalMs ?? 1000));

      try {
        const statusRes = await this.executeFetch(`${baseUrl}/api/v1/tts/generations/${generationId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: options.signal,
        });

        if (!statusRes.ok) {
          if (statusRes.status === 401) throw new TtsError('FameSpeak 401 Unauthorized', 'invalid_key', 'famespeak', null, 401);
          if (statusRes.status === 429) continue;
          throw new TtsError(`FameSpeak status poll HTTP ${statusRes.status}`, 'network', 'famespeak', null, statusRes.status);
        }

        const statusJson: any = await statusRes.json();
        const status = statusJson?.status || statusJson?.data?.status;

        if (status === 'completed') {
          isCompleted = true;
          break;
        } else if (status === 'failed') {
          const failMsg = statusJson?.failureMessage || statusJson?.error || 'FameSpeak generation failed.';
          throw new TtsError(failMsg, 'quota', 'famespeak');
        }
      } catch (err: any) {
        const classified = classifyTtsError(err, 'famespeak');
        if (classified.classification === 'cancelled' || classified.classification === 'invalid_key') {
          throw classified;
        }
        if (pollAttempt >= maxPollAttempts) throw classified;
      }
    }

    if (!isCompleted) {
      throw new TtsError(`FameSpeak generation ${generationId} timed out before completion.`, 'network', 'famespeak');
    }

    // 3. Download audio MP3
    let audioBuffer: Buffer;
    try {
      const audioRes = await this.executeFetch(`${baseUrl}/api/v1/tts/generations/${generationId}/audio`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: options.signal,
      });

      if (!audioRes.ok) {
        throw new TtsError(`Failed to download FameSpeak audio HTTP ${audioRes.status}`, 'network', 'famespeak', null, audioRes.status);
      }

      const arrayBuf = await audioRes.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);

      if (audioBuffer.length === 0) {
        throw new TtsError('FameSpeak returned empty (0 bytes) audio stream.', 'invalid_audio', 'famespeak');
      }
    } catch (err: any) {
      throw classifyTtsError(err, 'famespeak');
    }

    // 4. Save output
    if (options.outputPath) {
      const dir = path.dirname(options.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(options.outputPath, audioBuffer);
    }

    // 5. Measure exact duration
    let durationSeconds: number;
    if (options.outputPath && fs.existsSync(options.outputPath)) {
      durationSeconds = await AudioDurationMeasurer.measureDurationSeconds(options.outputPath);
    } else {
      durationSeconds = Math.max(0.5, Math.round((audioBuffer.length / 6000) * 100) / 100);
    }

    return {
      audioBuffer,
      outputPath: options.outputPath,
      sizeBytes: audioBuffer.length,
      durationSeconds,
      format: 'mp3',
      providerUsed: 'famespeak',
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const key = this.getKey();
    if (!key) {
      return { success: false, message: 'FameSpeak Bearer API Key is not configured.' };
    }
    const baseUrl = this.getBaseUrl();
    try {
      const res = await this.executeFetch(`${baseUrl}/api/v1/voices?page=1&limit=1`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        return { success: true, message: 'Connected to FameSpeak successfully.' };
      }
      if (res.status === 401) {
        return { success: false, message: 'Authentication failed (401): Invalid FameSpeak Bearer API Key.' };
      }
      return { success: false, message: `FameSpeak responded HTTP ${res.status}: ${res.statusText}` };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }
}
