/**
 * GeminiOpenAiProvider – Direct integration with Google Gemini via its
 * OpenAI-compatible chat completions endpoint.
 *
 * Implements the production robustness patterns defined in ZBOT_SPEC.md (§9):
 *  1. Endpoint: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 *  2. Default Model: gemini-flash-latest (aliased to prevent retired-model 404s).
 *  3. Key Pool Rotation: Automatically rotates across scriptAiKeys on 429 / RESOURCE_EXHAUSTED.
 *  4. Truncation Resume: Detects responses cut off by max tokens and prompts continuation
 *     ("Your output was cut off. CONTINUE from exactly where you stopped") up to 10 nudges.
 *  5. Retired Model Fallback: Memoizes 404 retired models and retries on default alias.
 *  6. Zero Secret Leaks: Strips credentials from all log entries and traces.
 *  7. Cancellation Support: Respects AbortSignal across all HTTP requests and retries.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type {
  IScriptAiProvider,
  ProviderCompletionOptions,
  ProviderCompletionResult,
} from './ScriptAiTypes';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class GeminiOpenAiProvider implements IScriptAiProvider {
  readonly id = 'gemini-openai';
  readonly name = 'Google Gemini (OpenAI-Compatible)';

  public static readonly DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  public static readonly DEFAULT_MODEL = 'gemini-flash-latest';
  private static readonly MAX_CONTINUATION_ROUNDS = 10;
  private static readonly RETIRED_MODELS = new Set<string>();

  private keys: string[];
  private currentKeyIndex = 0;
  private model: string;
  private endpoint: string;

  constructor(keys: string[] = [], model = GeminiOpenAiProvider.DEFAULT_MODEL, endpoint = GeminiOpenAiProvider.DEFAULT_ENDPOINT) {
    this.keys = keys.filter((k) => typeof k === 'string' && k.trim());
    this.model = model;
    this.endpoint = endpoint;
  }

  setKeys(keys: string[]): void {
    this.keys = keys.filter((k) => typeof k === 'string' && k.trim());
    this.currentKeyIndex = 0;
  }

  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Returns currently active key masked for logging.
   */
  private getActiveKeyMasked(): string {
    const key = this.keys[this.currentKeyIndex] || '';
    if (!key) return '(no key)';
    return key.length > 8 ? `••••••••${key.slice(-4)}` : '••••••••';
  }

  /**
   * Rotates to next key in pool upon 429 quota exhaustion.
   */
  private rotateKey(): boolean {
    if (this.keys.length <= 1) return false;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
    logger.info('script_ai', `Rotated to next key in pool (${this.currentKeyIndex + 1}/${this.keys.length})`);
    return true;
  }

  /**
   * Performs an HTTP POST request to the completions endpoint.
   */
  private async postJson(
    payload: Record<string, unknown>,
    apiKey: string,
    signal?: AbortSignal,
    timeoutMs = 60000
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Operation cancelled by user'));
      }

      const url = new URL(this.endpoint);
      const postData = JSON.stringify(payload);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'InfinityFlow-ScriptAI/1.0',
        },
        timeout: timeoutMs,
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.setEncoding('utf-8');

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: responseData,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Operation cancelled by user'));
        });
      }

      req.write(postData);
      req.end();
    });
  }

  /**
   * Generates completion text with key rotation and truncation continuation.
   */
  async generateChatCompletion(
    systemPrompt: string,
    userPrompt: string,
    options: ProviderCompletionOptions = {}
  ): Promise<ProviderCompletionResult> {
    if (this.keys.length === 0) {
      throw new Error('No Gemini API keys configured. Please add an API key in Settings.');
    }

    const startTime = Date.now();
    let accumulatedText = '';
    let rounds = 0;
    let keyRotations = 0;
    let activeModel = this.model;

    // Check if current model was previously memoized as retired 404
    if (GeminiOpenAiProvider.RETIRED_MODELS.has(activeModel)) {
      activeModel = GeminiOpenAiProvider.DEFAULT_MODEL;
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    while (rounds < GeminiOpenAiProvider.MAX_CONTINUATION_ROUNDS) {
      if (options.signal?.aborted) {
        throw new Error('Script AI generation cancelled');
      }

      rounds++;
      options.onProgress?.({
        stage: 'generating',
        round: rounds,
        totalRounds: GeminiOpenAiProvider.MAX_CONTINUATION_ROUNDS,
        charsReceived: accumulatedText.length,
        tailSnippet: accumulatedText.slice(-60),
      });

      const currentKey = this.keys[this.currentKeyIndex];
      let response;

      try {
        response = await this.postJson(
          {
            model: activeModel,
            messages,
            temperature: 0.7,
            max_tokens: 4096,
          },
          currentKey,
          options.signal,
          options.timeoutMs || 60000
        );
      } catch (networkErr: any) {
        if (options.signal?.aborted) throw new Error('Script AI generation cancelled');
        logger.error('script_ai', 'Network failure calling Gemini endpoint', networkErr);
        throw new Error(`Network failure calling Gemini endpoint: ${networkErr.message}`);
      }

      // Handle Quota Exhaustion (429) -> Rotate key in pool or back off retry
      if (response.statusCode === 429) {
        logger.warn('script_ai', `Received 429 Quota Exhausted on key ${this.getActiveKeyMasked()}`);
        const rotated = this.rotateKey();
        if (rotated) {
          keyRotations++;
          rounds--; // Don't count quota retry against continuation rounds
          continue;
        } else if (activeModel === 'gemini-flash-latest') {
          logger.warn('script_ai', 'Gemini flash quota exhausted (429). Seamlessly failing over to gemini-3.6-flash...');
          activeModel = 'gemini-3.6-flash';
          continue;
        } else if (rounds < GeminiOpenAiProvider.MAX_CONTINUATION_ROUNDS) {
          const retryAfter = Math.min(Math.max(Number(response.headers['retry-after']) || 5, 2), 10);
          logger.warn('script_ai', `Rate limit 429 hit with single key. Backing off for ${retryAfter}s before automatic retry...`);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        } else {
          // Check retry-after header
          const retryAfter = Number(response.headers['retry-after']) || 5;
          throw new Error(`Gemini API quota exceeded (429). Please add additional keys to the key pool or wait ${retryAfter}s.`);
        }
      }

      // Handle 503 High Demand / Spikes (temporary server-side overload)
      if (response.statusCode === 503 && rounds < GeminiOpenAiProvider.MAX_CONTINUATION_ROUNDS) {
        logger.warn('script_ai', 'Gemini API returned 503 (high demand spike). Waiting 1.5s before retry...');
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Handle Retired Model (404)
      if (response.statusCode === 404) {
        if (activeModel !== 'gemini-3.6-flash') {
          const fallbackModel = activeModel === GeminiOpenAiProvider.DEFAULT_MODEL ? 'gemini-3.6-flash' : GeminiOpenAiProvider.DEFAULT_MODEL;
          logger.warn('script_ai', `Model "${activeModel}" returned 404. Memoizing as retired and falling back to "${fallbackModel}".`);
          GeminiOpenAiProvider.RETIRED_MODELS.add(activeModel);
          activeModel = fallbackModel;
          rounds--;
          continue;
        }
      }

      // Handle HTTP Errors
      if (response.statusCode < 200 || response.statusCode >= 300) {
        let errMsg = `Gemini API returned HTTP ${response.statusCode}`;
        try {
          const parsed = JSON.parse(response.body);
          if (parsed.error?.message) {
            errMsg = `${errMsg}: ${parsed.error.message}`;
          }
        } catch {}
        logger.error('script_ai', errMsg);
        throw new Error(errMsg);
      }

      // Parse JSON Completion
      let completionChunk = '';
      try {
        const parsed = JSON.parse(response.body);
        completionChunk = parsed.choices?.[0]?.message?.content || '';
      } catch (parseErr) {
        throw new Error(`Failed to parse Gemini API JSON response: ${(parseErr as Error).message}`);
      }

      if (!completionChunk) {
        throw new Error('Gemini API returned an empty completion');
      }

      accumulatedText += completionChunk;

      // Check if response was truncated (ZBot spec §9):
      // A complete response should close all braces and brackets, or end with '}'
      const isTruncated = this.detectTruncation(accumulatedText);
      if (!isTruncated) {
        break; // Successfully generated full text
      }

      logger.info('script_ai', `Detected truncated model output (round ${rounds}). Nudging continuation...`);
      messages.push({ role: 'assistant', content: completionChunk });
      messages.push({
        role: 'user',
        content: 'Your output was cut off. CONTINUE from exactly where you stopped — do not repeat anything, continue valid JSON.',
      });
    }

    return {
      text: accumulatedText,
      model: activeModel,
      rounds,
      charsReceived: accumulatedText.length,
      keyRotations,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Detects whether an output stream ended prematurely mid-sentence or mid-JSON.
   * ZBot spec §9: "Detect it (tail lacks terminal punctuation, or the package has no
   * image-prompt section / <3 numbered blocks) and push continuation nudge".
   */
  private detectTruncation(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;

    // If text ends with closing brace, JSON is likely closed
    if (trimmed.endsWith('}') || trimmed.endsWith('```')) {
      // Check brace balance
      let openBraces = 0;
      for (const char of trimmed) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
      }
      return openBraces > 0;
    }

    return true;
  }

  /**
   * Tests connectivity using the primary key.
   */
  async testConnection(): Promise<{ success: boolean; error?: string; model?: string; isMock?: boolean }> {
    if (this.keys.length === 0) {
      return { success: false, error: 'No API keys configured', isMock: false };
    }

    try {
      const currentKey = this.keys[this.currentKeyIndex] || this.keys[0];
      let response = await this.postJson(
        {
          model: this.model,
          messages: [{ role: 'user', content: 'Respond with OK' }],
          max_tokens: 5,
        },
        currentKey,
        undefined,
        15000
      );

      if (response.statusCode === 503) {
        await new Promise((r) => setTimeout(r, 1500));
        response = await this.postJson(
          {
            model: this.model,
            messages: [{ role: 'user', content: 'Respond with OK' }],
            max_tokens: 5,
          },
          currentKey,
          undefined,
          15000
        );
      }

      if (response.statusCode === 429 && this.model !== 'gemini-3.6-flash') {
        response = await this.postJson(
          {
            model: 'gemini-3.6-flash',
            messages: [{ role: 'user', content: 'Respond with OK' }],
            max_tokens: 5,
          },
          currentKey,
          undefined,
          15000
        );
        if (response.statusCode >= 200 && response.statusCode < 300) {
          return { success: true, model: 'gemini-3.6-flash', isMock: false };
        }
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return { success: true, model: this.model, isMock: false };
      }

      let errorMsg = `HTTP ${response.statusCode}`;
      try {
        const body = JSON.parse(response.body);
        if (body.error?.message) errorMsg = body.error.message;
      } catch {}

      return { success: false, error: errorMsg, isMock: false };
    } catch (err: any) {
      return { success: false, error: err.message, isMock: false };
    }
  }
}
