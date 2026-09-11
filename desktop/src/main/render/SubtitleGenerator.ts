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

export interface SubtitleCue {
  text: string;
  startMs: number;
  endMs: number;
}

export interface GenerateSubtitleOptions {
  narrationText: string;
  durationSeconds: number;
  subtitleStyle?: string;
  aspectRatio: SupportedAspectRatio;
  wordTimings?: WordTiming[];
  outputPath?: string;
}

export class SubtitleGenerator {
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
   * Generates the V4+ Styles section for the selected style.
   */
  static getStyleDefinition(styleId: string): string {
    const s = (styleId || 'bottom_glass').toLowerCase();

    switch (s) {
      case 'solid_bar':
      case 'bottom_bar':
        // High-contrast full opaque black bar behind bold white text
        return 'Style: Default,Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,3,4,0,2,24,24,36,1';

      case 'neon_punch':
        // Electric neon cyan text with rich dark border and glow
        return 'Style: Default,Arial,34,&H00FFFF00,&H000000FF,&H00101010,&H80000000,1,0,0,0,100,100,0,0,1,3,2,2,24,24,40,1';

      case 'cinema_yellow':
        // Classic cinematic documentary yellow with black outline & drop shadow
        return 'Style: Default,Arial,34,&H0000E5FF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,2,2,24,24,42,1';

      case 'bottom_glass':
      default:
        // Frosted semi-transparent backing box (alpha &H80) behind bold white text
        return 'Style: Default,Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H801A1917,1,0,0,0,100,100,0,0,3,3,0,2,24,24,38,1';
    }
  }

  /**
   * Generates the complete ASS file content.
   */
  static generateAss(options: GenerateSubtitleOptions): string {
    const isPortrait = options.aspectRatio === '9:16';
    const playResX = isPortrait ? 720 : 1280;
    const playResY = isPortrait ? 1280 : 720;

    const styleLine = this.getStyleDefinition(options.subtitleStyle || 'bottom_glass');
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
