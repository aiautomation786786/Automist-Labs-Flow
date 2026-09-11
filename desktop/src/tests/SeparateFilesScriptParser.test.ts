import { describe, it, expect } from 'vitest';
import { ScriptParser } from '../shared/ScriptParser';

describe('ScriptParser - Separate Files Layout (ZBot §8.1 Layout 4 & Golden Rule #2)', () => {
  it('correctly performs 1-to-1 positional matching when narration and prompts counts match', () => {
    const narrationText = `# Secrets of the Deep
## SCENE 1
The abyssal plain is Earth's largest and least explored habitat.

## SCENE 2
At depths exceeding four thousand meters, creatures generate their own light.

## SCENE 3
Hydrothermal vents spew mineral-rich fluids that sustain unique ecosystems.
`;

    const promptsText = `IMAGE 1: Ultra-deep ocean abyssal plain, dark benthic floor, submersible searchlights
IMAGE 2: Bioluminescent anglerfish glowing in pitch black water, macro cinematography
IMAGE 3: Massive underwater hydrothermal black smoker chimney emitting mineral clouds
`;

    const thumbnailText = 'Cinematic deep sea submersible illuminating an underwater trench';

    const result = ScriptParser.parseSeparateFiles({
      narrationText,
      promptsText,
      thumbnailText,
    });

    expect(result.scenes).toHaveLength(3);
    expect(result.title).toBe('Secrets of the Deep');
    expect(result.thumbnailPrompt).toBe(thumbnailText);
    expect(result.warnings).toHaveLength(0);

    expect(result.scenes[0].sceneNumber).toBe(1);
    expect(result.scenes[0].narration).toContain('abyssal plain is Earth\'s largest');
    expect(result.scenes[0].imagePrompt).toContain('Ultra-deep ocean abyssal plain');

    expect(result.scenes[1].sceneNumber).toBe(2);
    expect(result.scenes[1].narration).toContain('creatures generate their own light');
    expect(result.scenes[1].imagePrompt).toContain('Bioluminescent anglerfish');

    expect(result.scenes[2].sceneNumber).toBe(3);
    expect(result.scenes[2].narration).toContain('Hydrothermal vents spew');
    expect(result.scenes[2].imagePrompt).toContain('hydrothermal black smoker chimney');
  });

  it('enforces Golden Rule #2: scene count originates from prompt count when prompts > narration', () => {
    const narrationText = `Line 1: The journey begins at dawn in the northern highlands.
Line 2: Traversing the glacial valleys reveals ancient ice formations.`;

    const promptsText = `PROMPT 1: Golden sunrise over misty mountain highlands, aerial cinematic 8k
PROMPT 2: Massive turquoise glacial ice cave with sunlight piercing through ceiling
PROMPT 3: Solitary explorer standing on snowy mountain precipice looking at vast horizon
PROMPT 4: Northern lights dancing across starry arctic night sky, ultra wide`;

    const result = ScriptParser.parseSeparateFiles({
      narrationText,
      promptsText,
    });

    // Golden Rule #2: Scene count strictly equals prompt count (4 scenes)
    expect(result.scenes).toHaveLength(4);

    // Warning emitted about count mismatch and narration distribution
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('mismatch');
    expect(result.warnings[0]).toContain('2 narration segments distributed across 4 prompt scenes');

    // All 4 scenes have image prompts
    for (let i = 0; i < 4; i++) {
      expect(result.scenes[i].sceneNumber).toBe(i + 1);
      expect(result.scenes[i].imagePrompt).toBeTruthy();
    }
  });

  it('enforces Golden Rule #2: scene count originates from prompt count when narration > prompts', () => {
    const narrationText = `Part 1: The mission was conceived in the late nineteen sixties.
Part 2: Engineers worked tirelessly through countless design iterations.
Part 3: Finally the Saturn Five rocket was rolled out to the launch pad.
Part 4: Millions watched worldwide as the engines ignited with thunderous roar.
Part 5: Humanity took its first monumental steps onto the lunar surface.`;

    const promptsText = `IMAGE 1: Apollo engineers in control room studying blueprints, vintage photography
IMAGE 2: Saturn V rocket towering on the launch pad at dawn, dramatic backlight
IMAGE 3: Astronaut boot stepping onto grey lunar regolith, Earth visible in black sky`;

    const result = ScriptParser.parseSeparateFiles({
      narrationText,
      promptsText,
    });

    // Golden Rule #2: Scene count strictly equals prompt count (3 scenes)
    expect(result.scenes).toHaveLength(3);

    // Warning emitted about count mismatch
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('mismatch');
    expect(result.warnings[0]).toContain('5 narration segments distributed across 3 prompt scenes');

    // All narration content is distributed and preserved across the 3 scenes
    const combinedNarration = result.scenes.map((s) => s.narration).join(' ');
    expect(combinedNarration).toContain('mission was conceived');
    expect(combinedNarration).toContain('first monumental steps onto the lunar surface');
  });

  it('supports prompt-only separate files without narration', () => {
    const promptsText = `IMAGE 1: Futuristic cybernetic cityscape with neon reflections on wet asphalt
IMAGE 2: Autonomous flying taxi cruising between towering crystalline skyscrapers
IMAGE 3: Holographic billboard illuminating a crowded rain-soaked crosswalk`;

    const result = ScriptParser.parseSeparateFiles({
      promptsText,
      title: 'Neon Metropolis',
    });

    expect(result.scenes).toHaveLength(3);
    expect(result.title).toBe('Neon Metropolis');
    for (const scene of result.scenes) {
      expect(scene.imagePrompt).toBeTruthy();
    }
  });

  it('supports narration-only separate files without prompts', () => {
    const narrationText = `Paragraph 1: Welcome to the future of automated video creation.

Paragraph 2: With intelligent script parsing and background rendering, production is effortless.`;

    const result = ScriptParser.parseSeparateFiles({
      narrationText,
      title: 'Welcome Video',
    });

    expect(result.scenes).toHaveLength(2);
    expect(result.title).toBe('Welcome Video');
    expect(result.scenes[0].narration).toContain('Welcome to the future');
    expect(result.scenes[1].narration).toContain('production is effortless');
  });

  it('extracts thumbnail prompt embedded in prompts text if not passed separately', () => {
    const promptsText = `THUMBNAIL: Dramatic cinematic close-up of an astronaut helmet reflecting a solar eclipse

IMAGE 1: Rocket launching into orbit leaving an orange smoke plume
IMAGE 2: Spacecraft docking with international space station`;

    const result = ScriptParser.parseSeparateFiles({
      promptsText,
    });

    expect(result.scenes).toHaveLength(2);
    expect(result.thumbnailPrompt).toBe(
      'Dramatic cinematic close-up of an astronaut helmet reflecting a solar eclipse'
    );
  });
});
