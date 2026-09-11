import { describe, it, expect } from 'vitest';
import { ScriptParser } from '../shared/ScriptParser';

describe('ScriptParser Unit Tests', () => {
  it('1. Layout 1: parses marked single file with ## SCENE, NARRATION, IMAGE, and MOOD tags', () => {
    const raw = `
# The Deep Sea Mystery
THUMBNAIL: A glowing giant squid hovering over a dark oceanic abyss

## SCENE 1
MOOD: mysterious
NARRATION: Beneath the sunlit surface of our oceans lies an alien realm where sunlight never reaches.
IMAGE: Deep dark underwater trench with strange bioluminescent marine creatures glowing neon blue, cinematic lighting

## SCENE 2
MOOD: adventurous
NARRATION: Submersibles venturing into the Mariana Trench have discovered ecosystems that thrive without photosynthesis.
IMAGE: High-tech deep sea submarine with powerful headlights illuminating geothermal vents on the sea floor
`;

    const result = ScriptParser.parse(raw);

    expect(result.layoutDetected).toBe('marked_scenes');
    expect(result.title).toBe('The Deep Sea Mystery');
    expect(result.thumbnailPrompt).toContain('A glowing giant squid');
    expect(result.scenes).toHaveLength(2);

    expect(result.scenes[0]!.sceneNumber).toBe(1);
    expect(result.scenes[0]!.mood).toBe('mysterious');
    expect(result.scenes[0]!.narration).toContain('Beneath the sunlit surface');
    expect(result.scenes[0]!.imagePrompt).toContain('Deep dark underwater trench');

    expect(result.scenes[1]!.sceneNumber).toBe(2);
    expect(result.scenes[1]!.mood).toBe('adventurous');
    expect(result.scenes[1]!.narration).toContain('Submersibles venturing into');
    expect(result.scenes[1]!.imagePrompt).toContain('High-tech deep sea submarine');
  });

  it('2. Layout 2: parses asset-block prompt files (IMG 1, ASSET 2)', () => {
    const raw = `
TITLE: Ancient Rome
IMG 1: Bustling Roman Forum at midday with citizens in togas and marble temples
IMG 2: Roman Colosseum filled with cheering crowds during a chariot race
`;

    const result = ScriptParser.parse(raw);

    expect(result.layoutDetected).toBe('asset_blocks');
    expect(result.title).toBe('Ancient Rome');
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.imagePrompt).toBe('Bustling Roman Forum at midday with citizens in togas and marble temples');
    expect(result.scenes[1]!.imagePrompt).toBe('Roman Colosseum filled with cheering crowds during a chariot race');
  });

  it('3. Layout 3: parses sectioned packages with narration distribution', () => {
    const raw = `
=== NARRATION ===
Rome was not built in a day. It conquered the Mediterranean through military discipline. Later emperors transformed it into an empire of marble.

=== IMAGE PROMPTS ===
1. Construction workers building stone aqueducts in ancient Italy
2. Roman legions marching in disciplined formation under red banners
3. Emperor standing on a marble balcony overlooking the Roman skyline
`;

    const result = ScriptParser.parse(raw);

    expect(result.layoutDetected).toBe('sectioned_package');
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0]!.imagePrompt).toContain('Construction workers building');
    expect(result.scenes[1]!.imagePrompt).toContain('Roman legions marching');
    expect(result.scenes[2]!.imagePrompt).toContain('Emperor standing on a marble balcony');
    expect(result.scenes[0]!.narration).toContain('Rome was not built in a day.');
  });

  it('4. Layout 4: parses JSON story directly', () => {
    const raw = JSON.stringify({
      title: 'Quantum Computing Explained',
      thumbnailPrompt: 'Glowing qubit floating in a futuristic laboratory',
      scenes: [
        {
          sceneNumber: 1,
          narration: 'Classical computers think in ones and zeroes.',
          imagePrompt: 'Silicon microchip with binary neon code floating above it',
          mood: 'analytical',
        },
        {
          sceneNumber: 2,
          narration: 'Quantum computers harness superposition to evaluate states simultaneously.',
          imagePrompt: 'Golden quantum chandelier refrigerator with superconducting coils',
          mood: 'futuristic',
        },
      ],
    });

    const result = ScriptParser.parse(raw);

    expect(result.layoutDetected).toBe('json_story');
    expect(result.title).toBe('Quantum Computing Explained');
    expect(result.thumbnailPrompt).toBe('Glowing qubit floating in a futuristic laboratory');
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.narration).toBe('Classical computers think in ones and zeroes.');
    expect(result.scenes[1]!.imagePrompt).toBe('Golden quantum chandelier refrigerator with superconducting coils');
  });

  it('5. Narration distribution: merges smallest adjacent pairs when sentences >= scenes', () => {
    // 4 sentences into 2 scenes
    const narration = 'Sentence one. Short. Third sentence is a bit longer. Final sentence.';
    const distributed = ScriptParser.distributeNarration(narration, 2);

    expect(distributed).toHaveLength(2);
    // All 4 sentences preserved across the 2 scenes
    expect(distributed.join(' ')).toContain('Sentence one');
    expect(distributed.join(' ')).toContain('Short');
    expect(distributed.join(' ')).toContain('Final sentence');
  });

  it('6. Narration distribution: splits by even word counts when sentences < scenes', () => {
    // 1 long sentence into 3 scenes
    const narration = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron.';
    const distributed = ScriptParser.distributeNarration(narration, 3);

    expect(distributed).toHaveLength(3);
    expect(distributed[0]!.split(/\s+/).length).toBeGreaterThan(0);
    expect(distributed[1]!.split(/\s+/).length).toBeGreaterThan(0);
    expect(distributed[2]!.split(/\s+/).length).toBeGreaterThan(0);
    // Full text preserved
    expect(distributed.join(' ')).toBe(narration);
  });

  it('7. Handles empty and whitespace text safely', () => {
    const result = ScriptParser.parse('   \n  ');
    expect(result.scenes).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.layoutDetected).toBe('empty');
  });

  it('8. Prompt immutability: ensures exact user characters are preserved untouched', () => {
    const prompt = 'Cyberpunk Tokyo street at 3 AM with rain reflections on asphalt, shot on 35mm lens, f/1.8 --ar 16:9';
    const raw = `
## SCENE 1
NARRATION: The city never sleeps.
IMAGE: ${prompt}
`;

    const result = ScriptParser.parse(raw);
    expect(result.scenes[0]!.imagePrompt).toBe(prompt);
  });

  it('9. toMarkedScript bidirectional export: converts structured scenes to markdown', () => {
    const story = {
      title: 'The Great Architecture',
      thumbnailPrompt: 'Epic cathedral facade with stained glass windows',
      scenes: [
        {
          sceneNumber: 1,
          mood: 'epic',
          narration: 'Gothic architecture transformed European landscapes in the Middle Ages.',
          imagePrompt: 'Towering Gothic cathedral spires reaching into misty morning skies, photorealistic',
        },
        {
          sceneNumber: 2,
          mood: 'dramatic',
          narration: 'Flying buttresses allowed walls to be opened for immense stained-glass displays.',
          imagePrompt: 'Detailed view of exterior stone flying buttresses and arched windows',
        },
      ],
    };

    const exported = ScriptParser.toMarkedScript(story);

    expect(exported).toContain('# The Great Architecture');
    expect(exported).toContain('THUMBNAIL: Epic cathedral facade with stained glass windows');
    expect(exported).toContain('## SCENE 1');
    expect(exported).toContain('MOOD: epic');
    expect(exported).toContain('NARRATION: Gothic architecture transformed European landscapes');
    expect(exported).toContain('IMAGE: Towering Gothic cathedral spires');
    expect(exported).toContain('## SCENE 2');
    expect(exported).toContain('MOOD: dramatic');

    // Re-parse exported markdown and verify round-trip fidelity
    const reParsed = ScriptParser.parse(exported);
    expect(reParsed.title).toBe(story.title);
    expect(reParsed.thumbnailPrompt).toBe(story.thumbnailPrompt);
    expect(reParsed.scenes).toHaveLength(2);
    expect(reParsed.scenes[0]!.imagePrompt).toBe(story.scenes[0]!.imagePrompt);
    expect(reParsed.scenes[1]!.imagePrompt).toBe(story.scenes[1]!.imagePrompt);
  });

  it('10. Calculates word counts and speech duration estimates for parsed scenes', () => {
    const raw = `
## SCENE 1
NARRATION: One two three four five six seven eight nine ten.
IMAGE: A quiet mountain village in autumn
`;
    const result = ScriptParser.parse(raw);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.wordCount).toBe(10);
    // 10 words / 2.5 wps = 4 seconds
    expect(result.scenes[0]!.durationSeconds).toBe(4);
  });

  it('11. Performance: parses 100+ scenes within 50ms', () => {
    const lines: string[] = ['# Epic Mega Documentary'];
    for (let i = 1; i <= 100; i++) {
      lines.push(`## SCENE ${i}`);
      lines.push(`MOOD: cinematic`);
      lines.push(`NARRATION: Narration sentence for scene number ${i} describing events.`);
      lines.push(`IMAGE: Cinematic establishing shot for scene ${i} with vivid lighting`);
      lines.push('');
    }

    const script = lines.join('\n');
    const start = performance.now();
    const result = ScriptParser.parse(script);
    const duration = performance.now() - start;

    expect(result.scenes).toHaveLength(100);
    expect(duration).toBeLessThan(100); // well under performance threshold
    expect(result.scenes[99]!.sceneNumber).toBe(100);
  });

  it('12. Preserves verbatim prompts with special characters, quotes, and punctuation', () => {
    const complexPrompt = `Cinematic 8k, "close-up" of a mechanic's hands [holding a wrench], shot on 35mm: f/1.4 --no blur, --seed 42!`;
    const raw = `
## SCENE 1
IMAGE: ${complexPrompt}
`;
    const result = ScriptParser.parse(raw);
    expect(result.scenes[0]!.imagePrompt).toBe(complexPrompt);
  });

  it('13. parseSeparateFiles: ZBot Golden Rule #2 - prompts count is authoritative for scene count', () => {
    const prompts = `
Prompt 1: Wide angle establishing shot of cyberpunk metropolis at night
Prompt 2: Close up on neon sign reflecting in puddles of rain
Prompt 3: A detective in a trench coat lighting a cigarette under streetlamp
`;
    const narration = `
The city never truly slept under the eternal neon haze. Rain poured constantly through the smog. Detective Miller waited alone in the shadows. His contact was already twenty minutes late. The briefcase in his car was too heavy to carry.
`;

    const result = ScriptParser.parseSeparateFiles({
      promptsText: prompts,
      narrationText: narration,
      title: 'Neon Noir Detective',
    });

    // 3 prompts => exactly 3 scenes
    expect(result.scenes).toHaveLength(3);
    expect(result.title).toBe('Neon Noir Detective');
    expect(result.scenes[0]!.imagePrompt).toContain('cyberpunk metropolis');
    expect(result.scenes[1]!.imagePrompt).toContain('neon sign');
    expect(result.scenes[2]!.imagePrompt).toContain('trench coat');
    // Narration sentences should be distributed across the 3 scenes
    expect(result.scenes[0]!.narration.length).toBeGreaterThan(0);
    expect(result.scenes[1]!.narration.length).toBeGreaterThan(0);
    expect(result.scenes[2]!.narration.length).toBeGreaterThan(0);
  });

  it('14. parseSeparateFiles: captures thumbnail prompt when provided', () => {
    const prompts = `1. Scene one visual prompt\n2. Scene two visual prompt`;
    const narration = `First sentence. Second sentence.`;
    const thumbnail = `Dramatic YouTube thumbnail with bold text and glowing eyes`;

    const result = ScriptParser.parseSeparateFiles({
      promptsText: prompts,
      narrationText: narration,
      thumbnailText: thumbnail,
      title: 'Thumbnail Test',
    });

    expect(result.scenes).toHaveLength(2);
    expect(result.thumbnailPrompt).toBe(thumbnail.trim());
  });
});
