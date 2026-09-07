/**
 * PromptParser – Deterministic, line-by-line multiline prompt parser.
 *
 * GUARANTEES:
 *  - Preserves exact line order (1-to-1 mapping with slotIndex).
 *  - Strips empty/whitespace-only lines without shifting index offsets.
 *  - Trims surrounding whitespace from each prompt line.
 *  - Never silently merges separate lines or reorders entries.
 *  - Provides live count and preview extraction for large prompt batches.
 */

export interface ParsedPromptEntry {
  text: string;
  type: 'image' | 'video';
  lineNumber: number; // 1-based original line in textarea
}

export class PromptParser {
  /**
   * Parses raw multiline string input into clean, ordered prompt entries.
   */
  static parseRawText(rawText: string, type: 'image' | 'video'): ParsedPromptEntry[] {
    if (!rawText || typeof rawText !== 'string') {
      return [];
    }

    const lines = rawText.split(/\r?\n/);
    const parsed: ParsedPromptEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (trimmed.length > 0) {
        parsed.push({
          text: trimmed,
          type,
          lineNumber: i + 1,
        });
      }
    }

    return parsed;
  }

  /**
   * Combines image and video parsed prompts into a single ordered array for ProjectRepository.
   */
  static combinePrompts(
    imageText: string,
    videoText: string,
    mode: 'images_only' | 'videos_only' | 'images_and_videos'
  ): Array<{ text: string; type: 'image' | 'video' }> {
    const results: Array<{ text: string; type: 'image' | 'video' }> = [];

    if (mode === 'images_only' || mode === 'images_and_videos') {
      const images = this.parseRawText(imageText, 'image');
      for (const img of images) {
        results.push({ text: img.text, type: 'image' });
      }
    }

    if (mode === 'videos_only' || mode === 'images_and_videos') {
      const videos = this.parseRawText(videoText, 'video');
      for (const vid of videos) {
        results.push({ text: vid.text, type: 'video' });
      }
    }

    return results;
  }

  /**
   * Formats a short, readable one-line preview for compact display.
   */
  static getPreview(text: string, maxLength = 80): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLength) {
      return singleLine;
    }
    return singleLine.substring(0, maxLength).trim() + '...';
  }
}
