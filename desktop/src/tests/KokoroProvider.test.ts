import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KokoroProvider } from '../main/tts/KokoroProvider';

describe('KokoroProvider Truthful Runtime Detection & Synthesis', () => {
  let provider: KokoroProvider;

  beforeEach(() => {
    KokoroProvider.resetRuntimeStatus();
    provider = new KokoroProvider();
  });

  afterEach(() => {
    KokoroProvider.resetRuntimeStatus();
  });

  it('1. Reports accurate provider identity and default voice', () => {
    expect(provider.id).toBe('kokoro');
    expect(provider.name).toBe('Kokoro Local (ONNX)');
    expect(provider.defaultVoiceId).toBe('am_eric');
  });

  it('2. Detects onnxruntime-node truthfully when present and when simulated missing', async () => {
    // In this production environment, onnxruntime-node is installed
    expect(KokoroProvider.isRuntimeInstalled()).toBe(true);

    // When simulated missing, reports unavailable with clear instruction
    KokoroProvider.setRuntimeAvailableForTesting(false);
    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(false);

    const reason = provider.getUnavailableReason();
    expect(reason).toContain('onnxruntime-node');
    expect(reason).toContain('not installed');
  });

  it('3. Marks all returned voices accurately based on runtime status', async () => {
    // When simulated missing
    KokoroProvider.setRuntimeAvailableForTesting(false);
    let voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(v.provider).toBe('kokoro');
      expect(v.isAvailable).toBe(false);
      expect(v.unavailableReason).toBeDefined();
      expect(v.unavailableReason).toContain('onnxruntime-node');
    }

    // When runtime is present and model is loaded
    KokoroProvider.resetRuntimeStatus();
    voices = await provider.listVoices();
    for (const v of voices) {
      expect(v.provider).toBe('kokoro');
      expect(v.isAvailable).toBe(true);
      expect(v.unavailableReason).toBeUndefined();
    }
  });

  it('4. Refuses to fake synthesis when runtime is missing and throws descriptive error', async () => {
    KokoroProvider.setRuntimeAvailableForTesting(false);
    await expect(
      provider.synthesize({
        text: 'This should not fake synthesis.',
        voiceId: 'am_eric',
      })
    ).rejects.toThrow(/onnxruntime-node.*not installed/i);
  });

  it('5. Correctly reflects missing model file when model is not found on disk', async () => {
    KokoroProvider.setRuntimeAvailableForTesting(true);
    KokoroProvider.setTestModelPath('C:\\nonexistent\\kokoro-fake.onnx');

    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(false);
    expect(provider.getUnavailableReason()).toContain('model weights not found');
  });

  it('6. Synthesizes valid 16-bit 24kHz WAV audio when inference session is provided', async () => {
    KokoroProvider.setRuntimeAvailableForTesting(true);

    // Mock inference session that returns 24000 samples (1 second at 24kHz)
    const mockAudioData = new Float32Array(24000);
    for (let i = 0; i < mockAudioData.length; i++) {
      mockAudioData[i] = Math.sin((2 * Math.PI * 440 * i) / 24000) * 0.5; // 440Hz tone
    }

    const mockSession = {
      run: async () => ({
        audio: {
          data: mockAudioData,
        },
      }),
    };

    KokoroProvider.setTestInferenceSession(mockSession);

    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(true);
    expect(provider.getUnavailableReason()).toBeNull();

    const result = await provider.synthesize({
      text: 'The ocean abyss holds many secrets.',
      voiceId: 'am_eric',
    });

    expect(result.format).toBe('wav');
    expect(result.providerUsed).toBe('kokoro');
    expect(result.durationSeconds).toBe(1);
    expect(result.audioBuffer).toBeDefined();

    // Verify 44-byte RIFF WAV header
    const buf = result.audioBuffer;
    expect(buf.length).toBe(44 + 24000 * 2); // 44 header + 48000 bytes PCM16
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ');
    expect(buf.readUInt32LE(16)).toBe(16); // PCM chunk size
    expect(buf.readUInt16LE(20)).toBe(1);  // AudioFormat = 1 (PCM)
    expect(buf.readUInt16LE(22)).toBe(1);  // Channels = 1 (Mono)
    expect(buf.readUInt32LE(24)).toBe(24000); // Sample rate = 24kHz
    expect(buf.readUInt32LE(28)).toBe(48000); // Byte rate (24000 * 1 * 2)
    expect(buf.readUInt16LE(34)).toBe(16); // BitsPerSample = 16
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(40)).toBe(48000); // Subchunk2Size
  });

  it('7. Handles AbortSignal cancellation cleanly', async () => {
    KokoroProvider.setRuntimeAvailableForTesting(true);
    KokoroProvider.setTestInferenceSession({
      run: async () => ({ audio: { data: new Float32Array(24000) } }),
    });

    const ac = new AbortController();
    ac.abort();

    await expect(
      provider.synthesize({
        text: 'Cancellation test',
        voiceId: 'am_eric',
        signal: ac.signal,
      })
    ).rejects.toThrow(/aborted|cancelled/i);
  });

  it('8. Connection test returns success when session is active', async () => {
    KokoroProvider.setRuntimeAvailableForTesting(true);
    KokoroProvider.setTestInferenceSession({
      run: async () => ({ audio: { data: new Float32Array(24000) } }),
    });

    const testRes = await provider.testConnection();
    expect(testRes.success).toBe(true);
    expect(testRes.message).toContain('ready');
  });

  it('9. Real ONNX execution: synthesizes real WAV audio using actual onnxruntime-node and model', async () => {
    KokoroProvider.resetRuntimeStatus();
    expect(await provider.isAvailable()).toBe(true);

    const result = await provider.synthesize({
      text: 'Kokoro neural speech synthesis running locally on Windows with ONNX runtime.',
      voiceId: 'am_eric',
    });

    expect(result.format).toBe('wav');
    expect(result.providerUsed).toBe('kokoro');
    expect(result.durationSeconds).toBeGreaterThan(0.5);
    expect(result.sizeBytes).toBeGreaterThan(1000);
    expect(result.audioBuffer.length).toBe(result.sizeBytes);
    expect(result.audioBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.audioBuffer.toString('ascii', 8, 12)).toBe('WAVE');
    expect(result.audioBuffer.toString('ascii', 12, 16)).toBe('fmt ');
    expect(result.audioBuffer.readUInt32LE(24)).toBe(24000); // 24kHz
  }, 60000);

  it('10. Multi-voice distinctiveness: changing voice from am_eric to af_bella changes output audio characteristics', async () => {
    KokoroProvider.resetRuntimeStatus();
    expect(await provider.isAvailable()).toBe(true);

    const text = 'Infinity Flow provides multi-voice neural narration.';
    const resEric = await provider.synthesize({ text, voiceId: 'am_eric' });
    const resBella = await provider.synthesize({ text, voiceId: 'af_bella' });

    expect(resEric.audioBuffer.length).toBeGreaterThan(44);
    expect(resBella.audioBuffer.length).toBeGreaterThan(44);

    // Verify both are valid WAVs
    expect(resEric.audioBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(resBella.audioBuffer.toString('ascii', 0, 4)).toBe('RIFF');

    // Verify the generated audio bytes are genuinely distinct between voices
    const ericSlice = resEric.audioBuffer.subarray(44, 1000);
    const bellaSlice = resBella.audioBuffer.subarray(44, 1000);
    expect(Buffer.compare(ericSlice, bellaSlice)).not.toBe(0);
  }, 60000);

  it('11. Text normalization & phonemization correctly prepares speech tokens', async () => {
    const raw = 'Dr. Smith visited Mr. Jones and spent $25 on 50% discounts etc.';
    const norm = KokoroProvider.normalizeText(raw);
    expect(norm).toContain('Doctor Smith');
    expect(norm).toContain('Mister Jones');
    expect(norm).toContain('25 dollars');
    expect(norm).toContain('50 percent');
    expect(norm).toContain('etcetera');

    const tokens = await KokoroProvider.tokenizeText(raw, 'am_eric');
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens[0]).toBe(0); // Bos
    expect(tokens[tokens.length - 1]).toBe(0); // Eos
  });
});
