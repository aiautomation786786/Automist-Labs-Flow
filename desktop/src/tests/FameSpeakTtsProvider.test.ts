import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FameSpeakTtsProvider } from '../main/tts/FameSpeakTtsProvider';
import { TtsError } from '../main/tts/TtsErrorClassifier';

describe('FameSpeakTtsProvider Protocol, Exact Fields & 7-Day Cache', () => {
  let provider: FameSpeakTtsProvider;
  let tempDir: string;
  let testCachePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'famespeak-test-'));
    testCachePath = path.join(tempDir, 'famespeak-voices-cache.json');
    FameSpeakTtsProvider.resetTestCredentials();
    FameSpeakTtsProvider.setTestCachePath(testCachePath);
    FameSpeakTtsProvider.setTestPacingMs(5);
    FameSpeakTtsProvider.setTestPollIntervalMs(5);
    provider = new FameSpeakTtsProvider();
  });

  afterEach(() => {
    FameSpeakTtsProvider.resetTestCredentials();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Reports correct identity and credentials requirement', () => {
    expect(provider.id).toBe('famespeak');
    expect(provider.name).toContain('FameSpeak');
    expect(provider.badge).toBe('API KEY');
    expect(provider.defaultVoiceId).toBe('fs_morgan_freeman');
    expect(provider.supportsWordTimings).toBe(false);
  });

  it('2. Correctly flags unavailable when key is missing', async () => {
    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(false);

    const reason = provider.getUnavailableReason();
    expect(reason).toContain('FameSpeak Bearer API Key is not configured');

    const fallback = await provider.listVoices();
    expect(fallback.length).toBeGreaterThanOrEqual(4);
    for (const v of fallback) {
      expect(v.isAvailable).toBe(false);
    }
  });

  it('3. Synthesis includes Idempotency-Key and sends only { text, voice } payload', async () => {
    FameSpeakTtsProvider.setTestCredentials('famespeak-secret-key-12345', 'https://api.test-fs.com');

    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;
    let pollCount = 0;
    const dummyAudio = Buffer.alloc(16000, 0xCC);

    FameSpeakTtsProvider.setTestHandler(async (url, init) => {
      // 1. Generation post
      if (url.includes('/api/v1/tts/generations') && init?.method === 'POST') {
        capturedHeaders = (init?.headers || {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body || '{}'));

        return new Response(
          JSON.stringify({
            status: 'pending',
            id: 'gen_fs_98765',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 2. Generation status poll
      if (url.includes('/api/v1/tts/generations/gen_fs_98765') && !url.includes('/audio')) {
        pollCount++;
        return new Response(
          JSON.stringify({
            status: 'completed',
            id: 'gen_fs_98765',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 3. Audio download
      if (url.includes('/api/v1/tts/generations/gen_fs_98765/audio')) {
        return new Response(dummyAudio, { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const res = await provider.synthesize({
      text: 'Deep in space, stars collide.',
      voiceId: 'fs_morgan_freeman',
    });

    expect(res.format).toBe('mp3');
    expect(res.providerUsed).toBe('famespeak');
    expect(res.sizeBytes).toBe(16000);
    expect(pollCount).toBe(1);

    // Verify exact documented request payload (no invented fields)
    expect(capturedBody).toEqual({
      text: 'Deep in space, stars collide.',
      voice: 'fs_morgan_freeman',
    });

    // Verify Idempotency-Key and Bearer Authorization
    expect(capturedHeaders['Authorization']).toBe('Bearer famespeak-secret-key-12345');
    expect(capturedHeaders['Idempotency-Key']).toBeDefined();
    expect(capturedHeaders['Idempotency-Key'].length).toBeGreaterThan(10);
  });

  it('4. Voice walk writes 7-day disk cache and subsequent call serves from cache without hitting network', async () => {
    FameSpeakTtsProvider.setTestCredentials('famespeak-key-abcdef', 'https://api.test-fs.com');

    let networkHits = 0;

    FameSpeakTtsProvider.setTestHandler(async (url) => {
      if (url.includes('/api/v1/voices')) {
        networkHits++;
        return new Response(
          JSON.stringify({
            items: [
              { id: 'fs_voice_1', displayName: 'Voice One', locale: 'en-US', gender: 'male', tier: 'premium' },
              { id: 'fs_voice_2', displayName: 'Voice Two', locale: 'en-GB', gender: 'female', tier: 'free' },
            ],
            totalPages: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected: ${url}`);
    });

    // First call: hits network and writes disk cache
    const voices1 = await provider.listVoices();
    expect(networkHits).toBe(1);
    expect(voices1.length).toBe(2);
    expect(fs.existsSync(testCachePath)).toBe(true);

    // Verify cache file contents
    const rawCache = JSON.parse(fs.readFileSync(testCachePath, 'utf-8'));
    expect(rawCache.keyTail).toBeDefined();
    expect(rawCache.timestamp).toBeGreaterThan(0);
    expect(rawCache.voices.length).toBe(2);

    // Second call: must hit cache and NOT hit network
    const voices2 = await provider.listVoices();
    expect(networkHits).toBe(1); // Unchanged!
    expect(voices2.length).toBe(2);
    expect(voices2[0]?.id).toBe('fs_voice_1');
  });

  it('5. Serves stale disk cache when refresh network walk encounters failure', async () => {
    FameSpeakTtsProvider.setTestCredentials('famespeak-key-stale-test', 'https://api.test-fs.com');

    // Pre-populate stale cache (e.g. 10 days old)
    const staleTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const keyTail = 'stale-test'.slice(-8);
    const staleData = {
      keyTail,
      timestamp: staleTime,
      voices: [
        {
          id: 'fs_stale_voice_01',
          name: 'Stale Cached Voice',
          provider: 'famespeak',
          locale: 'en-US',
          gender: 'male',
          isAvailable: true,
        },
      ],
    };
    fs.mkdirSync(path.dirname(testCachePath), { recursive: true });
    fs.writeFileSync(testCachePath, JSON.stringify(staleData), 'utf-8');

    // Network fails (e.g. 500 error)
    FameSpeakTtsProvider.setTestHandler(async () => {
      return new Response('Internal Server Error', { status: 500, statusText: 'Server Error' });
    });

    // listVoices should fall back to stale cache rather than failing
    const result = await provider.listVoices();
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe('fs_stale_voice_01');
    expect(result[0]?.isAvailable).toBe(true);
  });

  it('6. Correctly classifies HTTP 401 as invalid_key', async () => {
    FameSpeakTtsProvider.setTestCredentials('bad-key', 'https://api.test-fs.com');

    FameSpeakTtsProvider.setTestHandler(async () => {
      return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });

    await expect(
      provider.synthesize({
        text: 'Auth failure',
        voiceId: 'fs_morgan_freeman',
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('invalid_key');
      expect(err.statusCode).toBe(401);
      return true;
    });
  });

  it('7. Handles AbortSignal during generation polling', async () => {
    FameSpeakTtsProvider.setTestCredentials('valid-key', 'https://api.test-fs.com');

    const ac = new AbortController();

    FameSpeakTtsProvider.setTestHandler(async (url) => {
      if (url.includes('/api/v1/tts/generations') && !url.includes('gen_')) {
        return new Response(JSON.stringify({ id: 'gen_cancel_test', status: 'pending' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      ac.abort();
      return new Response(JSON.stringify({ id: 'gen_cancel_test', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      provider.synthesize({
        text: 'Aborted during poll',
        voiceId: 'fs_morgan_freeman',
        signal: ac.signal,
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('cancelled');
      return true;
    });
  });

  it('8. Test connection succeeds when API responds healthy', async () => {
    FameSpeakTtsProvider.setTestCredentials('working-key', 'https://api.test-fs.com');

    FameSpeakTtsProvider.setTestHandler(async () => {
      return new Response(JSON.stringify({ items: [], totalPages: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const conn = await provider.testConnection();
    expect(conn.success).toBe(true);
    expect(conn.message).toContain('Connected to FameSpeak');
  });
});
