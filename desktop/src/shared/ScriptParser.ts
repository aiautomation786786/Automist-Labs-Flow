/**
 * ScriptParser – Deterministic, multi-layout script parser for Infinity Flow Video Factory.
 *
 * Implements the layout parsing and narration distribution algorithms defined in ZBOT_SPEC.md (§8):
 *  1. Marked single files (## SCENE 1, NARRATION:, IMAGE:, MOOD:, TITLE:, THUMBNAIL:)
 *  2. Asset-block prompt files (IMG 1, ASSET 1, PROMPT 1, IMAGE 1)
 *  3. Sectioned packages (=== NARRATION === and === IMAGE PROMPTS ===)
 *  4. JSON story ({ title, scenes[] })
 *  5. Plain multiline / paragraph text
 *
 * Guarantees:
 *  - Scene count strictly originates from image prompt count (ZBot Golden Rule #2).
 *  - User prompt text is NEVER rewritten, summarized, or altered (100% verbatim).
 *  - Narration distribution: merges smallest adjacent sentence pairs when sentences >= scenes;
 *    splits by even word count when sentences < scenes.
 *  - Calculates word counts and speech duration estimates for every scene.
 */

import type { SceneEntity, ScriptParseResult, StoryEntity, SeparateFilesInput } from './types';
import { ScriptValidator } from './ScriptValidator';

