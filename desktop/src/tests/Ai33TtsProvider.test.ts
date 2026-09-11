import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Ai33TtsProvider } from '../main/tts/Ai33TtsProvider';
import { TtsError } from '../main/tts/TtsErrorClassifier';

describe('Ai33TtsProvider Multi-Source API & SRT Parsing', () => {
  let provider: Ai33TtsProvider;

  beforeEach(() => {
    Ai33TtsProvider.resetTestCredentials();
    Ai33TtsProvider.setTestPollIntervalMs(5);
    provider = new Ai33TtsProvider();
  });

  afterEach(() => {
    Ai33TtsProvider.resetTestCredentials();
  });

  it('1. Reports correct identity and credentials requirement', () => {
    expect(provider.id).toBe('ai33');
    expect(provider.name).toContain('ai33.pro');
    expect(provider.badge).toBe('API KEY');
    expect(provider.defaultVoiceId).toBe('elevenlabs:rachel');
    expect(provider.supportsWordTimings).toBe(true);
  });

  it('2. Correctly flags unavailable when key is missing', async () => {
    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(false);
    expect(provider.getUnavailableReason()).toContain('ai33.pro API Key is not configured');

    const voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThanOrEqual(8);
    for (const v of voices) {
      expect(v.isAvailable).toBe(false);
      expect(v.unavailableReason).toBeDefined();
    }
  });

  it('3. Parses SRT transcripts into exact WordTiming cues', () => {
    const srt = `1
00:00:00,000 --> 00:00:01,500
The deep ocean

2
00:00:01,500 --> 00:00:03,000
remains largely uncharted
`;

    const timings = Ai33TtsProvider.parseSrtToWordTimings(srt);
    expect(timings.length).toBe(6);

    // First cue: "The deep ocean" (1500ms / 3 words = 500ms per word)
    expect(timings[0]?.word).toBe('The');
    expect(timings[0]?.startMs).toBe(0);
    expect(timings[0]?.durationMs).toBe(500);

    expect(timings[1]?.word).toBe('deep');
    expect(timings[1]?.startMs).toBe(500);

    expect(timings[2]?.word).toBe('ocean');
    expect(timings[2]?.startMs).toBe(1000);

    // Second cue: "remains largely uncharted" (1500ms to 3000ms, 1500ms / 3 = 500ms)
    expect(timings[3]?.word).toBe('remains');
    expect(timings[3]?.startMs).toBe(1500);
  });

  it('4. Successfully executes multipart task submission, polling, and audio download', async () => {
    Ai33TtsProvider.setTestCredentials('test-ai33-key', 'https://api.test-ai33.pro');

    const dummyAudio = Buffer.alloc(18000, 0xEE);
    const dummySrt = `1\n00:00:00,000 --> 00:00:02,000\nExploring the cosmos\n`;

    let taskPosted = false;
    let pollCount = 0;

    Ai33TtsProvider.setTestHandler(async (url, init) => {
      // 1. Task post
      if (url.includes('/v1/task') && init?.method === 'POST') {
        taskPosted = true;
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer test-ai33-key',
        });
        return new Response(JSON.stringify({ code: 0, data: { task_id: 'task_abc_123' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. Task poll
      if (url.includes('/v1/task/task_abc_123') && (!init || init.method === 'GET' || !init.method)) {
        pollCount++;
        if (pollCount === 1) {
          // first poll: still processing
          return new Response(JSON.stringify({ code: 0, data: { status: 'processing' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // second poll: completed
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              status: 'success',
              audio_url: 'https://cdn.test-ai33.pro/audio/test.mp3',
              srt: dummySrt,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 3. Audio download
      if (url.includes('https://cdn.test-ai33.pro/audio/test.mp3')) {
        return new Response(dummyAudio, { status: 200 });
      }

      throw new Error(`Unhandled test URL: ${url}`);
    });

    const result = await provider.synthesize({
      text: 'Exploring the cosmos',
      voiceId: 'elevenlabs:adam',
    });

    expect(taskPosted).toBe(true);
    expect(pollCount).toBe(2);
    expect(result.format).toBe('mp3');
    expect(result.providerUsed).toBe('ai33');
    expect(result.sizeBytes).toBe(18000);
    expect(result.wordTimings).toBeDefined();
    expect(result.wordTimings?.length).toBe(3);
    expect(result.wordTimings?.[0]?.word).toBe('Exploring');
  });

  it('5. Rejects unsupported or unknown voice ID', async () => {
    Ai33TtsProvider.setTestCredentials('test-key');

    await expect(
      provider.synthesize({
        text: 'Invalid voice test',
        voiceId: 'unknown:voice-999',
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('invalid_voice');
      return true;
    });
  });

  it('6. Correctly classifies HTTP 401 as invalid_key', async () => {
    Ai33TtsProvider.setTestCredentials('bad-key', 'https://api.test-ai33.pro');

    Ai33TtsProvider.setTestHandler(async () => {
      return new Response('Unauthorized key', { status: 401, statusText: 'Unauthorized' });
    });

    await expect(
      provider.synthesize({
        text: 'Auth failure test',
        voiceId: 'elevenlabs:rachel',
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('invalid_key');
      expect(err.statusCode).toBe(401);
      return true;
    });
  });

  it('7. Handles AbortSignal during task polling', async () => {
    Ai33TtsProvider.setTestCredentials('valid-key', 'https://api.test-ai33.pro');

    const ac = new AbortController();

    Ai33TtsProvider.setTestHandler(async (url) => {
      if (url.includes('/v1/task') && !url.includes('task_')) {
        return new Response(JSON.stringify({ data: { task_id: 'task_cancel_test' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Abort right as polling starts
      ac.abort();
      return new Response(JSON.stringify({ data: { status: 'processing' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      provider.synthesize({
        text: 'Cancellation during poll',
        voiceId: 'elevenlabs:rachel',
        signal: ac.signal,
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.classification).toBe('cancelled');
      return true;
    });
  });

  it('8. Test connection passes when API key is valid', async () => {
    Ai33TtsProvider.setTestCredentials('good-key', 'https://api.test-ai33.pro');

    Ai33TtsProvider.setTestHandler(async (url) => {
      if (url.includes('/v1/voices')) {
        return new Response(JSON.stringify({ code: 0, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('ok', { status: 200 });
    });

    const conn = await provider.testConnection();
    expect(conn.success).toBe(true);
    expect(conn.message).toContain('Connected to ai33.pro');
  });
});
