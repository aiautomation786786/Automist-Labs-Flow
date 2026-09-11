/**
 * AzureTtsProvider – Microsoft Azure Cognitive Services Text-to-Speech Provider.
 *
 * Implements official Azure Speech REST API endpoints:
 *  - Voice discovery: GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list
 *  - Synthesis: POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 *
 * Security:
 *  - Retrieves subscription key via SettingsManager.getSecret('azureSpeechKey') or process.env.
 *  - Region defaults to 'eastus' if not configured in settings.
 *  - Never exposes decrypted key over IPC or to renderer.
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
} from './TtsTypes';
import { SettingsManager } from '../storage/SettingsManager';
import { AudioDurationMeasurer } from './AudioDurationMeasurer';
import { classifyTtsError, TtsError } from './TtsErrorClassifier';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class AzureTtsProvider implements ITtsProvider {
  readonly id: TtsProviderId = 'azure';
  readonly name = 'Azure Speech (HD Neural Voices)';
  readonly badge: TtsEngineBadge = 'API KEY';
  readonly audioExtension = 'mp3' as const;
  readonly defaultVoiceId = 'en-US-JennyNeural';
  readonly supportsWordTimings = false;

  private static testKey: string | null = null;
  private static testRegion: string | null = null;
  private static cachedVoices: VoiceInfo[] | null = null;

  // Curated fallback voices if network is offline or key not yet configured
  private static readonly CURATED_VOICES: VoiceInfo[] = [
    {
      id: 'en-US-JennyNeural',
      name: 'Jenny (US Female Neural - Default)',
      provider: 'azure',
      locale: 'en-US',
      gender: 'female',
      description: 'Warm, natural conversational American female',
      isAvailable: true,
    },
    {
      id: 'en-US-GuyNeural',
      name: 'Guy (US Male Neural)',
      provider: 'azure',
      locale: 'en-US',
      gender: 'male',
      description: 'Professional, articulate American male news style',
      isAvailable: true,
    },
    {
      id: 'en-US-AriaNeural',
      name: 'Aria (US Female Neural)',
      provider: 'azure',
      locale: 'en-US',
      gender: 'female',
      description: 'Expressive and versatile high-definition voice',
      isAvailable: true,
    },
    {
      id: 'en-GB-RyanNeural',
      name: 'Ryan (UK Male Neural)',
      provider: 'azure',
      locale: 'en-GB',
      gender: 'male',
      description: 'Deep, engaging British male narrator',
      isAvailable: true,
    },
    {
      id: 'en-GB-SoniaNeural',
      name: 'Sonia (UK Female Neural)',
      provider: 'azure',
      locale: 'en-GB',
      gender: 'female',
      description: 'Crisp, pleasant British female storyteller',
      isAvailable: true,
    },
  ];

  static setTestCredentials(key: string | null, region: string | null = 'eastus'): void {
    this.testKey = key;
    this.testRegion = region;
    this.cachedVoices = null;
  }

  static resetTestCredentials(): void {
    this.testKey = null;
    this.testRegion = null;
    this.cachedVoices = null;
  }

  /**
   * Retrieves subscription key securely.
   */
  private getKey(): string | null {
    if (AzureTtsProvider.testKey !== null) {
      return AzureTtsProvider.testKey;
    }
    const fromSettings = SettingsManager.getSecret('azureSpeechKey');
    if (fromSettings && fromSettings.trim()) {
      return fromSettings.trim();
    }
    const fromEnv = process.env.AZURE_SPEECH_KEY;
    if (fromEnv && fromEnv.trim()) {
      return fromEnv.trim();
    }
    return null;
  }

  /**
   * Retrieves region safely (defaults to 'eastus').
   */
  private getRegion(): string {
    if (AzureTtsProvider.testRegion) {
      return AzureTtsProvider.testRegion;
    }
    const raw = SettingsManager.readSettings() as Record<string, unknown>;
    if (typeof raw.azureSpeechRegion === 'string' && raw.azureSpeechRegion.trim()) {
      return raw.azureSpeechRegion.trim();
    }
    if (process.env.AZURE_SPEECH_REGION && process.env.AZURE_SPEECH_REGION.trim()) {
      return process.env.AZURE_SPEECH_REGION.trim();
    }
    return 'eastus';
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getKey();
    return Boolean(key && key.trim().length > 0);
  }

  getUnavailableReason(): string | null {
    const key = this.getKey();
    if (!key) {
      return 'Azure Speech Key is not configured. Add your subscription key and region in Settings -> Voice Engines.';
    }
    return null;
  }

  /**
   * Fetches remote voice list from Azure Cognitive Services with caching and fallback.
   */
  async listVoices(): Promise<VoiceInfo[]> {
    if (AzureTtsProvider.cachedVoices) {
      return AzureTtsProvider.cachedVoices;
    }

    const key = this.getKey();
    const region = this.getRegion();
    const isAvail = Boolean(key);
    const reason = this.getUnavailableReason() || undefined;

    if (!key) {
      return AzureTtsProvider.CURATED_VOICES.map((v) => ({
        ...v,
        isAvailable: false,
        unavailableReason: reason,
      }));
    }

    try {
      const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`Azure voice listing failed HTTP ${response.status}: ${response.statusText}`);
      }

      const list = await response.json();
      if (Array.isArray(list)) {
        const voices: VoiceInfo[] = list
          .filter((item: any) => item && item.ShortName && item.Locale?.startsWith('en-'))
          .map((item: any) => ({
            id: item.ShortName,
            name: `${item.LocalName || item.DisplayName || item.ShortName} (${item.Locale})`,
            provider: 'azure' as TtsProviderId,
            locale: item.Locale || 'en-US',
            gender: (item.Gender?.toLowerCase() === 'male' ? 'male' : 'female') as 'male' | 'female',
            description: `Azure Neural ${item.VoiceType || 'HD'} Voice`,
            isAvailable: true,
          }));

        if (voices.length > 0) {
          AzureTtsProvider.cachedVoices = voices;
          return voices;
        }
      }
    } catch (err: any) {
      logger.warn('azure_tts', `Failed to query live Azure voices: ${err.message}. Using curated list.`);
    }

    // Fallback to curated voices marked as available since key exists
    return AzureTtsProvider.CURATED_VOICES.map((v) => ({
      ...v,
      isAvailable: isAvail,
      unavailableReason: isAvail ? undefined : reason,
    }));
  }

  /**
   * Builds standardized W3C SSML for Azure Cognitive Services Speech.
   */
  static buildSsml(text: string, voiceId: string, rate = '+0%', pitch = '+0Hz', volume = '+0%'): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const localeMatch = voiceId.match(/^([a-z]{2}-[A-Z]{2})/);
    const locale = localeMatch ? localeMatch[1] : 'en-US';

    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>
  <voice name='${voiceId}'>
    <prosody rate='${rate}' pitch='${pitch}' volume='${volume}'>${escaped}</prosody>
  </voice>
