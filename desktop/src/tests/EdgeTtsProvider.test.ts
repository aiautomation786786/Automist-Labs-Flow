import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeTtsProvider } from '../main/tts/EdgeTtsProvider';

describe('EdgeTtsProvider Unit & Token Tests', () => {
  let provider: EdgeTtsProvider;

  beforeEach(() => {
    provider = new EdgeTtsProvider();
  });

  it('1. Provides correct identity and default narrator voice', () => {
    expect(provider.id).toBe('edge-tts');
    expect(provider.name).toContain('Edge TTS');
    expect(provider.defaultVoiceId).toBe('en-US-ChristopherNeural');
  });

  it('2. Produces valid dynamic Sec-MS-GEC DRM token', () => {
    const token = EdgeTtsProvider.generateSecMsGec();
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    // SHA-256 hex is 64 characters uppercase
    expect(token.length).toBe(64);
    expect(token).toMatch(/^[0-9A-F]{64}$/);
  });

  it('3. Produces valid random MUID cookie token', () => {
    const muid = EdgeTtsProvider.generateMuid();
    expect(muid).toBeDefined();
    expect(typeof muid).toBe('string');
    // 16 bytes = 32 hex chars uppercase
    expect(muid.length).toBe(32);
    expect(muid).toMatch(/^[0-9A-F]{32}$/);
  });

  it('4. Lists available neural voices with metadata', async () => {
    const voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThanOrEqual(4);

    const christopher = voices.find((v) => v.id === 'en-US-ChristopherNeural');
    expect(christopher).toBeDefined();
    expect(christopher?.gender).toBe('male');
    expect(christopher?.isAvailable).toBe(true);

    const jenny = voices.find((v) => v.id === 'en-US-JennyNeural');
    expect(jenny).toBeDefined();
    expect(jenny?.gender).toBe('female');
    expect(jenny?.isAvailable).toBe(true);
  });

  it('5. Rejects empty narration text gracefully', async () => {
    await expect(
      provider.synthesize({
        text: '   ',
        voiceId: 'en-US-ChristopherNeural',
      })
    ).rejects.toThrow(/text is empty/i);
  });

  it('6. Rejects aborted synthesis signals immediately', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.synthesize({
        text: 'Valid text that should not execute.',
        voiceId: 'en-US-ChristopherNeural',
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/i);
  });

  it('7. Synthesizes genuine narration audio when network is connected', async () => {
    try {
      const result = await provider.synthesize({
        text: 'Testing Infinity Flow voice engine.',
        voiceId: 'en-US-ChristopherNeural',
      });

      expect(result).toBeDefined();
      expect(result.audioBuffer).toBeDefined();
      expect(result.audioBuffer.length).toBeGreaterThan(1000);
      expect(result.format).toBe('mp3');
      expect(result.durationSeconds).toBeGreaterThan(0.5);
      expect(result.sizeBytes).toBe(result.audioBuffer.length);
    } catch (err: any) {
      // If CI or offline environment blocks Bing WebSocket connection, verify that it failed with network/timeout error
      expect(err?.message).toMatch(/websocket|timeout|econnrefused|enotfound|connect/i);
    }
  }, 15000);
});
