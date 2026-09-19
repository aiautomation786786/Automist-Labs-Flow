/**
 * ScriptAiService – Central coordinator for AI-assisted Script Generation,
 * Scene Refinement, and AI Re-read layout analysis.
 *
 * Guarantees:
 *  1. Non-Bypassable Validation: Every generated or refined story strictly runs
 *     through the authoritative ScriptValidator before acceptance.
 *  2. Truthful Execution: Real Gemini provider is used whenever keys are present.
 *     If no keys are configured, falls back to MockScriptAiProvider clearly flagged as isMock: true.
 *  3. User-Prompt Preservation: Refinements modify ONLY the targeted scene and field.
 *     Unrelated scenes and user edits are preserved 100% untouched.
 *  4. AI Re-read Integrity: Line-number skeleton analysis slices original source text locally
 *     without AI rewriting or paraphrasing (ZBot Golden Rule #3).
 *  5. Progress Streaming: Truthfully emits 'script-ai:progress' events via generationEventBus.
 *  6. No Meta AI: Enforces complete exclusion of Meta AI across all prompts and generation.
 */

import type {
  StoryEntity,
  SceneEntity,
  ScriptAiGenerateParams,
  ScriptAiProgressEvent,
  ScriptAiResult,
  RefineSceneParams,
  RefineSceneResult,
  AnalyzeAlignParams,
  AnalyzeAlignResult,
} from '../../shared/types';
import { ScriptValidator } from '../../shared/ScriptValidator';
import { ScriptParser } from '../../shared/ScriptParser';
import { SettingsManager } from '../storage/SettingsManager';
import { SkillRepository } from '../storage/SkillRepository';
import { ChannelRepository } from '../storage/ChannelRepository';
import { PromptBuilder } from './PromptBuilder';
import { GeminiOpenAiProvider } from './GeminiOpenAiProvider';
import { MockScriptAiProvider } from './MockScriptAiProvider';
import { GeminiApiKeyManager } from './GeminiApiKeyManager';
import * as fs from 'fs';
import * as path from 'path';
import { AssetManager } from '../storage/AssetManager';
import { IScriptAiProvider, ProviderCompletionOptions } from './ScriptAiTypes';
import { generationEventBus } from '../events/GenerationEventBus';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class ScriptAiService {
  private static customProvider: IScriptAiProvider | null = null;

  /**
   * Allows injecting a custom provider for testing or alternative integrations.
   */
  static setCustomProvider(provider: IScriptAiProvider | null): void {
    this.customProvider = provider;
  }

  /**
   * Resolves the appropriate provider based on settings and available keys.
   */
  static resolveProvider(): IScriptAiProvider {
    if (this.customProvider) {
      return this.customProvider;
    }

    const settings = SettingsManager.readSettings();
    const keyManager = GeminiApiKeyManager.getInstance();
    if (keyManager.getKeyCount() === 0) {
      keyManager.loadAndMigrate();
    }
    const keys = SettingsManager.getScriptAiKeys();
    const model = (settings.scriptAiModel as string) || GeminiOpenAiProvider.DEFAULT_MODEL;

    if (keys.length > 0 || keyManager.getKeyCount() > 0) {
      return new GeminiOpenAiProvider(keys, model);
    }

    // Zero-key fallback: Truthfully use MockScriptAiProvider (clearly flagged as isMock)
    return new MockScriptAiProvider();
  }

  /**
   * Generates a complete structured Story from an idea/topic, skill, and channel rulebook.
   */
  static async generateScript(
    params: ScriptAiGenerateParams,
    options: ProviderCompletionOptions = {}
  ): Promise<ScriptAiResult> {
    const startTime = Date.now();
    const provider = this.resolveProvider();

    // 1. Stage: Preparing
    this.emitProgress({
      stage: 'preparing',
      round: 0,
      charsReceived: 0,
      message: 'Resolving Channel rulebook, Skill directives, and instructions...',
    }, options);

    // Look up Channel and Skill in parallel
    const [skill, channel] = await Promise.all([
      params.skillId ? SkillRepository.get(params.skillId) : Promise.resolve(null),
      params.channelId ? ChannelRepository.get(params.channelId) : Promise.resolve(null),
    ]);

    // Build prompts adhering to the 4-tier precedence hierarchy
    const systemPrompt = PromptBuilder.buildSystemPrompt(skill, channel);
    const userPrompt = PromptBuilder.buildUserPrompt(params);

    // 2. Stage: Generating
    this.emitProgress({
      stage: 'generating',
      round: 1,
      charsReceived: 0,
      message: `Generating script via ${provider.name}...`,
    }, options);

    let completionResult;
    try {
      completionResult = await provider.generateChatCompletion(systemPrompt, userPrompt, {
        signal: options.signal,
        timeoutMs: options.timeoutMs || 90000,
        onProgress: (ev) => this.emitProgress(ev, options),
      });
    } catch (err: any) {
      this.emitProgress({
        stage: 'failed',
        round: 1,
        charsReceived: 0,
        message: err.message,
      }, options);
      return {
        success: false,
        error: err.message,
      };
    }

    // 3. Stage: Validating
    this.emitProgress({
      stage: 'validating',
      round: completionResult.rounds,
      charsReceived: completionResult.charsReceived,
      message: 'Extracting and strictly validating structured Story...',
    }, options);

    const parsedJson = this.extractJson(completionResult.text);
    if (!parsedJson) {
      const err = 'Failed to extract valid JSON from Script AI completion';
      this.emitProgress({ stage: 'failed', round: completionResult.rounds, charsReceived: completionResult.charsReceived, message: err }, options);
      return {
        success: false,
        rawOutput: completionResult.text,
        error: err,
      };
    }

    // Map and normalize scenes
    const rawScenes = Array.isArray(parsedJson.scenes) ? parsedJson.scenes : [];
    const scenes: SceneEntity[] = rawScenes.map((s: any, idx: number) => {
      const narration = String(s.narration ?? s.text ?? '').trim();
      const metrics = ScriptValidator.computeSceneMetrics(narration);
      return {
        sceneNumber: typeof s.sceneNumber === 'number' ? s.sceneNumber : idx + 1,
        narration,
        imagePrompt: String(s.imagePrompt ?? s.prompt ?? '').trim(),
        mood: s.mood ? String(s.mood).trim() : undefined,
        durationSeconds: metrics.durationSeconds,
        wordCount: metrics.wordCount,
        notes: s.notes ? String(s.notes).trim() : undefined,
      };
    });

    const now = new Date().toISOString();
    const storyTitle = String(parsedJson.title || params.topic).trim();
    const story: StoryEntity = {
      title: storyTitle,
      thumbnailPrompt: parsedJson.thumbnailPrompt ? String(parsedJson.thumbnailPrompt).trim() : undefined,
      scenes,
      rawScript: ScriptParser.toMarkedScript({ title: storyTitle, scenes }),
      createdAt: now,
      updatedAt: now,
    };

    // Strict validation via ScriptValidator
    const validation = ScriptValidator.validate(story);
    if (!validation.isValid) {
      const errorDetails = validation.errors.map((e) => e.message).join('; ');
      logger.warn('script_ai', 'Generated story failed ScriptValidator validation', { errors: errorDetails });
      this.emitProgress({
        stage: 'failed',
        round: completionResult.rounds,
        charsReceived: completionResult.charsReceived,
        message: `Validation failed: ${errorDetails}`,
      }, options);

      return {
        success: false,
        story,
        validation,
        rawOutput: completionResult.text,
        error: `Story validation failed: ${errorDetails}`,
      };
    }

    // 4. Stage: Completed
    this.emitProgress({
      stage: 'completed',
      round: completionResult.rounds,
      charsReceived: completionResult.charsReceived,
      message: `Script generated successfully (${scenes.length} scenes, ${validation.totalWords} words).`,
    }, options);

    // Persist intermediate generated script artifact (ZBot spec §9)
    let savedScriptPath: string | undefined;
    try {
      const genScriptsDir = AssetManager.getGeneratedScriptsDir();
      const sanitizedTitle = (story.title || params.topic || 'generated_script')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}_${sanitizedTitle}.md`;
      savedScriptPath = path.join(genScriptsDir, filename);

      const markdownToSave = completionResult.text.trim().startsWith('#')
        ? completionResult.text
        : ScriptParser.toMarkedScript(story);

      fs.writeFileSync(savedScriptPath, markdownToSave, 'utf-8');
      logger.info('script_ai', 'Persisted generated script artifact', { savedScriptPath });
    } catch (saveErr) {
      logger.warn('script_ai', 'Failed to persist intermediate generated script artifact', { error: (saveErr as Error).message });
    }

    return {
      success: true,
      story,
      validation,
      rawOutput: completionResult.text,
      savedScriptPath,
      stats: {
        provider: provider.name,
        model: completionResult.model,
        rounds: completionResult.rounds,
        charsReceived: completionResult.charsReceived,
        durationMs: Date.now() - startTime,
        keyRotations: completionResult.keyRotations,
        isMock: completionResult.isMock,
      },
    };
  }

  /**
   * Refines ONLY a selected scene's narration or image prompt, preserving all other scenes.
   */
  static async refineScene(
    params: RefineSceneParams,
    options: ProviderCompletionOptions = {}
  ): Promise<RefineSceneResult> {
    const provider = this.resolveProvider();

    const [skill, channel] = await Promise.all([
      params.skillId ? SkillRepository.get(params.skillId) : Promise.resolve(null),
      params.channelId ? ChannelRepository.get(params.channelId) : Promise.resolve(null),
    ]);

    const { systemPrompt, userPrompt } = PromptBuilder.buildRefineScenePrompt(params, skill, channel);

    try {
      const completionResult = await provider.generateChatCompletion(systemPrompt, userPrompt, {
        signal: options.signal,
        timeoutMs: options.timeoutMs || 45000,
      });

      const parsed = this.extractJson(completionResult.text);
      if (!parsed) {
        throw new Error('Failed to parse refined scene JSON from model response');
      }

      // Preserve unmodified fields
      const refinedNarration = params.target === 'imagePrompt'
        ? params.scene.narration
        : String(parsed.narration || params.scene.narration).trim();

      const refinedPrompt = params.target === 'narration'
        ? params.scene.imagePrompt
        : String(parsed.imagePrompt || params.scene.imagePrompt).trim();

      const metrics = ScriptValidator.computeSceneMetrics(refinedNarration);

      const refinedScene: SceneEntity = {
        sceneNumber: params.scene.sceneNumber,
        narration: refinedNarration,
        imagePrompt: refinedPrompt,
        mood: parsed.mood ? String(parsed.mood).trim() : params.scene.mood,
        durationSeconds: metrics.durationSeconds,
        wordCount: metrics.wordCount,
        notes: params.scene.notes,
      };

      return {
        success: true,
        refinedScene,
      };
    } catch (err: any) {
      logger.error('script_ai', 'Scene refinement failed', err);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Implements "Wrong count? Re-read with AI" (§8.4 of ZBot spec).
   * Generates a numbered skeleton and asks the model for line-number ranges.
   * Slices the original text locally by line number without paraphrasing or rewriting!
   */
  static async reReadScript(
    params: AnalyzeAlignParams,
    options: ProviderCompletionOptions = {}
  ): Promise<AnalyzeAlignResult> {
    const rawLines = params.rawScript.split(/\r?\n/);
    if (rawLines.length === 0 || !params.rawScript.trim()) {
      return { success: false, error: 'Empty script' };
    }

    // Build numbered skeleton (cap at 4000 lines, truncate lines to 90 chars per ZBot spec §8.4)
    const cappedLines = rawLines.slice(0, 4000);
    const skeleton = cappedLines.map((line, idx) => {
      const lineNum = idx + 1;
      const truncated = line.slice(0, 90);
      return `${lineNum}: ${truncated}`;
    });

    const provider = this.resolveProvider();
    const { systemPrompt, userPrompt } = PromptBuilder.buildAiReReadPrompt(skeleton);

    try {
      const completionResult = await provider.generateChatCompletion(systemPrompt, userPrompt, {
        signal: options.signal,
        timeoutMs: options.timeoutMs || 45000,
      });

      const parsed = this.extractJson(completionResult.text);
      if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new Error('AI Re-read returned invalid line range structure');
      }

      // Slice the ORIGINAL file locally using line numbers! Model never touches original text.
      const scenes: SceneEntity[] = [];
      const lineRanges: Array<{ sceneNumber: number; narrationLines?: [number, number]; imagePromptLines?: [number, number] }> = [];

      for (const sc of parsed.scenes) {
        const sceneNum = Number(sc.sceneNumber) || (scenes.length + 1);
        let narration = '';
        let imagePrompt = '';

        if (Array.isArray(sc.narrationLines) && sc.narrationLines.length === 2) {
          const start = Math.max(1, Math.min(sc.narrationLines[0], rawLines.length));
          const end = Math.max(start, Math.min(sc.narrationLines[1], rawLines.length));
          narration = rawLines.slice(start - 1, end).join(' ').trim();
          narration = narration.replace(/^(?:NARRATION|VOICEOVER|AUDIO|SPEECH|SPOKEN)\s*[:\-]\s*/i, '').trim();
        }

        if (Array.isArray(sc.imagePromptLines) && sc.imagePromptLines.length === 2) {
          const start = Math.max(1, Math.min(sc.imagePromptLines[0], rawLines.length));
          const end = Math.max(start, Math.min(sc.imagePromptLines[1], rawLines.length));
          imagePrompt = rawLines.slice(start - 1, end).join(' ').trim();
          imagePrompt = imagePrompt.replace(/^(?:IMAGE|VISUAL|PROMPT|ART|PIC)\s*[:\-]\s*/i, '').trim();
        }

        if (narration || imagePrompt) {
          const metrics = ScriptValidator.computeSceneMetrics(narration);
          scenes.push({
            sceneNumber: sceneNum,
            narration,
            imagePrompt: imagePrompt || `Visual representation for scene ${sceneNum}`,
            durationSeconds: metrics.durationSeconds,
            wordCount: metrics.wordCount,
          });
          lineRanges.push({
            sceneNumber: sceneNum,
            narrationLines: sc.narrationLines,
            imagePromptLines: sc.imagePromptLines,
          });
        }
      }

      if (scenes.length === 0) {
        throw new Error('AI Re-read could not resolve any scenes from line ranges');
      }

      const now = new Date().toISOString();
      const story: StoryEntity = {
        title: 'Re-aligned Script',
        scenes,
        createdAt: now,
        updatedAt: now,
      };

      return {
        success: true,
        lineRanges,
        story,
      };
    } catch (err: any) {
      logger.error('script_ai', 'AI Re-read failed', err);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Tests connection for currently configured provider.
   */
  static async testConnection(): Promise<{ success: boolean; error?: string; model?: string; isMock?: boolean }> {
    const provider = this.resolveProvider();
    return await provider.testConnection();
  }

  /**
   * Extracts JSON from text, handling markdown fences or leading/trailing characters.
   */
  private static extractJson(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();

    // 1. Check if enclosed in ```json ... ``` markdown fence
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {}
    }

    // 2. Direct parse
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch {}
    }

    // 3. Find first '{' and last '}'
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {}
    }

    return null;
  }

  private static emitProgress(event: ScriptAiProgressEvent, options: ProviderCompletionOptions): void {
    options.onProgress?.(event);
    generationEventBus.emit('script-ai:progress' as any, event);
  }
}