export class ScriptParser {
  /**
   * Parses raw script text into structured scenes, warnings, and metadata.
   */
  static parse(rawText: string): ScriptParseResult {
    if (!rawText || !rawText.trim()) {
      return {
        scenes: [],
        warnings: ['Script text is empty.'],
        layoutDetected: 'empty',
      };
    }

    const trimmed = rawText.trim();

    // -----------------------------------------------------------------------
    // Layout 4: JSON Story format
    // -----------------------------------------------------------------------
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const json = JSON.parse(trimmed);
        if (Array.isArray(json.scenes) && json.scenes.length > 0) {
          const scenes: SceneEntity[] = json.scenes.map((s: any, idx: number) => {
            const narration = String(s.narration ?? s.text ?? '').trim();
            const metrics = ScriptValidator.computeSceneMetrics(narration);
            return {
              sceneNumber: typeof s.sceneNumber === 'number' ? s.sceneNumber : idx + 1,
              narration,
              imagePrompt: String(s.imagePrompt ?? s.prompt ?? s.image ?? '').trim(),
              mood: s.mood ? String(s.mood).trim() : undefined,
              durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : metrics.durationSeconds,
              wordCount: typeof s.wordCount === 'number' ? s.wordCount : metrics.wordCount,
              notes: s.notes ? String(s.notes).trim() : undefined,
            };
          });

          return {
            title: json.title ? String(json.title).trim() : undefined,
            thumbnailPrompt: json.thumbnailPrompt ? String(json.thumbnailPrompt).trim() : undefined,
            scenes,
            warnings: [],
            layoutDetected: 'json_story',
          };
        }
      } catch {
        // Not valid JSON, continue with text layouts
      }
    }

    // -----------------------------------------------------------------------
    // Extract Title & Thumbnail before layout-specific parsing
    // -----------------------------------------------------------------------
    let title: string | undefined;
    let thumbnailPrompt: string | undefined;
    const warnings: string[] = [];

    // Title matchers (e.g. TITLE: My Great Video or # My Great Video)
    const titleMatch = trimmed.match(/^(?:#\s+|TITLE:\s*)([^\r\n]+)/im);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
    }

    // Thumbnail matchers (e.g. THUMBNAIL: A glowing sunset...)
    const thumbMatch = trimmed.match(/(?:THUMBNAIL|THUMBNAIL PROMPT):\s*([^\r\n]+(?:\r?\n(?!(?:SCENE|SHOT|PART|SECTION|##|===))[^\r\n]+)*)/i);
    if (thumbMatch && thumbMatch[1]) {
      thumbnailPrompt = thumbMatch[1].trim();
    }

    // -----------------------------------------------------------------------
    // Layout 1: Marked Scenes (## SCENE n or SCENE n: or [SCENE n])
    // -----------------------------------------------------------------------
    const sceneSplitRegex = /(?:^|\n)(?:##+\s*(?:SCENE|SHOT|PART|SECTION)\s*\d+|\[(?:SCENE|SHOT|PART|SECTION)\s*\d+\]|(?:SCENE|SHOT|PART|SECTION)\s+\d+[:\-\s])/i;

    if (sceneSplitRegex.test(trimmed)) {
      const parsedScenes = this.parseMarkedScenes(trimmed);
      if (parsedScenes.length > 0) {
        return {
          title,
          thumbnailPrompt,
          scenes: parsedScenes,
          warnings,
          layoutDetected: 'marked_scenes',
        };
      }
    }

    // -----------------------------------------------------------------------
    // Layout 2: Asset-Block Prompt Files (IMG 1, ASSET 1, PROMPT 1, IMAGE 1)
    // -----------------------------------------------------------------------
    const assetBlockRegex = /(?:^|\n)(?:IMG|ASSET|IMAGE|PROMPT|VISUAL|PIC)\s*\d+[:\-\s|]/i;
    if (assetBlockRegex.test(trimmed)) {
      const parsedScenes = this.parseAssetBlocks(trimmed);
      if (parsedScenes.length > 0) {
        return {
          title,
          thumbnailPrompt,
          scenes: parsedScenes,
          warnings,
          layoutDetected: 'asset_blocks',
        };
      }
    }

    // -----------------------------------------------------------------------
    // Layout 3: Sectioned Package (=== NARRATION === and === PROMPTS ===)
    // -----------------------------------------------------------------------
    if (/===\s*(?:NARRATION|SCRIPT|AUDIO)/i.test(trimmed) && /===\s*(?:IMAGE|PROMPT|VISUAL)/i.test(trimmed)) {
      const parsedScenes = this.parseSectionedPackage(trimmed);
      if (parsedScenes.length > 0) {
        return {
          title,
          thumbnailPrompt,
          scenes: parsedScenes,
          warnings,
          layoutDetected: 'sectioned_package',
        };
      }
    }

    // -----------------------------------------------------------------------
    // Layout 5: Plain Multiline / Paragraph Fallback
    // -----------------------------------------------------------------------
    const fallbackScenes = this.parseParagraphs(trimmed);
    return {
      title,
      thumbnailPrompt,
      scenes: fallbackScenes,
      warnings: ['No standard scene markers detected. Text parsed by paragraphs.'],
      layoutDetected: 'paragraphs',
    };
  }

  /**
   * Layout 1: Parses marked scene blocks (e.g. ## SCENE 1 ... NARRATION: ... IMAGE: ... MOOD: ...)
   */
  private static parseMarkedScenes(text: string): SceneEntity[] {
    const rawChunks = text.split(/(?:^|\n)(?=##+\s*(?:SCENE|SHOT|PART|SECTION)\s*\d+|\[(?:SCENE|SHOT|PART|SECTION)\s*\d+\]|(?:SCENE|SHOT|PART|SECTION)\s+\d+[:\-\s])/i);
    const scenes: SceneEntity[] = [];

    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i]!.trim();
      if (!chunk) continue;

      // Skip preamble chunks that do not begin with a scene header
      if (!/^(?:##+\s*(?:SCENE|SHOT|PART|SECTION)|\[(?:SCENE|SHOT|PART|SECTION)|(?:SCENE|SHOT|PART|SECTION)\s+\d+)/i.test(chunk)) {
        continue;
      }

      // Extract scene number
      const numMatch = chunk.match(/(?:SCENE|SHOT|PART|SECTION)\s*(\d+)/i);
      const sceneNumber = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : scenes.length + 1;

      // Extract Narration
      let narration = '';
      const narrationMatch = chunk.match(
        /(?:NARRATION|NARRATOR|VOICEOVER|VO|AUDIO|SCRIPT):\s*([^]*?)(?=(?:\r?\n\s*|\s+)(?:IMAGE|IMAGE PROMPT|PROMPT|VISUAL|SHOT|PIC|MOOD|TONE):\s*|(?:\r?\n\s*(?:##|\[(?:SCENE|SHOT|PART|SECTION)))|$)/i
      );
      if (narrationMatch && narrationMatch[1]) {
        narration = narrationMatch[1].trim();
      }

      // Extract Image Prompt (Preserved 100% verbatim)
      let imagePrompt = '';
      const promptMatch = chunk.match(
        /(?:IMAGE|IMAGE PROMPT|PROMPT|VISUAL|PIC):\s*([^]*?)(?=(?:\r?\n\s*|\s+)(?:NARRATION|NARRATOR|VOICEOVER|VO|AUDIO|SCRIPT|MOOD|TONE):\s*|(?:\r?\n\s*(?:##|\[(?:SCENE|SHOT|PART|SECTION)))|$)/i
      );
      if (promptMatch && promptMatch[1]) {
        imagePrompt = promptMatch[1].trim();
      }

      // Extract Mood
      let mood: string | undefined;
      const moodMatch = chunk.match(/(?:MOOD|TONE|ATMOSPHERE):\s*([^\r\n]+)/i);
      if (moodMatch && moodMatch[1]) {
        mood = moodMatch[1].trim();
      }

      // If prompt was not found under tag, inspect the remainder of chunk
      if (!imagePrompt) {
        const lines = chunk.split(/\r?\n/).filter((l) => !l.startsWith('#') && !l.toLowerCase().includes('scene'));
        if (lines.length > 0) {
          imagePrompt = lines.join(' ').trim();
        }
      }

      // Fallback matching if one is missing
      if (!narration && imagePrompt) {
        narration = imagePrompt;
      } else if (!imagePrompt && narration) {
        imagePrompt = narration;
      }

      if (imagePrompt || narration) {
        const metrics = ScriptValidator.computeSceneMetrics(narration);
        scenes.push({
          sceneNumber,
          narration,
          imagePrompt,
          mood,
          durationSeconds: metrics.durationSeconds,
          wordCount: metrics.wordCount,
        });
      }
    }

    return scenes;
  }

  /**
   * Layout 2: Parses asset blocks (IMG 1: prompt, ASSET 2: prompt)
   */
  private static parseAssetBlocks(text: string): SceneEntity[] {
    const rawChunks = text.split(/(?:^|\n)(?=(?:IMG|ASSET|IMAGE|PROMPT|VISUAL|PIC)\s*\d+[:\-\s|])/i);
    const scenes: SceneEntity[] = [];

    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i]!.trim();
      if (!chunk) continue;

      // Skip preamble chunks that do not begin with an asset header
      if (!/^(?:IMG|ASSET|IMAGE|PROMPT|VISUAL|PIC)\s*\d+[:\-\s|]/i.test(chunk)) {
        continue;
      }

      // Extract number
      const numMatch = chunk.match(/(?:IMG|ASSET|IMAGE|PROMPT|VISUAL|PIC)\s*(\d+)/i);
      const sceneNumber = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : scenes.length + 1;

      // Remove header line prefix while preserving prompt content verbatim
      const cleanBody = chunk.replace(/^(?:IMG|ASSET|IMAGE|PROMPT|VISUAL|PIC)\s*\d+[:\-\s|]*/i, '').trim();

      if (cleanBody) {
        const metrics = ScriptValidator.computeSceneMetrics(cleanBody);
        scenes.push({
          sceneNumber,
          narration: cleanBody,
          imagePrompt: cleanBody,
          durationSeconds: metrics.durationSeconds,
          wordCount: metrics.wordCount,
        });
      }
    }

    return scenes;
  }

  /**
   * Layout 3: Sectioned package with separate Narration block and Prompts block
   */
  private static parseSectionedPackage(text: string): SceneEntity[] {
    const narrationSectionMatch = text.match(/===\s*(?:NARRATION|SCRIPT|AUDIO)[^=]*===\s*([^=]*)/i);
    const promptsSectionMatch = text.match(/===\s*(?:IMAGE|PROMPT|VISUAL)[^=]*===\s*([^=]*)/i);

    const narrationBlock = narrationSectionMatch && narrationSectionMatch[1] ? narrationSectionMatch[1].trim() : '';
    const promptsBlock = promptsSectionMatch && promptsSectionMatch[1] ? promptsSectionMatch[1].trim() : '';

    const promptLines = promptsBlock
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('==='));

    if (promptLines.length === 0) {
      return [];
    }

    // Distribute narration across prompt count (ZBot §8.2)
    const distributedNarrations = this.distributeNarration(narrationBlock, promptLines.length);

    return promptLines.map((prompt, idx) => {
      const cleanPrompt = prompt.replace(/^(?:\d+[\.\:\-\s]|IMG\s*\d+[\.\:\-\s])/i, '').trim();
      const narration = distributedNarrations[idx] || cleanPrompt;
      const metrics = ScriptValidator.computeSceneMetrics(narration);
      return {
        sceneNumber: idx + 1,
        imagePrompt: cleanPrompt,
        narration,
        durationSeconds: metrics.durationSeconds,
        wordCount: metrics.wordCount,
      };
    });
  }

  /**
   * Layout 5: Paragraphs fallback
   */
  private static parseParagraphs(text: string): SceneEntity[] {
    const paragraphs = text
      .split(/\r?\n\r?\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith('#'));

    return paragraphs.map((p, idx) => {
      const metrics = ScriptValidator.computeSceneMetrics(p);
      return {
        sceneNumber: idx + 1,
        narration: p,
        imagePrompt: p,
        durationSeconds: metrics.durationSeconds,
        wordCount: metrics.wordCount,
      };
    });
  }

  /**
   * Narration distribution algorithm (ZBot §8.2)
   *
   * Rules:
   * 1. If sentences >= scenes: merge smallest adjacent pairs until counts match.
   * 2. If sentences < scenes: split by even word counts.
   * NEVER use pause/comma splitting.
   */
  static distributeNarration(narrationText: string, sceneCount: number): string[] {
    if (!narrationText || sceneCount <= 0) {
      return Array(sceneCount).fill('');
    }

    if (sceneCount === 1) {
      return [narrationText.trim()];
    }

    // Split into sentences using punctuation boundaries (. ! ?)
    const rawSentences = narrationText
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Case 1: sentences >= scenes -> merge smallest adjacent pairs until counts match
    if (rawSentences.length >= sceneCount) {
      const merged = [...rawSentences];
      while (merged.length > sceneCount) {
        // Find adjacent pair with smallest combined word count
        let minCombinedLen = Infinity;
        let bestIndex = 0;

        for (let i = 0; i < merged.length - 1; i++) {
          const combinedLen = merged[i]!.split(/\s+/).length + merged[i + 1]!.split(/\s+/).length;
          if (combinedLen < minCombinedLen) {
            minCombinedLen = combinedLen;
            bestIndex = i;
          }
        }

        // Merge adjacent pair
        merged[bestIndex] = `${merged[bestIndex]} ${merged[bestIndex + 1]}`;
        merged.splice(bestIndex + 1, 1);
      }
      return merged;
    }

    // Case 2: sentences < scenes -> split by even word counts
    const words = narrationText.split(/\s+/).filter((w) => w.length > 0);
    const wordsPerScene = Math.max(1, Math.floor(words.length / sceneCount));
    const result: string[] = [];

    let currentWordIdx = 0;
    for (let i = 0; i < sceneCount; i++) {
      if (i === sceneCount - 1) {
        // Last scene takes all remaining words
        result.push(words.slice(currentWordIdx).join(' '));
      } else {
        const chunk = words.slice(currentWordIdx, currentWordIdx + wordsPerScene);
        result.push(chunk.join(' '));
        currentWordIdx += wordsPerScene;
      }
    }

    return result;
  }

  /**
   * Bidirectional export: Converts a structured StoryEntity or list of scenes
   * into clean, standardized markdown format.
   */
  static toMarkedScript(story: Partial<StoryEntity> & { scenes: SceneEntity[] }): string {
    const parts: string[] = [];

    if (story.title) {
      parts.push(`# ${story.title.trim()}\n`);
    }

    if (story.thumbnailPrompt) {
      parts.push(`THUMBNAIL: ${story.thumbnailPrompt.trim()}\n`);
    }

    for (const scene of story.scenes) {
      parts.push(`## SCENE ${scene.sceneNumber}`);
      if (scene.mood) {
        parts.push(`MOOD: ${scene.mood.trim()}`);
      }
      if (scene.narration) {
        parts.push(`NARRATION: ${scene.narration.trim()}`);
      }
      if (scene.imagePrompt) {
        parts.push(`IMAGE: ${scene.imagePrompt.trim()}`);
      }
      parts.push(''); // Blank separator line
    }

    return parts.join('\n').trim();
  }

  /**
   * Layout 4: Separate Files (narration + prompts + optional thumbnail).
   *
   * Implements ZBot §8.1 Layout 4 & Golden Rule #2:
   *  - Scene count strictly originates from image prompt count if prompts exist.
   *  - Positional matching: scene i gets narration i and prompt i.
   *  - If narration count != prompt count, distributes narration and emits warning.
   *  - Extra prompts become scenes.
   */
  static parseSeparateFiles(input: SeparateFilesInput): ScriptParseResult {
    const warnings: string[] = [];
    let title = input.title?.trim();
    let thumbnailPrompt = input.thumbnailText?.trim();

    // If title not explicitly provided, search in narration or prompts
    if (!title && input.narrationText) {
      const match = input.narrationText.match(/^(?:#\s+|TITLE:\s*)([^\r\n]+)/im);
      if (match && match[1]) title = match[1].trim();
    }
    if (!title && input.promptsText) {
      const match = input.promptsText.match(/^(?:#\s+|TITLE:\s*)([^\r\n]+)/im);
      if (match && match[1]) title = match[1].trim();
    }

    // If thumbnail not explicitly provided, search in prompts or narration
    if (!thumbnailPrompt && input.promptsText) {
      const match = input.promptsText.match(/(?:THUMBNAIL|THUMBNAIL PROMPT):\s*([^\r\n]+(?:\r?\n(?!(?:SCENE|SHOT|PART|SECTION|##|===|IMG|IMAGE|ASSET|PROMPT))[^\r\n]+)*)/i);
      if (match && match[1]) thumbnailPrompt = match[1].trim();
    }
    if (!thumbnailPrompt && input.narrationText) {
      const match = input.narrationText.match(/(?:THUMBNAIL|THUMBNAIL PROMPT):\s*([^\r\n]+(?:\r?\n(?!(?:SCENE|SHOT|PART|SECTION|##|===|IMG|IMAGE|ASSET|PROMPT))[^\r\n]+)*)/i);
      if (match && match[1]) thumbnailPrompt = match[1].trim();
    }

    // 1. Parse prompts
    let extractedPrompts: string[] = [];
    if (input.promptsText && input.promptsText.trim()) {
      const pText = input.promptsText.trim();
      const assetRegex = /(?:^|\n)(?:IMG|ASSET|IMAGE|PROMPT|VISUAL|PIC|SCENE|SHOT)\s*\d+[:\-\s|]/i;
      if (assetRegex.test(pText)) {
        const blocks = this.parseAssetBlocks(pText);
        extractedPrompts = blocks.map((b) => b.imagePrompt).filter((p) => p.length > 0);
      } else {
        extractedPrompts = pText
          .split(/\r?\n\r?\n+/)
          .map((line) => line.trim().replace(/^(?:IMG|IMAGE|PROMPT|ASSET)\s*\d*[:\-\s]*/i, '').trim())
          .filter((p) => p.length > 0 && !p.startsWith('#') && !p.startsWith('===') && !p.startsWith('THUMBNAIL:'));
      }
    }

    // 2. Parse narration
    let extractedNarrations: string[] = [];
    const nText = (input.narrationText || '').trim();
    if (nText) {
      const sceneSplitRegex = /(?:^|\n)(?:##+\s*(?:SCENE|SHOT|PART|SECTION)\s*\d+|\[(?:SCENE|SHOT|PART|SECTION)\s*\d+\]|(?:SCENE|SHOT|PART|SECTION)\s+\d+[:\-\s])/i;
      if (sceneSplitRegex.test(nText)) {
        const scenes = this.parseMarkedScenes(nText);
        extractedNarrations = scenes.map((s) => s.narration).filter((n) => n.length > 0);
      } else {
        let rawBlocks = nText.split(/\r?\n\r?\n+/);
        if (rawBlocks.length <= 1) {
          rawBlocks = nText.split(/\r?\n/);
        }
        const paras = rawBlocks
          .map((p) => p.trim().replace(/^(?:Line|Part|Scene|Shot)\s*\d*[:\-\s]*/i, '').trim())
          .filter((p) => p.length > 0 && !p.startsWith('#') && !p.startsWith('===') && !p.startsWith('THUMBNAIL:'));
        extractedNarrations = paras;
      }
    }

    // ZBot Golden Rule #2: Scene count always comes from prompt count if prompts exist
    const promptCount = extractedPrompts.length;
    let finalScenes: SceneEntity[] = [];

    if (promptCount > 0) {
      let finalNarrations: string[] = [];
      if (extractedNarrations.length === promptCount) {
        finalNarrations = extractedNarrations;
      } else {
        warnings.push(`Count mismatch: ${extractedNarrations.length} narration segments distributed across ${promptCount} prompt scenes.`);
        finalNarrations = this.distributeNarration(nText, promptCount);
      }

      finalScenes = extractedPrompts.map((prompt, idx) => {
        const narration = finalNarrations[idx] || '';
        const metrics = ScriptValidator.computeSceneMetrics(narration);
        return {
          sceneNumber: idx + 1,
          narration,
          imagePrompt: prompt,
          durationSeconds: metrics.durationSeconds,
          wordCount: metrics.wordCount,
        };
      });
    } else if (extractedNarrations.length > 0) {
      finalScenes = extractedNarrations.map((narr, idx) => {
        const metrics = ScriptValidator.computeSceneMetrics(narr);
        return {
          sceneNumber: idx + 1,
          narration: narr,
          imagePrompt: narr,
          durationSeconds: metrics.durationSeconds,
          wordCount: metrics.wordCount,
        };
      });
    }

    return {
      title,
      thumbnailPrompt,
      scenes: finalScenes,
      warnings,
      layoutDetected: 'separate_files',
    };
  }
}
