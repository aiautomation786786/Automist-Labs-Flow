/**
 * SubtitleGenerator – ASS v4+ Subtitle Generator with 4 distinct visual styles.
 *
 * Supported Styles:
 *  - bottom_glass: Translucent frosted glass backing box with bold white text
 *  - solid_bar: Opaque high-contrast black banner bar with white text
 *  - neon_punch: Electric neon text with bold contrast outline
 *  - cinema_yellow: Rich cinematic documentary yellow text with drop shadow
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WordTiming, SupportedAspectRatio } from './RenderTypes';
import type { SubtitleConfig } from '../../shared/types';

export interface SubtitleCue {
  text: string;
  startMs: number;
  endMs: number;
}

export interface GenerateSubtitleOptions {
  narrationText: string;
  durationSeconds: number;
  subtitleStyle?: string;
  subtitleConfig?: SubtitleConfig;
  aspectRatio: SupportedAspectRatio;
  wordTimings?: WordTiming[];
  outputPath?: string;
}

export class SubtitleGenerator {
  /**
   * Converts a HEX color string (#RRGGBB or #RRGGBBAA) to ASS &HAABBGGRR format.
   */
  static hexToAssColor(hex: string, defaultAlpha = '00'): string {
    if (!hex) return `&H${defaultAlpha}FFFFFF`;
    let clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (clean.length === 6) {
      const r = clean.slice(0, 2);
      const g = clean.slice(2, 4);
      const b = clean.slice(4, 6);
      return `&H${defaultAlpha}${b}${g}${r}`.toUpperCase();
    }
    if (clean.length === 8) {
      const r = clean.slice(0, 2);
      const g = clean.slice(2, 4);
      const b = clean.slice(4, 6);
      const a = clean.slice(6, 8);
      const alphaNum = 255 - parseInt(a, 16);
      const assAlpha = Math.max(0, Math.min(255, alphaNum)).toString(16).padStart(2, '0');
      return `&H${assAlpha}${b}${g}${r}`.toUpperCase();
    }
    return `&H${defaultAlpha}FFFFFF`;
  }
  /**
   * Formats milliseconds into ASS timestamp format: H:MM:SS.cc (centiseconds)
   */
  static formatAssTime(ms: number): string {
    const totalCentis = Math.max(0, Math.floor(ms / 10));
    const centis = totalCentis % 100;
    const totalSeconds = Math.floor(totalCentis / 100);
    const secs = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const mins = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${hours}:${pad(mins)}:${pad(secs)}.${pad(centis)}`;
  }

  /**
   * Escapes text for ASS dialogue events.
   */
  static escapeAssText(text: string): string {
    return (text || '')
      .replace(/\\/g, '\\\\')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}')
      .replace(/\r?\n/g, ' ')
      .trim();
  }

  /**
   * Escapes a filesystem path for inclusion in FFmpeg filter parameters.
   */
  static escapePathForFfmpeg(filePath: string): string {
    return filePath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''");
  }

  /**
   * Chunks narration text into readable subtitle cues based on word timings or fallback estimation.
   */
  static buildCues(
    narrationText: string,
    durationSeconds: number,
    wordTimings?: WordTiming[]
  ): SubtitleCue[] {
    const text = (narrationText || '').trim();
    if (!text) return [];

    // 1. If word timings are available from TTS engine, chunk by words
    if (wordTimings && wordTimings.length > 0) {
      const cues: SubtitleCue[] = [];
      let currentWords: string[] = [];
      let cueStartMs = 0;
      let cueEndMs = 0;

      for (let i = 0; i < wordTimings.length; i++) {
        const wt = wordTimings[i]!;
        const wordClean = wt.word.trim();
        if (!wordClean) continue;

        if (currentWords.length === 0) {
          cueStartMs = Math.max(0, wt.startMs);
        }

        currentWords.push(wordClean);
        cueEndMs = Math.max(cueEndMs, wt.startMs + wt.durationMs);

        const isPunctuationEnd = /[.!?]$/.test(wordClean);
        const isCommaEnd = /[,;:]$/.test(wordClean);
        const reachedMaxWords = currentWords.length >= 6;
        const reachedMaxDuration = cueEndMs - cueStartMs >= 3000;

        if (
          isPunctuationEnd ||
          (isCommaEnd && currentWords.length >= 3) ||
          reachedMaxWords ||
          reachedMaxDuration ||
          i === wordTimings.length - 1
        ) {
          cues.push({
            text: currentWords.join(' '),
            startMs: cueStartMs,
            endMs: cueEndMs,
          });
          currentWords = [];
        }
      }

      if (cues.length > 0) {
        return cues;
      }
    }

    // 2. Fallback: Split narration into even chunks across duration
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const totalMs = Math.max(1000, durationSeconds * 1000);
    const wordsPerCue = Math.max(3, Math.min(6, Math.ceil(words.length / Math.max(1, durationSeconds / 2.5))));
    const cueList: SubtitleCue[] = [];

    const numCues = Math.ceil(words.length / wordsPerCue);
    const msPerCue = totalMs / numCues;

    for (let c = 0; c < numCues; c++) {
      const chunk = words.slice(c * wordsPerCue, (c + 1) * wordsPerCue).join(' ');
      const startMs = Math.round(c * msPerCue);
      const endMs = Math.round(Math.min(totalMs, (c + 1) * msPerCue - 50));
      cueList.push({
        text: chunk,
        startMs,
        endMs: Math.max(startMs + 200, endMs),
      });
    }

    return cueList;
  }

  /**
   * Generates the V4+ Styles section for the selected style or configuration.
   */
  static getStyleDefinition(styleOrConfig?: string | SubtitleConfig): string {
    let config: SubtitleConfig | undefined;
    let presetName = 'bottom_glass';

    if (typeof styleOrConfig === 'object' && styleOrConfig !== null) {
      config = styleOrConfig;
      presetName = config.preset || 'bottom_glass';
    } else if (typeof styleOrConfig === 'string') {
      const trimmed = styleOrConfig.trim();
      if (trimmed.startsWith('{')) {
        try {
          config = JSON.parse(trimmed) as SubtitleConfig;
          presetName = config.preset || 'bottom_glass';
        } catch {
          presetName = trimmed;
        }
      } else {
        presetName = trimmed;
      }
    }

    const s = (presetName || 'bottom_glass').toLowerCase();

    // Base defaults per preset
    let font = 'Arial';
    let fontSize = 32;
    let primaryColor = '&H00FFFFFF';
    let secondaryColor = '&H000000FF';
    let outlineColor = '&H00000000';
    let backColor = '&H801A1917';
    let borderStyle = 3; // 1 = outline + shadow, 3 = opaque/semi-trans box
    let outline = 3;
    let shadow = 0;
    let alignment = 2; // bottom center
    let marginV = 38;

    switch (s) {
      case 'solid_bar':
      case 'bottom_bar':
        font = 'Arial';
        fontSize = 32;
        primaryColor = '&H00FFFFFF';
        secondaryColor = '&H000000FF';
        outlineColor = '&H00000000';
        backColor = '&H00000000';
        borderStyle = 3;
        outline = 4;
        shadow = 0;
        alignment = 2;
        marginV = 36;
        break;

      case 'neon_punch':
        font = 'Arial';
        fontSize = 34;
        primaryColor = '&H00FFFF00';
        secondaryColor = '&H000000FF';
        outlineColor = '&H00101010';
        backColor = '&H80000000';
        borderStyle = 1;
        outline = 3;
        shadow = 2;
        alignment = 2;
        marginV = 40;
        break;

      case 'cinema_yellow':
        font = 'Arial';
        fontSize = 34;
        primaryColor = '&H0000E5FF';
        secondaryColor = '&H000000FF';
        outlineColor = '&H00000000';
        backColor = '&H80000000';
        borderStyle = 1;
        outline = 3;
        shadow = 2;
        alignment = 2;
        marginV = 42;
        break;

      case 'bottom_glass':
      default:
        font = 'Arial';
        fontSize = 32;
        primaryColor = '&H00FFFFFF';
        secondaryColor = '&H000000FF';
        outlineColor = '&H00000000';
        backColor = '&H801A1917';
        borderStyle = 3;
        outline = 3;
        shadow = 0;
        alignment = 2;
        marginV = 38;
        break;
    }

    // Apply custom config overrides if provided
    if (config) {
      if (config.fontFamily) font = config.fontFamily;
      if (typeof config.fontSize === 'number' && config.fontSize > 0) fontSize = config.fontSize;
      if (config.textColor) primaryColor = SubtitleGenerator.hexToAssColor(config.textColor, '00');
      if (config.backgroundColor) backColor = SubtitleGenerator.hexToAssColor(config.backgroundColor, '80');
      if (typeof config.boxEnabled === 'boolean') {
        borderStyle = config.boxEnabled ? 3 : 1;
      }
      if (typeof config.outlineWidth === 'number') outline = config.outlineWidth;
      if (typeof config.shadowDepth === 'number') shadow = config.shadowDepth;

      if (config.position === 'top') {
        alignment = 8;
        marginV = 40;
      } else if (config.position === 'center') {
        alignment = 5;
        marginV = 0;
      } else if (config.position === 'bottom') {
        alignment = 2;
      }
    }

    return `Style: Default,${font},${fontSize},${primaryColor},${secondaryColor},${outlineColor},${backColor},1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},24,24,${marginV},1`;
  }

  /**
   * Generates the complete ASS file content.
   */
  static generateAss(options: GenerateSubtitleOptions): string {
    const isPortrait = options.aspectRatio === '9:16';
    const playResX = isPortrait ? 720 : 1280;
    const playResY = isPortrait ? 1280 : 720;

    const styleInput = options.subtitleConfig || options.subtitleStyle || 'bottom_glass';
    const styleLine = this.getStyleDefinition(styleInput);
    const cues = this.buildCues(options.narrationText, options.durationSeconds, options.wordTimings);

    let dialogueLines = '';
    for (const cue of cues) {
      const start = this.formatAssTime(cue.startMs);
      const end = this.formatAssTime(cue.endMs);
      const escaped = this.escapeAssText(cue.text);
      dialogueLines += `Dialogue: 0,${start},${end},Default,,0,0,0,,${escaped}\n`;
    }

    return `[Script Info]
Title: Infinity Flow Generated Subtitles
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines}`;
  }

  /**
   * Generates and writes the ASS subtitle file to disk.
   */
  static async writeAssFile(options: GenerateSubtitleOptions & { outputPath: string }): Promise<string> {
    const content = this.generateAss(options);
    const dir = path.dirname(options.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(options.outputPath, content, 'utf-8');
    return options.outputPath;
  }

  static generateAssFile = SubtitleGenerator.writeAssFile;
}