</speak>`;
  }

  /**
   * Synthesizes speech via official Azure Speech REST endpoint.
   */
  async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    if (options.signal?.aborted) {
      throw new TtsError('Azure synthesis was aborted before start.', 'cancelled', 'azure');
    }

    const trimmedText = (options.text || '').trim();
    if (!trimmedText) {
      throw new TtsError('Narration text is empty.', 'invalid_voice', 'azure');
    }

    const key = this.getKey();
    if (!key) {
      throw new TtsError(
        'Azure Speech Key is not configured. Add your subscription key and region in Settings -> Voice Engines.',
        'missing_key',
        'azure'
      );
    }

    const region = this.getRegion();
    const voiceId = options.voiceId || this.defaultVoiceId;
    const rate = options.rate || '+0%';
    const pitch = options.pitch || '+0Hz';
    const volume = options.volume || '+0%';

    const ssml = AzureTtsProvider.buildSsml(trimmedText, voiceId, rate, pitch, volume);
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'InfinityFlow-Desktop',
        },
        body: ssml,
        signal: options.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const msg = `Azure Speech API error HTTP ${response.status} (${response.statusText}): ${errorBody}`;
        if (response.status === 401) {
          throw new TtsError(msg, 'invalid_key', 'azure', null, 401);
        }
        if (response.status === 403) {
          throw new TtsError(msg, 'quota', 'azure', null, 403);
        }
        if (response.status === 429) {
          throw new TtsError(msg, 'rate_limit', 'azure', null, 429);
        }
        throw new TtsError(msg, 'network', 'azure', null, response.status);
      }

      const arrayBuf = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuf);

      if (audioBuffer.length === 0) {
        throw new TtsError('Azure Speech returned empty (0 bytes) audio stream.', 'invalid_audio', 'azure');
      }

      if (options.outputPath) {
        const dir = path.dirname(options.outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(options.outputPath, audioBuffer);
      }

      let durationSeconds: number;
      if (options.outputPath && fs.existsSync(options.outputPath)) {
        durationSeconds = await AudioDurationMeasurer.measureDurationSeconds(options.outputPath);
      } else {
        // Bitrate estimation: 48kbps = 6,000 bytes/sec
        durationSeconds = Math.max(0.5, Math.round((audioBuffer.length / 6000) * 100) / 100);
      }

      return {
        audioBuffer,
        outputPath: options.outputPath,
        sizeBytes: audioBuffer.length,
        durationSeconds,
        format: 'mp3',
        providerUsed: 'azure',
      };
    } catch (err: any) {
      throw classifyTtsError(err, 'azure');
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const key = this.getKey();
    if (!key) {
      return { success: false, message: 'Azure Speech Key is not configured.' };
    }
    const region = this.getRegion();
    try {
      const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Ocp-Apim-Subscription-Key': key },
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) {
        return { success: true, message: `Connected to Azure Speech (${region}) successfully.` };
      }
      if (response.status === 401) {
        return { success: false, message: 'Authentication failed (401): Invalid Azure Speech Key.' };
      }
      if (response.status === 403) {
        return { success: false, message: `Access denied (403): Verify region '${region}' matches your Azure Speech resource.` };
      }
      return { success: false, message: `Azure responded HTTP ${response.status}: ${response.statusText}` };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }
}
