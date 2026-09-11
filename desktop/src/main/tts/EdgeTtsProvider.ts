/**
 * EdgeTtsProvider – High-performance Microsoft Edge Text-to-Speech client.
 *
 * Connects directly via WebSocket to speech.platform.bing.com using the
 * Microsoft Read-Aloud protocol:
 *  - Generates dynamic time-windowed Sec-MS-GEC DRM tokens (SHA-256).
 *  - Handles binary framing and streaming audio chunks.
 *  - Extracts word-boundary timing metadata for exact subtitle synchronization.
 *  - Measures audio duration via ffprobe and fallbacks.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import WebSocket from 'ws';
import type {
  ITtsProvider,
  TtsProviderId,
  VoiceInfo,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  WordTiming,
  TtsEngineBadge,
} from './TtsTypes';
import { AudioDurationMeasurer } from './AudioDurationMeasurer';

export class EdgeTtsProvider implements ITtsProvider {
  readonly id: TtsProviderId = 'edge-tts';
  readonly name = 'Edge TTS (Free Neural Voices)';
  readonly badge: TtsEngineBadge = 'FREE';
  readonly audioExtension = 'mp3' as const;
  readonly defaultVoiceId = 'en-US-ChristopherNeural';
  readonly supportsWordTimings = true;

  private static readonly TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  private static readonly WIN_EPOCH = 11644473600;
  private static readonly CHROMIUM_FULL_VERSION = '143.0.3650.75';
  private static readonly CHROMIUM_MAJOR_VERSION = '143';
  private static readonly SEC_MS_GEC_VERSION = `1-${EdgeTtsProvider.CHROMIUM_FULL_VERSION}`;

  /**
   * Catalog of curated high-quality voices.
   */
  private static readonly VOICES: VoiceInfo[] = [
    {
      id: 'en-US-ChristopherNeural',
      name: 'Christopher Neural (Default)',
      provider: 'edge-tts',
      locale: 'en-US',
      gender: 'male',
      description: 'Engaging, balanced documentary narrator voice',
      isAvailable: true,
    },
    {
      id: 'en-US-JennyNeural',
      name: 'Jenny Neural',
      provider: 'edge-tts',
      locale: 'en-US',
      gender: 'female',
      description: 'Warm, natural, clear storytelling voice',
      isAvailable: true,
    },
    {
      id: 'en-US-GuyNeural',
      name: 'Guy Neural',
      provider: 'edge-tts',
      locale: 'en-US',
      gender: 'male',
      description: 'Authoritative, deep broadcaster style',
      isAvailable: true,
    },
    {
      id: 'en-US-AriaNeural',
      name: 'Aria Neural',
      provider: 'edge-tts',
      locale: 'en-US',
      gender: 'female',
      description: 'Expressive, professional female narration',
      isAvailable: true,
    },
    {
      id: 'en-GB-RyanNeural',
      name: 'Ryan Neural (British)',
      provider: 'edge-tts',
      locale: 'en-GB',
      gender: 'male',
      description: 'Sophisticated British English male voice',
      isAvailable: true,
    },
    {
      id: 'en-GB-SoniaNeural',
      name: 'Sonia Neural (British)',
      provider: 'edge-tts',
      locale: 'en-GB',
      gender: 'female',
      description: 'Refined British English female narrator',
      isAvailable: true,
    },
  ];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getUnavailableReason(): string | null {
    return null;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [...EdgeTtsProvider.VOICES];
  }

  /**
   * Generates dynamic Sec-MS-GEC DRM validation token.
   */
  public static generateSecMsGec(): string {
    let ticks = Math.floor(Date.now() / 1000) + EdgeTtsProvider.WIN_EPOCH;
    ticks -= (ticks % 300); // 5-minute time windowing
    const fileTime = BigInt(ticks) * 10000000n; // 100-nanosecond intervals
    const strToHash = `${fileTime.toString()}${EdgeTtsProvider.TRUSTED_CLIENT_TOKEN}`;
    return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
  }

  /**
   * Generates a random 16-byte MUID cookie.
   */
  public static generateMuid(): string {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
  }

  /**
   * Synthesizes text into audio.
   */
  async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    const text = (options.text || '').trim();
    if (!text) {
      throw new Error('TTS synthesis failed: text is empty.');
    }

    if (options.signal?.aborted) {
      throw new Error('TTS synthesis aborted by user.');
    }

    const voice = options.voiceId || this.defaultVoiceId;
    const pitch = options.pitch || '+0Hz';
    const rate = options.rate || '+0%';
    const volume = options.volume || '+0%';

    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const secMsGec = EdgeTtsProvider.generateSecMsGec();
    const muid = EdgeTtsProvider.generateMuid();

    const wssUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EdgeTtsProvider.TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${EdgeTtsProvider.SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;

    const headers = {
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EdgeTtsProvider.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EdgeTtsProvider.CHROMIUM_MAJOR_VERSION}.0.0.0`,
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Cookie': `muid=${muid};`,
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const audioChunks: Buffer[] = [];
    const wordTimings: WordTiming[] = [];

    const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
      let isSettled = false;
      const ws = new WebSocket(wssUrl, { headers });

      const cleanup = () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Edge TTS request timed out after 15 seconds.'));
      }, 15000);

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          cleanup();
          reject(new Error('TTS synthesis cancelled by caller.'));
        });
      }

      ws.on('open', () => {
        try {
          // 1. Send speech.config
          const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
          ws.send(configMsg);

          // 2. Format SSML
          const reqId = crypto.randomUUID().replace(/-/g, '');
          const timestamp = new Date().toISOString();
          const escapedText = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

          const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapedText}</prosody></voice></speak>`;
          const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`;
          ws.send(ssmlMsg);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          const textMsg = data.toString('utf-8');
          if (textMsg.includes('Path:turn.end')) {
            cleanup();
            if (audioChunks.length === 0) {
              reject(new Error('Edge TTS completed without delivering any audio chunks.'));
            } else {
              resolve(Buffer.concat(audioChunks));
            }
          } else if (textMsg.includes('Path:audio.metadata')) {
            try {
              const bodyIdx = textMsg.indexOf('\r\n\r\n');
              if (bodyIdx !== -1) {
                const jsonStr = textMsg.slice(bodyIdx + 4);
                const meta = JSON.parse(jsonStr);
                if (Array.isArray(meta.Metadata)) {
                  for (const m of meta.Metadata) {
                    if (m.Data && m.Data.text) {
                      // Offset and Duration are in 100-nanosecond ticks
                      const startMs = Math.round((m.Data.Offset || 0) / 10000);
                      const durationMs = Math.round((m.Data.Duration || 0) / 10000);
                      wordTimings.push({
                        word: String(m.Data.text.Text || ''),
                        startMs,
                        durationMs,
                      });
                    }
                  }
                }
              }
            } catch {}
          }
        } else {
          // Binary audio frame
          const buf = Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer);
          if (buf.length >= 2) {
            const headerLen = buf.readUInt16BE(0);
            const header = buf.slice(2, 2 + headerLen).toString('utf-8');
            if (header.includes('Path:audio')) {
              const audioPayload = buf.slice(2 + headerLen);
              if (audioPayload.length > 0) {
                audioChunks.push(audioPayload);
              }
            }
          }
        }
      });

      ws.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });

    // Save to disk if outputPath provided
    if (options.outputPath) {
      const dir = path.dirname(options.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(options.outputPath, audioBuffer);
    }

    // Measure duration
    let durationSeconds = 3.0;
    if (options.outputPath) {
      durationSeconds = await AudioDurationMeasurer.measureDurationSeconds(options.outputPath, {
        wordTimings,
        fallbackBitrateKbps: 48,
      });
    } else {
      // Direct calculation from word timings or buffer size
      if (wordTimings.length > 0) {
        const last = wordTimings[wordTimings.length - 1];
        if (last) {
          durationSeconds = Math.round(((last.startMs + last.durationMs) / 1000) * 100) / 100;
        }
      } else {
        durationSeconds = Math.max(1, Math.round((audioBuffer.length / 6000) * 100) / 100);
      }
    }

    return {
      audioBuffer,
      outputPath: options.outputPath,
      sizeBytes: audioBuffer.length,
      durationSeconds,
      format: 'mp3',
      wordTimings,
    };
  }
}
