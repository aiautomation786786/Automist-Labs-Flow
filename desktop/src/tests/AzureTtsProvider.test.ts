import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AzureTtsProvider } from '../main/tts/AzureTtsProvider';
import { TtsError } from '../main/tts/TtsErrorClassifier';

describe('AzureTtsProvider REST Protocol & Error Classification', () => {
  let provider: AzureTtsProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    AzureTtsProvider.resetTestCredentials();
    provider = new AzureTtsProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    AzureTtsProvider.resetTestCredentials();
    vi.restoreAllMocks();
  });

  it('1. Reports accurate identity and configuration requirements', () => {
    expect(provider.id).toBe('azure');
    expect(provider.name).toContain('Azure Speech');
    expect(provider.badge).toBe('API KEY');
    expect(provider.defaultVoiceId).toBe('en-US-JennyNeural');
    expect(provider.supportsWordTimings).toBe(false);
  });

  it('2. Reflects unavailable state and provides guidance when key is missing', async () => {
    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(false);

    const reason = provider.getUnavailableReason();
    expect(reason).toContain('Azure Speech Key is not configured');

    const voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(v.isAvailable).toBe(false);
      expect(v.unavailableReason).toBeDefined();
    }
  });

  it('3. Successfully parses remote voices list when credentials are set', async () => {
    AzureTtsProvider.setTestCredentials('test-azure-key', 'eastus');

    const mockVoicesResponse = [
      {
        ShortName: 'en-US-JennyNeural',
        DisplayName: 'Jenny',
        Locale: 'en-US',
        Gender: 'Female',
        VoiceType: 'Neural',
      },
      {
        ShortName: 'en-US-GuyNeural',
        DisplayName: 'Guy',
        Locale: 'en-US',
        Gender: 'Male',
        VoiceType: 'Neural',
      },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockVoicesResponse,
    } as any);

    const voices = await provider.listVoices();
    expect(voices.length).toBe(2);
    expect(voices[0]?.id).toBe('en-US-JennyNeural');
    expect(voices[0]?.gender).toBe('female');
    expect(voices[0]?.isAvailable).toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list',
      expect.objectContaining({
        headers: {
          'Ocp-Apim-Subscription-Key': 'test-azure-key',
        },
      })
    );
  });

  it('4. Synthesizes MP3 with W3C SSML and required Microsoft headers', async () => {
    AzureTtsProvider.setTestCredentials('valid-key-123', 'westus2');

    const dummyAudio = Buffer.alloc(12000, 0xAA);
    let capturedBody = '';
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = String(init?.body || '');
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => dummyAudio.buffer,
      };
    });

    const result = await provider.synthesize({
      text: 'Exploring the outer solar system.',
      voiceId: 'en-US-JennyNeural',
    });

    expect(result.format).toBe('mp3');
    expect(result.providerUsed).toBe('azure');
    expect(result.sizeBytes).toBe(12000);
    expect(result.durationSeconds).toBeGreaterThan(0);

    // Verify SSML structure
    expect(capturedBody).toContain('<speak version=');
    expect(capturedBody).toContain("xml:lang='en-US'");
    expect(capturedBody).toContain("<voice name='en-US-JennyNeural'>");
    expect(capturedBody).toContain('Exploring the outer solar system.');

    // Verify REST headers
    expect(capturedHeaders['Ocp-Apim-Subscription-Key']).toBe('valid-key-123');
    expect(capturedHeaders['Content-Type']).toBe('application/ssml+xml');
    expect(capturedHeaders['X-Microsoft-OutputFormat']).toBe('audio-24khz-48kbitrate-mono-mp3');
  });

  it('5. Correctly classifies HTTP 401 as invalid_key', async () => {
    AzureTtsProvider.setTestCredentials('bad-key', 'eastus');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid subscription key',
    } as any);

    await expect(
      provider.synthesize({
        text: 'This will fail with 401.',
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('invalid_key');
      expect(err.statusCode).toBe(401);
      return true;
    });
  });

  it('6. Correctly classifies HTTP 403 as quota failure', async () => {
    AzureTtsProvider.setTestCredentials('exhausted-key', 'eastus');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'Quota exceeded',
    } as any);

    await expect(
      provider.synthesize({
        text: 'This will fail with 403.',
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('quota');
      expect(err.statusCode).toBe(403);
      return true;
    });
  });

  it('7. Correctly classifies HTTP 429 as rate_limit', async () => {
    AzureTtsProvider.setTestCredentials('throttled-key', 'eastus');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limit exceeded',
    } as any);

    await expect(
      provider.synthesize({
        text: 'This will fail with 429.',
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('rate_limit');
      expect(err.statusCode).toBe(429);
      return true;
    });
  });

  it('8. Handles AbortSignal cancellation', async () => {
    AzureTtsProvider.setTestCredentials('test-key', 'eastus');

    const ac = new AbortController();
    ac.abort();

    await expect(
      provider.synthesize({
        text: 'Aborted call',
        signal: ac.signal,
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('cancelled');
      return true;
    });
  });

  it('9. Connection test correctly returns operational status', async () => {
    AzureTtsProvider.setTestCredentials('working-key', 'eastus');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as any);

    const res = await provider.testConnection();
    expect(res.success).toBe(true);
    expect(res.message).toContain('eastus');
  });
});
