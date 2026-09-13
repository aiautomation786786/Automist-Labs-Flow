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

  it('9. Supports custom SubtitleConfig with box enabled, custom colors, and top alignment', async () => {
    const outPath = path.join(tempDir, 'test_custom_box.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Custom subtitle config with box styling',
      durationSeconds: 2.5,
      subtitleStyle: {
        enabled: true,
        fontFamily: 'Montserrat',
        fontSize: 36,
        textColor: '#FF0000', // Red in hex -> ASS &H000000FF
        boxEnabled: true,
        boxColor: '#00FF00', // Green in hex -> ASS &H0000FF00
        position: 'top',
        outlineWidth: 3,
        shadowDepth: 2,
      },
      aspectRatio: '16:9',
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('Montserrat');
    expect(content).toContain('36');
    // BorderStyle 3 indicates box/opaque background in ASS
    expect(content).toContain(',3,');
    // Alignment 8 is Top Center in ASS numpad notation
    expect(content).toContain(',8,');
  });

  it('10. Supports custom SubtitleConfig with outline/shadow and center alignment', async () => {
    const outPath = path.join(tempDir, 'test_custom_center.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Custom subtitle config with center position',
      durationSeconds: 2.0,
      subtitleStyle: {
        enabled: true,
        fontFamily: 'Roboto',
        fontSize: 28,
        textColor: '#FFFFFF',
        boxEnabled: false,
        position: 'center',
        outlineWidth: 4,
        shadowDepth: 3,
      },
      aspectRatio: '16:9',
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('Roboto');
    expect(content).toContain('28');
    // BorderStyle 1 indicates outline + drop shadow in ASS
    expect(content).toContain(',1,');
    // Alignment 5 is Middle Center in ASS numpad notation
    expect(content).toContain(',5,');
  });

  it('11. Supports karaoke, fade, and pop animation in ASS event tags', async () => {
    const karaokeOut = path.join(tempDir, 'test_karaoke.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Word highlight animation test',
      durationSeconds: 2.0,
      subtitleConfig: {
        enabled: true,
        animation: 'karaoke',
      },
      aspectRatio: '16:9',
      outputPath: karaokeOut,
    });
    const karaokeContent = fs.readFileSync(karaokeOut, 'utf8');
    expect(karaokeContent).toContain('{\\kf');

    const fadeOut = path.join(tempDir, 'test_fade.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Smooth fade animation test',
      durationSeconds: 2.0,
      subtitleConfig: {
        enabled: true,
        animation: 'fade',
      },
      aspectRatio: '16:9',
      outputPath: fadeOut,
    });
    const fadeContent = fs.readFileSync(fadeOut, 'utf8');
    expect(fadeContent).toContain('{\\fad(200,200)}');

    const popOut = path.join(tempDir, 'test_pop.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Bouncy pop entrance test',
      durationSeconds: 2.0,
      subtitleConfig: {
        enabled: true,
        animation: 'pop',
      },
      aspectRatio: '16:9',
      outputPath: popOut,
    });
    const popContent = fs.readFileSync(popOut, 'utf8');
    expect(popContent).toContain('{\\t(0,100,\\fscx112\\fscy112)');
  });

  it('12. Supports whatToShow filtering for dialogue_only and narration_only', async () => {
    const mixedText = 'The captain shouted, "All hands on deck!" as waves crashed.';

    const dialogueOut = path.join(tempDir, 'test_dialogue.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: mixedText,
      durationSeconds: 2.0,
      subtitleConfig: {
        enabled: true,
        whatToShow: 'dialogue_only',
      },
      aspectRatio: '16:9',
      outputPath: dialogueOut,
    });
    const dialogueContent = fs.readFileSync(dialogueOut, 'utf8');
    expect(dialogueContent).toContain('"All hands on deck!"');
    expect(dialogueContent).not.toContain('The captain shouted');

    const narrationOut = path.join(tempDir, 'test_narration.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: mixedText,
      durationSeconds: 2.0,
      subtitleConfig: {
        enabled: true,
        whatToShow: 'narration_only',
      },
      aspectRatio: '16:9',
      outputPath: narrationOut,
    });
    const narrationContent = fs.readFileSync(narrationOut, 'utf8');
    expect(narrationContent).toContain('The captain shouted');
    expect(narrationContent).not.toContain('"All hands on deck!"');
  });

  it('13. Sets exact canvas dimensions and maintains base font size at 1080p (9:16)', async () => {
    const outPath = path.join(tempDir, 'test_1080p.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Resolution test at 1080p portrait',
      durationSeconds: 2.0,
      subtitleStyle: 'bottom_glass',
      aspectRatio: '9:16',
      targetWidthPx: 1080,
      targetHeightPx: 1920,
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('PlayResX: 1080');
    expect(content).toContain('PlayResY: 1920');
    // baseFontSize for bottom_glass is 32; at 1080p short side is 1080 -> 32 * 1080 / 1080 = 32
    expect(content).toContain('Style: Default,Arial,32,');
  });

  it('14. Scales font size and canvas proportionally for 1440p / 2K video', async () => {
    const outPath = path.join(tempDir, 'test_1440p.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Resolution test at 1440p 2K',
      durationSeconds: 2.0,
      subtitleStyle: 'bottom_glass',
      aspectRatio: '9:16',
      targetWidthPx: 1440,
      targetHeightPx: 2560,
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('PlayResX: 1440');
    expect(content).toContain('PlayResY: 2560');
    // shortSide = 1440 -> Math.round(32 * 1440 / 1080) = 43
    expect(content).toContain('Style: Default,Arial,43,');
  });

  it('15. Scales font size and canvas proportionally for 2160p / 4K video', async () => {
    const outPath = path.join(tempDir, 'test_2160p.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Resolution test at 2160p 4K',
      durationSeconds: 2.0,
      subtitleStyle: 'bottom_glass',
      aspectRatio: '9:16',
      targetWidthPx: 2160,
      targetHeightPx: 3840,
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('PlayResX: 2160');
    expect(content).toContain('PlayResY: 3840');
    // shortSide = 2160 -> Math.round(32 * 2160 / 1080) = 64
    expect(content).toContain('Style: Default,Arial,64,');
  });

  it('16. Clamps odd target dimensions to nearest even integer', async () => {
    const outPath = path.join(tempDir, 'test_odd_clamp.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Odd dimension clamping test',
      durationSeconds: 2.0,
      subtitleStyle: 'bottom_glass',
      aspectRatio: '9:16',
      targetWidthPx: 1079,
      targetHeightPx: 1919,
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('PlayResX: 1080');
    expect(content).toContain('PlayResY: 1920');
  });

  it('17. Throws descriptive error if target dimensions are non-positive or NaN', async () => {
    const outPath = path.join(tempDir, 'test_invalid.ass');
    await expect(
      SubtitleGenerator.generateAssFile({
        narrationText: 'Invalid dimension test',
        durationSeconds: 2.0,
        aspectRatio: '16:9',
        targetWidthPx: -100,
        targetHeightPx: 720,
        outputPath: outPath,
      })
    ).rejects.toThrow('Invalid subtitle target dimensions');
  });

  it('18. Scales landscape 16:9 subtitles at 1440p correctly with neon_punch style', async () => {
    const outPath = path.join(tempDir, 'test_16_9_1440p.ass');
    await SubtitleGenerator.generateAssFile({
      narrationText: 'Landscape 1440p neon style test',
      durationSeconds: 2.0,
      subtitleStyle: 'neon_punch',
      aspectRatio: '16:9',
      targetWidthPx: 2560,
      targetHeightPx: 1440,
      outputPath: outPath,
    });

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('PlayResX: 2560');
    expect(content).toContain('PlayResY: 1440');
    // neon_punch baseFontSize is 34; shortSide = 1440 -> Math.round(34 * 1440 / 1080) = 45
    expect(content).toContain('Style: Default,Arial,45,');
  });
});
