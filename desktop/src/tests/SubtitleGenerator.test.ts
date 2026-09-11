import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SubtitleGenerator } from '../main/render/SubtitleGenerator';
import type { WordTiming } from '../main/tts/TtsTypes';

describe('SubtitleGenerator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Formats millisecond timestamps into ASS H:MM:SS.cc format correctly', () => {
    expect(SubtitleGenerator.formatAssTime(0)).toBe('0:00:00.00');
    expect(SubtitleGenerator.formatAssTime(500)).toBe('0:00:00.50');
    expect(SubtitleGenerator.formatAssTime(1230)).toBe('0:00:01.23');
    expect(SubtitleGenerator.formatAssTime(65430)).toBe('0:01:05.43');
    expect(SubtitleGenerator.formatAssTime(3661250)).toBe('1:01:01.25');
  });

  it('2. Escapes special characters for ASS text syntax', () => {
    const raw = 'Hello {world} with \\ special \n newlines';
    const escaped = SubtitleGenerator.escapeAssText(raw);
    expect(escaped).toBe('Hello \\{world\\} with \\\\ special   newlines');
  });

  it('3. Escapes Windows filesystem paths for FFmpeg libass filter', () => {
    const winPath = 'C:\\Users\\test\\project\\subtitles\\scene-001.ass';
    const escaped = SubtitleGenerator.escapePathForFfmpeg(winPath);
    expect(escaped).toBe('C\\:/Users/test/project/subtitles/scene-001.ass');
    expect(escaped).not.toContain('\\U');
  });

  it('4. Returns distinct V4+ Style definitions for all 4 visual styles', () => {
    const bottomGlass = SubtitleGenerator.getStyleDefinition('bottom_glass');
    const solidBar = SubtitleGenerator.getStyleDefinition('solid_bar');
    const neonPunch = SubtitleGenerator.getStyleDefinition('neon_punch');
    const cinemaYellow = SubtitleGenerator.getStyleDefinition('cinema_yellow');
    const bottomBarAlias = SubtitleGenerator.getStyleDefinition('bottom_bar');

    expect(bottomGlass).toContain('Style: Default');
    expect(solidBar).toContain('Style: Default');
    expect(neonPunch).toContain('&H00FFFF00'); // Cyan/Yellow neon
    expect(cinemaYellow).toContain('&H0000E5FF'); // Cinema yellow
    expect(bottomBarAlias).toBe(solidBar);

    // Ensure all styles are non-empty and have valid format
    for (const styleDef of [bottomGlass, solidBar, neonPunch, cinemaYellow]) {
      expect(styleDef.startsWith('Style: Default,Arial,')).toBe(true);
    }
  });

  it('5. Generates cues from precise word-timing metadata', () => {
    const timings: WordTiming[] = [
      { word: 'Deep', startMs: 0, durationMs: 300 },
      { word: 'ocean', startMs: 350, durationMs: 350 },
      { word: 'creatures', startMs: 750, durationMs: 450 },
      { word: 'glow', startMs: 1250, durationMs: 350 },
      { word: 'in', startMs: 1650, durationMs: 150 },
      { word: 'the', startMs: 1850, durationMs: 150 },
      { word: 'dark.', startMs: 2050, durationMs: 450 },
    ];

    const cues = SubtitleGenerator.buildCues('Deep ocean creatures glow in the dark.', 2.5, timings);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0].startMs).toBe(0);
    expect(cues[cues.length - 1].endMs).toBeGreaterThan(2000);
    // Combined text matches
    const joined = cues.map((c) => c.text).join(' ');
    expect(joined).toBe('Deep ocean creatures glow in the dark.');
  });

  it('6. Generates fallback cues evenly when word-timing metadata is absent', () => {
    const text = 'The ancient pyramids of Giza have stood for more than four millennia as monuments of stone.';
    const cues = SubtitleGenerator.buildCues(text, 6.0, undefined);

    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].startMs).toBe(0);
    expect(cues[cues.length - 1].endMs).toBeLessThanOrEqual(6000);
  });

  it('7. Writes a complete, valid ASS file to disk with proper sections', async () => {
    const outPath = path.join(tempDir, 'test_output.ass');
    const resultPath = await SubtitleGenerator.generateAssFile({
      narrationText: 'Exploring the unknown frontiers of the cosmos.',
      durationSeconds: 4.0,
      subtitleStyle: 'neon_punch',
      aspectRatio: '16:9',
      outputPath: outPath,
    });

    expect(resultPath).toBe(outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('[Script Info]');
    expect(content).toContain('ScriptType: v4.00+');
    expect(content).toContain('PlayResX: 1280');
    expect(content).toContain('PlayResY: 720');
    expect(content).toContain('[V4+ Styles]');
    expect(content).toContain('Format: Name, Fontname');
    expect(content).toContain('&H00FFFF00'); // Neon punch style
    expect(content).toContain('[Events]');
    expect(content).toContain('Format: Layer, Start, End, Style');
    expect(content).toContain('Dialogue: 0,');
    expect(content).toContain('Exploring');
  });

  it('8. Sets proper resolution headers for 9:16 vertical video', async () => {
    const outPath = path.join(tempDir, 'test_vertical.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Vertical video subtitle test',
      durationSeconds: 2.0,
      subtitleStyle: 'solid_bar',
      aspectRatio: '9:16',
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('PlayResX: 720');
    expect(content).toContain('PlayResY: 1280');
  });
});
