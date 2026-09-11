/**
 * KokoroProvider – Authentic Local Offline ONNX Text-to-Speech Provider.
 *
 * Implements genuine Kokoro-82M v1.0 neural execution via onnxruntime-node,
 * real eSpeak NG phonemizer + IPA tokenization, official 510-dim voice style vectors,
 * and authentic 16-bit 24kHz mono PCM WAV output.
 *
 * Requirements:
 *  - Truthful availability: reports available only when onnxruntime-node, model, and voice embeddings exist.
 *  - Lazy initialization: does not load weights or create sessions until synthesis requires it.
 *  - Standard 44-byte RIFF WAV encoding at 24kHz.
 *  - AbortSignal cancellation support.
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
import { getAppDataDir, AppLogger } from '../utils/AppLogger';
import { classifyTtsError, TtsError } from './TtsErrorClassifier';

const logger = new AppLogger({ mirrorToStderr: false });

export interface KokoroModelPaths {
  modelPath: string;
  voicesDir?: string;
  tokenizerPath?: string;
}

// Official 115-token Kokoro phoneme vocabulary mapping
const KOKORO_VOCAB: Record<string, number> = {
  '$': 0, ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11, '(': 12, ')': 13,
  '“': 14, '”': 15, ' ': 16, '̃': 17, 'ʣ': 18, 'ʥ': 19, 'ʦ': 20, 'ʨ': 21, 'ᵝ': 22, 'ꭧ': 23,
  'A': 24, 'I': 25, 'O': 31, 'Q': 33, 'S': 35, 'T': 36, 'W': 39, 'Y': 41,
  'a': 42, 'b': 43, 'c': 44, 'd': 45, 'e': 46, 'f': 47, 'h': 48, 'i': 49, 'j': 50, 'k': 51,
  'l': 52, 'm': 53, 'n': 54, 'o': 55, 'p': 56, 'q': 57, 'r': 58, 's': 59, 't': 60, 'u': 61,
  'v': 62, 'w': 63, 'x': 64, 'y': 65, 'z': 66,
  'æ': 67, 'ç': 68, 'ð': 69, 'ø': 70, 'ŋ': 71, 'œ': 72, 'ɐ': 73, 'ɑ': 74, 'ɒ': 75, 'ɔ': 76,
  'ɕ': 77, 'ɖ': 78, 'ə': 79, 'ɚ': 80, 'ɛ': 81, 'ɜ': 82, 'ɟ': 83, 'ɡ': 84, 'ɣ': 85, 'ɤ': 86,
  'ɥ': 87, 'ɨ': 88, 'ɪ': 89, 'ɯ': 90, 'ɰ': 91, 'ɲ': 92, 'ɳ': 93, 'ɴ': 94, 'ɸ': 95, 'ɹ': 96,
  'ɻ': 97, 'ɽ': 98, 'ɾ': 99, 'ʁ': 100, 'ʂ': 101, 'ʃ': 102, 'ʈ': 103, 'ʊ': 104, 'ʋ': 105,
  'ʌ': 106, 'ʎ': 107, 'ʒ': 108, 'ʔ': 109, 'ʝ': 110, 'ʤ': 111, 'ʧ': 112,
  'ʰ': 113, 'ʲ': 114, 'ˈ': 115, 'ˌ': 116, 'ː': 117,
  'β': 118, 'θ': 119, 'χ': 120, 'ᵊ': 121, 'ᵻ': 122,
  '→': 123, '↓': 124, '↗': 125, '↘': 126,
};

export class KokoroProvider implements ITtsProvider {
  readonly id: TtsProviderId = 'kokoro';
  readonly name = 'Kokoro Local (ONNX)';
  readonly badge: TtsEngineBadge = 'LOCAL';
  readonly audioExtension = 'wav' as const;
  readonly defaultVoiceId = 'am_eric';
  readonly supportsWordTimings = false;

  private static testRuntimeAvailable: boolean | null = null;
  private static testModelPath: string | null = null;
  private static testVoicesDir: string | null = null;
  private static testInferenceSession: any = null;

  private static session: any = null;
  private static readonly voiceCache = new Map<string, Float32Array>();

  // Curated list of authentic Kokoro voices with bundled embeddings
  private static readonly VOICES: VoiceInfo[] = [
    {
      id: 'am_eric',
      name: 'Eric (American Male - Default)',
      provider: 'kokoro',
      locale: 'en-US',
      gender: 'male',
      description: 'Authoritative, engaging documentary narrator',
      isAvailable: false,
    },
    {
      id: 'af_heart',
      name: 'Heart (American Female - Flagship)',
      provider: 'kokoro',
      locale: 'en-US',
      gender: 'female',
      description: 'Warm, highly natural flagship storyteller',
      isAvailable: false,
    },
    {
      id: 'af_bella',
      name: 'Bella (American Female)',
      provider: 'kokoro',
      locale: 'en-US',
      gender: 'female',
      description: 'Clear, natural American storyteller',
      isAvailable: false,
    },
    {
      id: 'af_sarah',
      name: 'Sarah (American Female)',
      provider: 'kokoro',
      locale: 'en-US',
      gender: 'female',
      description: 'Warm, conversational speaker',
      isAvailable: false,
    },
    {
      id: 'am_adam',
      name: 'Adam (American Male)',
      provider: 'kokoro',
      locale: 'en-US',
      gender: 'male',
      description: 'Deep, resonant cinematic voice',
      isAvailable: false,
    },
    {
      id: 'bm_george',
      name: 'George (British Male)',
      provider: 'kokoro',
      locale: 'en-GB',
      gender: 'male',
      description: 'Distinguished British narrator',
      isAvailable: false,
    },
    {
      id: 'bf_emma',
      name: 'Emma (British Female)',
      provider: 'kokoro',
      locale: 'en-GB',
      gender: 'female',
      description: 'Refined, articulate British speaker',
      isAvailable: false,
    },
  ];

  // ---------------------------------------------------------------------------
  // Runtime & Asset Discovery
  // ---------------------------------------------------------------------------

  /**
   * Safely loads onnxruntime-node, supporting standard require as well as
   * unpacked Electron ASAR locations in packaged production builds.
   */
  static getOrtModule(): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('onnxruntime-node');
    } catch (requireErr) {
      if (process.resourcesPath) {
        const unpackedPath = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          'onnxruntime-node'
        );
        if (fs.existsSync(unpackedPath)) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          return require(unpackedPath);
        }
      }
      throw requireErr;
    }
  }

  /**
   * Safely loads phonemizer, supporting standard require as well as
   * unpacked Electron ASAR locations in packaged production builds.
   */
  static getPhonemizerModule(): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('phonemizer');
    } catch (requireErr) {
      if (process.resourcesPath) {
        const unpackedPath = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          'phonemizer'
        );
        if (fs.existsSync(unpackedPath)) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          return require(unpackedPath);
        }
      }
      throw requireErr;
    }
  }

  /**
   * Checks whether onnxruntime-node is resolvable in the environment.
   */
  static isRuntimeInstalled(): boolean {
    if (this.testRuntimeAvailable !== null) {
      return this.testRuntimeAvailable;
    }
    try {
      this.getOrtModule();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discovers the Kokoro ONNX model file on disk across production resourcesPath,
   * bundled assets, and user AppData storage.
   */
  static getModelPath(): string | null {
    if (this.testModelPath !== null) {
      return this.testModelPath;
    }

    if (process.env.KOKORO_MODEL_PATH && fs.existsSync(process.env.KOKORO_MODEL_PATH)) {
      return process.env.KOKORO_MODEL_PATH;
    }

    const appData = getAppDataDir();
    const candidatePaths: string[] = [];

    // 1. Packaged extraResources in production Electron app
    if (process.resourcesPath) {
      candidatePaths.push(
        path.join(process.resourcesPath, 'models', 'kokoro', 'kokoro-v1.0.onnx'),
        path.join(process.resourcesPath, 'models', 'kokoro.onnx'),
        path.join(process.resourcesPath, 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx')
      );
    }

    // 2. Bundled assets relative to compiled output / source tree
    candidatePaths.push(
      path.join(__dirname, '..', '..', 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx'),
      path.join(__dirname, '..', '..', '..', 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx'),
      path.join(__dirname, '..', 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx'),
      path.join(process.cwd(), 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx'),
      path.join(process.cwd(), 'desktop', 'assets', 'models', 'kokoro', 'kokoro-v1.0.onnx')
    );

    // 3. User AppData directory
    candidatePaths.push(
      path.join(appData, 'models', 'kokoro', 'kokoro-v1.0.onnx'),
      path.join(appData, 'models', 'kokoro.onnx')
    );

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          return p;
        }
      } catch {
        // continue
      }
    }

    return null;
  }

  /**
   * Discovers the voices directory containing .bin voice embeddings.
   */
  static getVoicesDir(): string | null {
    if (this.testVoicesDir !== null) {
      return this.testVoicesDir;
    }

    const modelPath = this.getModelPath();
    if (modelPath) {
      const adjacentVoices = path.join(path.dirname(modelPath), 'voices');
      if (fs.existsSync(adjacentVoices)) {
        return adjacentVoices;
      }
    }

    const candidateDirs: string[] = [];
    if (process.resourcesPath) {
      candidateDirs.push(
        path.join(process.resourcesPath, 'models', 'kokoro', 'voices'),
        path.join(process.resourcesPath, 'assets', 'models', 'kokoro', 'voices')
      );
    }

    candidateDirs.push(
      path.join(__dirname, '..', '..', 'assets', 'models', 'kokoro', 'voices'),
      path.join(__dirname, '..', '..', '..', 'assets', 'models', 'kokoro', 'voices'),
      path.join(process.cwd(), 'assets', 'models', 'kokoro', 'voices'),
      path.join(process.cwd(), 'desktop', 'assets', 'models', 'kokoro', 'voices'),
      path.join(getAppDataDir(), 'models', 'kokoro', 'voices')
    );

    for (const d of candidateDirs) {
      try {
        if (fs.existsSync(d)) {
          return d;
        }
      } catch {
        // continue
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Test Hooks
  // ---------------------------------------------------------------------------

  static setRuntimeAvailableForTesting(available: boolean | null): void {
    this.testRuntimeAvailable = available;
  }

  static setTestModelPath(modelPath: string | null): void {
    this.testModelPath = modelPath;
  }

  static setTestVoicesDir(voicesDir: string | null): void {
    this.testVoicesDir = voicesDir;
  }

  static setTestInferenceSession(mockSession: any): void {
    this.testInferenceSession = mockSession;
    this.session = mockSession;
  }

  static resetRuntimeStatus(): void {
    this.testRuntimeAvailable = null;
    this.testModelPath = null;
    this.testVoicesDir = null;
    this.testInferenceSession = null;
    this.session = null;
    this.voiceCache.clear();
  }

  // ---------------------------------------------------------------------------
  // ITtsProvider Implementation
  // ---------------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    if (!KokoroProvider.isRuntimeInstalled()) {
      return false;
    }

    if (KokoroProvider.testInferenceSession) {
      return true;
    }

    const modelPath = KokoroProvider.getModelPath();
    if (!modelPath || !fs.existsSync(modelPath)) {
      return false;
    }

    const voicesDir = KokoroProvider.getVoicesDir();
    return Boolean(voicesDir && fs.existsSync(voicesDir));
  }

  getUnavailableReason(): string | null {
    if (!KokoroProvider.isRuntimeInstalled()) {
      return 'onnxruntime-node runtime is not installed in this environment. Run npm install onnxruntime-node to enable local ONNX execution.';
    }

    if (KokoroProvider.testInferenceSession) {
      return null;
    }

    const modelPath = KokoroProvider.getModelPath();
    if (!modelPath || !fs.existsSync(modelPath)) {
      return `Kokoro model weights not found. Ensure kokoro-v1.0.onnx is present in application resources or ${path.join(getAppDataDir(), 'models', 'kokoro')}.`;
    }

    const voicesDir = KokoroProvider.getVoicesDir();
    if (!voicesDir || !fs.existsSync(voicesDir)) {
      return `Kokoro voice embeddings not found. Ensure voices/*.bin are present in application resources.`;
    }

    return null;
  }

  private static isPrewarming = false;

  /**
   * Prewarms the ONNX session, phonemizer, and default voice styles in the background.
   */
  static async prewarm(): Promise<void> {
    if (this.session) return;
    try {
      await this.getInferenceSession();
      const phonemizer = this.getPhonemizerModule();
      if (phonemizer && typeof phonemizer.phonemize === 'function') {
        await phonemizer.phonemize('welcome', 'en-us');
      }
      for (const v of ['am_eric', 'af_heart', 'af_bella', 'bm_george']) {
        try {
          this.getVoiceStyleVector(v, 20);
        } catch {}
      }
      logger.info('kokoro_tts', 'Kokoro session, phonemizer, and voice styles successfully prewarmed.');
    } catch (err: any) {
      logger.warn('kokoro_tts', `Kokoro prewarm background task encountered: ${err.message}`);
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const available = await this.isAvailable();
    const reason = this.getUnavailableReason() || undefined;

    // Trigger background prewarming if available and not yet loaded
    if (available && !KokoroProvider.session && !KokoroProvider.isPrewarming && !KokoroProvider.testInferenceSession) {
      KokoroProvider.isPrewarming = true;
      KokoroProvider.prewarm().finally(() => {
        KokoroProvider.isPrewarming = false;
      });
    }

    return KokoroProvider.VOICES.map((v) => ({
      ...v,
      isAvailable: available,
      unavailableReason: available ? undefined : reason,
    }));
  }

  /**
   * Lazily loads and caches the ONNX Inference Session.
   */
  private static async getInferenceSession(): Promise<any> {
    if (this.session) {
      return this.session;
    }

    if (!this.isRuntimeInstalled()) {
      throw new TtsError(
        'Kokoro TTS cannot execute: onnxruntime-node runtime is not installed in this environment.',
        'unavailable',
        'kokoro'
      );
    }

    const modelPath = this.getModelPath();
    if (!modelPath) {
      throw new TtsError(
        'Kokoro TTS cannot execute: model weights file not found on disk.',
        'unavailable',
        'kokoro'
      );
    }

    try {
      const ort = KokoroProvider.getOrtModule();
      const sessionOptions = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: 1, // Single high-performance thread eliminates Windows hybrid P/E core thrashing
        interOpNumThreads: 1,
      };

      logger.info('kokoro_tts', `Loading authentic Kokoro ONNX model from ${modelPath} (intraOpNumThreads: 1)`);
      this.session = await ort.InferenceSession.create(modelPath, sessionOptions);
      return this.session;
    } catch (err: any) {
      logger.error('kokoro_tts', 'Failed to instantiate ONNX session for Kokoro', err);
      throw new TtsError(`Failed to load Kokoro ONNX model: ${err.message}`, 'unavailable', 'kokoro', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Text Preprocessing, Phonemization & Tokenization
  // ---------------------------------------------------------------------------

  /**
   * Normalizes abbreviations, numbers, currency, times, and punctuation for natural speech.
   */
  static normalizeText(text: string): string {
    function expandNumberOrTime(e: string): string {
      if (e.includes('.')) return e;
      if (e.includes(':')) {
        const [h, m] = e.split(':').map(Number);
        return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
      }
      const n = parseInt(e.slice(0, 4), 10);
      if (n < 1100 || n % 1000 < 10) return e;
      const t = e.slice(0, 2);
      const r = parseInt(e.slice(2, 4), 10);
      const s = e.endsWith('s') ? 's' : '';
      if (n % 1000 >= 100 && n % 1000 <= 999) {
        if (r === 0) return `${t} hundred${s}`;
        if (r < 10) return `${t} oh ${r}${s}`;
      }
      return `${t} ${r}${s}`;
    }

    function expandCurrency(e: string): string {
      const unit = e[0] === '$' ? 'dollar' : 'pound';
      if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${unit}s`;
      if (!e.includes('.')) {
        const plural = e.slice(1) === '1' ? '' : 's';
        return `${e.slice(1)} ${unit}${plural}`;
      }
      const [intPart, decPart] = e.slice(1).split('.');
      const cents = parseInt(decPart.padEnd(2, '0'), 10);
      const intPlural = intPart === '1' ? '' : 's';
      const subUnit = e[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : (cents === 1 ? 'penny' : 'pence');
      return `${intPart} ${unit}${intPlural} and ${cents} ${subUnit}`;
    }

    function expandDecimal(e: string): string {
      const [a, t] = e.split('.');
      return `${a} point ${t.split('').join(' ')}`;
    }

    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u00ab/g, '"')
      .replace(/\u00bb/g, '"')
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\(/g, '\u00ab')
      .replace(/\)/g, '\u00bb')
      .replace(/\u3001/g, ', ')
      .replace(/\u3002/g, '. ')
      .replace(/\uff01/g, '! ')
      .replace(/\uff0c/g, ', ')
      .replace(/\uff1a/g, ': ')
      .replace(/\uff1b/g, '; ')
      .replace(/\uff1f/g, '? ')
      .replace(/[^\S \n]/g, ' ')
      .replace(/  +/g, ' ')
      .replace(/(?<=\n) +(?=\n)/g, '')
      .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
      .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
      .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
      .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
      .replace(/\betc\.(?! [A-Z])/gi, 'etc')
      .replace(/\b(y)eah?\b/gi, "$1e'a")
      .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, expandNumberOrTime)
      .replace(/(?<=\d),(?=\d)/g, '')
      .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, expandCurrency)
      .replace(/\d*\.\d+/g, expandDecimal)
      .replace(/(?<=\d)-(?=\d)/g, ' to ')
      .replace(/(?<=\d)S/g, ' S')
      .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
      .replace(/(?<=X')S\b/g, 's')
      .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (e => e.replace(/\./g, '-')))
      .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
      .trim();
  }

  /**
   * Converts plain English text into Kokoro IPA phonemes, preserving all punctuation
   * to ensure natural prosody, inflection, and cadence as required by Kokoro-82M.
   */
  static async phonemizeText(text: string, voiceId = 'am_eric'): Promise<string> {
    const sanitized = this.normalizeText(text);
    if (!sanitized) return '';

    const isBritish = voiceId.startsWith('b');
    const lang = isBritish ? 'en' : 'en-us';
    const voicePrefix = isBritish ? 'b' : 'a';

    const puncPattern = ';:,.!?\u00a1\u00bf\u2014\u2026\"\u00ab\u00bb\u201c\u201d(){}[]';
    const escaped = puncPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('(\\s*[' + escaped + ']+\\s*)+', 'g');

    const segments: Array<{ isPunc: boolean; text: string }> = [];
    let lastIdx = 0;
    for (const match of sanitized.matchAll(regex)) {
      const matchedPunc = match[0];
      if (lastIdx < match.index) {
        segments.push({ isPunc: false, text: sanitized.slice(lastIdx, match.index) });
      }
      if (matchedPunc.length > 0) {
        segments.push({ isPunc: true, text: matchedPunc });
      }
      lastIdx = match.index + matchedPunc.length;
    }
    if (lastIdx < sanitized.length) {
      segments.push({ isPunc: false, text: sanitized.slice(lastIdx) });
    }

    let rawPhones = '';
    try {
      const phonemizer = this.getPhonemizerModule();
      if (phonemizer && typeof phonemizer.phonemize === 'function') {
        const parts = await Promise.all(
          segments.map(async ({ isPunc, text: segText }) => {
            if (isPunc) return segText;
            const res = await phonemizer.phonemize(segText, lang);
            return res.join(' ');
          })
        );
        rawPhones = parts.join('');
      }
    } catch (err) {
      logger.warn('kokoro_tts', `Phonemizer execution warning: ${err}`);
    }

    if (!rawPhones) {
      // Fallback if phonemizer is unavailable
      rawPhones = sanitized;
    }

    // Official Kokoro phonetic adjustments
    rawPhones = rawPhones
      .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
      .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
      .replace(/ʲ/g, 'j')
      .replace(/r/g, 'ɹ')
      .replace(/x/g, 'k')
      .replace(/ɬ/g, 'l')
      .replace(/(?<=[a-zɹː])(?=hˈʌndɹəd)/g, ' ')
      .replace(/ z(?=[;:,.!?\u00a1\u00bf\u2014\u2026\"\u00ab\u00bb\u201c\u201d ]|$)/g, 'z');

    if (voicePrefix === 'a') {
      rawPhones = rawPhones.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
    }

    return rawPhones.trim();
  }

  /**
   * Converts text or phonemes into Kokoro model token IDs using the 115-character vocabulary.
   */
  static async tokenizeText(text: string, voiceId = 'am_eric'): Promise<number[]> {
    const phonemes = await this.phonemizeText(text, voiceId);
    const tokens: number[] = [0]; // Bos ($)

    for (let i = 0; i < phonemes.length; i++) {
      const char = phonemes[i];
      if (KOKORO_VOCAB[char] !== undefined) {
        tokens.push(KOKORO_VOCAB[char]);
      }
    }

    tokens.push(0); // Eos ($)
    return tokens.length > 2 ? tokens : [0, 16, 0];
  }

  /**
   * Loads the authentic 510-dimension style embedding from the official voice .bin file,
   * selecting the exact 256-float vector corresponding to sequence length N.
   */
  static getVoiceStyleVector(voiceId: string, tokenLength: number): Float32Array {
    if (this.testInferenceSession) {
      const mockVector = new Float32Array(256);
      mockVector.fill(0.1);
      return mockVector;
    }

    const voicesDir = this.getVoicesDir();
    if (!voicesDir) {
      throw new Error('Kokoro voices directory not found on disk.');
    }

    let floatArr = this.voiceCache.get(voiceId);
    if (!floatArr) {
      const voiceFile = path.join(voicesDir, `${voiceId}.bin`);
      if (!fs.existsSync(voiceFile)) {
        throw new Error(`Kokoro voice embedding file not found: '${voiceFile}'.`);
      }
      const buf = fs.readFileSync(voiceFile);
      floatArr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      this.voiceCache.set(voiceId, floatArr);
    }

    // Index clamped between 0 and 509 (excluding start/end tokens)
    const styleIdx = Math.min(Math.max(tokenLength - 2, 0), 509);
    const start = styleIdx * 256;
    return floatArr.slice(start, start + 256);
  }

  /**
   * Trims leading and trailing model silence while preserving a natural 40ms audio cushion
   * to eliminate stuttering and unnatural gaps without clipping initial/final phonemes.
   */
  static trimSilence(samples: Float32Array, sampleRate = 24000, threshold = 0.005): Float32Array {
    let start = 0;
    while (start < samples.length && Math.abs(samples[start]) < threshold) {
      start++;
    }
    let end = samples.length - 1;
    while (end > start && Math.abs(samples[end]) < threshold) {
      end--;
    }
    // Retain a 40ms cushion for smooth, click-free audio transitions
    const cushion = Math.round(sampleRate * 0.04);
    const realStart = Math.max(0, start - cushion);
    const realEnd = Math.min(samples.length - 1, end + cushion);
    return samples.subarray(realStart, realEnd + 1);
  }

  /**
   * Encodes float32 PCM samples into a standard 16-bit 24kHz mono PCM WAV Buffer.
   */
  static encodeWav(floatSamples: Float32Array, sampleRate = 24000): Buffer {
    const numSamples = floatSamples.length;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = 1 * bytesPerSample; // mono
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF identifier
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // 'fmt ' chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size for PCM
    buffer.writeUInt16LE(1, 20);  // AudioFormat: 1 = PCM
    buffer.writeUInt16LE(1, 22);  // NumChannels: 1 = mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34); // BitsPerSample: 16

    // 'data' chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Write 16-bit PCM samples
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1.0, Math.min(1.0, floatSamples[i]));
      const intSample = s < 0 ? Math.floor(s * 32768) : Math.floor(s * 32767);
      buffer.writeInt16LE(intSample, offset);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Splits long narration text into natural sentence batches that fit comfortably within
   * Kokoro's 510-token context window. Normal short preview sentences (<= 350 characters)
   * are synthesized as a single coherent pass to prevent artificial pauses.
   */
  static splitIntoSentences(text: string): string[] {
    const cleaned = text.trim();
    if (!cleaned) return [];
    if (cleaned.length <= 350) return [cleaned];

    const rawChunks = cleaned.match(/[^.!?\n]+[.!?\n]*/g) || [cleaned];
    const results: string[] = [];
    let current = '';

    for (const chunk of rawChunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      if (current && current.length + trimmed.length > 300) {
        results.push(current.trim());
        current = trimmed;
      } else {
        current = current ? `${current} ${trimmed}` : trimmed;
      }
    }
    if (current.trim()) {
      results.push(current.trim());
    }
    return results.length > 0 ? results : [cleaned];
  }

  /**
   * Synthesizes text to speech using genuine Kokoro-82M v1.0 ONNX model.
   */
  async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    if (options.signal?.aborted) {
      throw new TtsError('Kokoro synthesis was aborted before start.', 'cancelled', 'kokoro');
    }

    const trimmedText = (options.text || '').trim();
    if (!trimmedText) {
      throw new TtsError('Narration text is empty.', 'invalid_voice', 'kokoro');
    }

    const isAvail = await this.isAvailable();
    if (!isAvail) {
      const reason = this.getUnavailableReason();
      throw new TtsError(`Kokoro TTS unavailable: ${reason}`, 'unavailable', 'kokoro');
    }

    const voiceId = options.voiceId || this.defaultVoiceId;
    const knownVoice = KokoroProvider.VOICES.find((v) => v.id === voiceId);
    if (!knownVoice) {
      throw new TtsError(`Invalid or unsupported Kokoro voice ID: '${voiceId}'.`, 'invalid_voice', 'kokoro');
    }

    const session = await KokoroProvider.getInferenceSession();

    if (options.signal?.aborted) {
      throw new TtsError('Kokoro synthesis was aborted.', 'cancelled', 'kokoro');
    }

    try {
      const speed = options.speed && options.speed >= 0.5 && options.speed <= 2.0 ? options.speed : 1.0;
      const sentences = KokoroProvider.splitIntoSentences(trimmedText);
      const audioChunks: Float32Array[] = [];

      for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
        if (options.signal?.aborted) {
          throw new TtsError('Kokoro synthesis was aborted.', 'cancelled', 'kokoro');
        }

        const sentence = sentences[sIdx];
        const tokens = await KokoroProvider.tokenizeText(sentence, voiceId);
        const style = KokoroProvider.getVoiceStyleVector(voiceId, tokens.length);

        let chunkSamples: Float32Array;

        if (KokoroProvider.testInferenceSession && typeof KokoroProvider.testInferenceSession.run === 'function') {
          const feeds = { input_ids: tokens, tokens, style, speed };
          const results = await KokoroProvider.testInferenceSession.run(feeds);
          if (results?.waveform?.data) {
            chunkSamples = results.waveform.data;
          } else if (results?.audio?.data) {
            chunkSamples = results.audio.data;
          } else {
            const numSamples = Math.max(24000, Math.round(tokens.length * 1200));
            chunkSamples = new Float32Array(numSamples);
            for (let i = 0; i < numSamples; i++) {
              chunkSamples[i] = Math.sin((2 * Math.PI * 440 * i) / 24000) * 0.3;
            }
          }
        } else {
          const ort = KokoroProvider.getOrtModule();
          const inputIdsTensor = new ort.Tensor(
            'int64',
            BigInt64Array.from(tokens.map(BigInt)),
            [1, tokens.length]
          );
          const styleTensor = new ort.Tensor('float32', style, [1, 256]);
          const speedTensor = new ort.Tensor('float32', new Float32Array([speed]), [1]);

          const feeds: Record<string, any> = {
            input_ids: inputIdsTensor,
            style: styleTensor,
            speed: speedTensor,
          };

          const results = await session.run(feeds);
          const output = results.waveform || results.audio || results[Object.keys(results)[0]];
          if (!output || !output.data) {
            throw new Error('ONNX inference did not produce an audio output tensor.');
          }
          chunkSamples = output.data as Float32Array;
        }

        // Trim leading and trailing neural silence from this chunk
        const trimmedChunk = KokoroProvider.trimSilence(chunkSamples);
        audioChunks.push(trimmedChunk);
      }

      // Merge chunks into single continuous audio sample array without artificial pauses
      let totalLength = 0;
      for (const c of audioChunks) totalLength += c.length;
      const combinedSamples = new Float32Array(totalLength);
      let offset = 0;
      for (const c of audioChunks) {
        combinedSamples.set(c, offset);
        offset += c.length;
      }

      if (options.signal?.aborted) {
        throw new TtsError('Kokoro synthesis was aborted during generation.', 'cancelled', 'kokoro');
      }

      // Encode float samples to 16-bit 24kHz WAV
      const audioBuffer = KokoroProvider.encodeWav(combinedSamples, 24000);
      const durationSeconds = Math.max(0.5, Math.round((combinedSamples.length / 24000) * 100) / 100);

      if (options.outputPath) {
        const dir = path.dirname(options.outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(options.outputPath, audioBuffer);
      }

      return {
        audioBuffer,
        outputPath: options.outputPath,
        sizeBytes: audioBuffer.length,
        durationSeconds,
        format: 'wav',
        providerUsed: 'kokoro',
      };
    } catch (err: any) {
      throw classifyTtsError(err, 'kokoro');
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const isAvail = await this.isAvailable();
    if (!isAvail) {
      return { success: false, message: this.getUnavailableReason() || 'Kokoro runtime or models missing.' };
    }
    await KokoroProvider.getInferenceSession();
    return { success: true, message: 'Kokoro ONNX local runtime is ready.' };
  }
}

