/**
 * Tests for PromptParser.
 *
 * Verifies:
 *  - Exact line order preservation.
 *  - Stripping of blank lines and whitespace trimming.
 *  - No silent merging or reordering.
 *  - Correct categorization of image vs video prompts.
 *  - Preview generation.
 */

import { describe, it, expect } from 'vitest';
import { PromptParser } from '../shared/PromptParser';

describe('PromptParser', () => {
  it('should parse multiline text into ordered prompt entries', () => {
    const raw = `Cyberpunk street at night
A red hovercar racing through neon fog
Giant holographic koi fish above buildings`;

    const parsed = PromptParser.parseRawText(raw, 'image');

    expect(parsed).toHaveLength(3);
    expect(parsed[0]?.text).toBe('Cyberpunk street at night');
    expect(parsed[0]?.type).toBe('image');
    expect(parsed[0]?.lineNumber).toBe(1);

    expect(parsed[1]?.text).toBe('A red hovercar racing through neon fog');
    expect(parsed[1]?.lineNumber).toBe(2);

    expect(parsed[2]?.text).toBe('Giant holographic koi fish above buildings');
    expect(parsed[2]?.lineNumber).toBe(3);
  });

  it('should ignore purely blank lines and trim whitespace without altering order', () => {
    const raw = `
   First prompt with leading spaces   

   Second prompt with trailing tabs	
   
   Third prompt   
`;

    const parsed = PromptParser.parseRawText(raw, 'video');

    expect(parsed).toHaveLength(3);
    expect(parsed[0]?.text).toBe('First prompt with leading spaces');
    expect(parsed[0]?.lineNumber).toBe(2);

    expect(parsed[1]?.text).toBe('Second prompt with trailing tabs');
    expect(parsed[1]?.lineNumber).toBe(4);

    expect(parsed[2]?.text).toBe('Third prompt');
    expect(parsed[2]?.lineNumber).toBe(6);
  });

  it('should return empty array for empty or whitespace-only input', () => {
    expect(PromptParser.parseRawText('', 'image')).toEqual([]);
    expect(PromptParser.parseRawText('   \n\n\t  \n', 'image')).toEqual([]);
  });

  it('should combine image and video prompts preserving requested mode', () => {
    const images = 'Image 1\nImage 2';
    const videos = 'Video 1\nVideo 2';

    // Both
    const combinedBoth = PromptParser.combinePrompts(images, videos, 'images_and_videos');
    expect(combinedBoth).toHaveLength(4);
    expect(combinedBoth[0]).toEqual({ text: 'Image 1', type: 'image' });
    expect(combinedBoth[1]).toEqual({ text: 'Image 2', type: 'image' });
    expect(combinedBoth[2]).toEqual({ text: 'Video 1', type: 'video' });
    expect(combinedBoth[3]).toEqual({ text: 'Video 2', type: 'video' });

    // Images only
    const combinedImgOnly = PromptParser.combinePrompts(images, videos, 'images_only');
    expect(combinedImgOnly).toHaveLength(2);
    expect(combinedImgOnly.every((p) => p.type === 'image')).toBe(true);

    // Videos only
    const combinedVidOnly = PromptParser.combinePrompts(images, videos, 'videos_only');
    expect(combinedVidOnly).toHaveLength(2);
    expect(combinedVidOnly.every((p) => p.type === 'video')).toBe(true);
  });

  it('getPreview should format a clean truncated single line', () => {
    const longPrompt = 'This is a very long prompt describing a magnificent fantasy castle perched on top of a snowy mountain during twilight hours with double moons in the sky';
    const preview = PromptParser.getPreview(longPrompt, 40);

    expect(preview.length).toBeLessThanOrEqual(43); // 40 + '...'
    expect(preview).toBe('This is a very long prompt describing a...');

    const shortPrompt = 'Short prompt';
    expect(PromptParser.getPreview(shortPrompt)).toBe('Short prompt');
  });
});
