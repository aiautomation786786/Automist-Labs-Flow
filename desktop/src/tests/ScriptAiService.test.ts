import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScriptAiService } from '../main/ai/ScriptAiService';
import { MockScriptAiProvider } from '../main/ai/MockScriptAiProvider';
import { IScriptAiProvider, ProviderCompletionResult } from '../main/ai/ScriptAiTypes';
import { GeminiOpenAiProvider } from '../main/ai/GeminiOpenAiProvider';

describe('ScriptAiService & Provider Unit Tests', () => {
  beforeEach(() => {
    ScriptAiService.setCustomProvider(null);
  });

  afterEach(() => {
    ScriptAiService.setCustomProvider(null);
  });

  it('1. Generates structured story with MockScriptAiProvider and verifies ScriptValidator validation', async () => {
    ScriptAiService.setCustomProvider(new MockScriptAiProvider());
    const result = await ScriptAiService.generateScript({
      topic: 'The Mysteries of the Marianas Trench',
      targetSceneCount: 4,
      aspectRatio: '16:9',
      tone: 'Mysterious',
    });

    expect(result.success).toBe(true);
    expect(result.story).toBeDefined();
    expect(result.story!.scenes.length).toBe(4);
    expect(result.validation).toBeDefined();
    expect(result.validation!.isValid).toBe(true);
    expect(result.stats?.isMock).toBe(true);

    // Verify all scenes have non-empty narration and imagePrompt
    for (const scene of result.story!.scenes) {
      expect(scene.narration.length).toBeGreaterThan(5);
      expect(scene.imagePrompt.length).toBeGreaterThan(5);
      expect(scene.durationSeconds).toBeGreaterThan(0);
      expect(scene.wordCount).toBeGreaterThan(0);
    }
  });

  it('2. Enforces non-bypassable ScriptValidator rejection when provider output is invalid', async () => {
    // Inject custom provider that returns scenes with missing prompts (violating validation)
    const invalidProvider: IScriptAiProvider = {
      name: 'InvalidProvider',
      generateChatCompletion: async () => ({
        text: JSON.stringify({
          title: 'Broken Script',
          scenes: [
            {
              sceneNumber: 1,
              narration: 'Valid narration line.',
              imagePrompt: '', // Empty image prompt will fail ScriptValidator
            },
          ],
        }),
        model: 'test-model',
        rounds: 1,
        charsReceived: 100,
        keyRotations: 0,
      }),
      testConnection: async () => ({ success: true }),
    };

    ScriptAiService.setCustomProvider(invalidProvider);

    const result = await ScriptAiService.generateScript({
      topic: 'Invalid Story Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Story validation failed');
    expect(result.validation).toBeDefined();
    expect(result.validation!.isValid).toBe(false);
  });

  it('3. Single-scene refinement modifies only the targeted field and preserves untouched fields', async () => {
    const originalScene = {
      sceneNumber: 2,
      narration: 'The colossal kraken emerges from the oceanic depths.',
      imagePrompt: 'Photorealistic bioluminescent giant squid emerging into deep abyss.',
      mood: 'tense',
    };

    // Target 1: Refine narration only -> imagePrompt must remain 100% identical
    const refineNarrationProvider: IScriptAiProvider = {
      name: 'NarrationRefineMock',
      generateChatCompletion: async () => ({
        text: JSON.stringify({
          sceneNumber: 2,
          narration: 'A terrifying legendary beast awakens in the black abyss.',
          imagePrompt: 'Completely different prompt that should be ignored because target is narration',
        }),
        model: 'test-model',
        rounds: 1,
        charsReceived: 100,
        keyRotations: 0,
      }),
      testConnection: async () => ({ success: true }),
    };

    ScriptAiService.setCustomProvider(refineNarrationProvider);

    const narrationResult = await ScriptAiService.refineScene({
      scene: originalScene,
      target: 'narration',
      userInstructions: 'Make the voiceover darker.',
    });

    expect(narrationResult.success).toBe(true);
    expect(narrationResult.refinedScene!.narration).toBe('A terrifying legendary beast awakens in the black abyss.');
    // Image prompt MUST remain untouched!
    expect(narrationResult.refinedScene!.imagePrompt).toBe(originalScene.imagePrompt);

    // Target 2: Refine imagePrompt only -> narration must remain 100% identical
    const refinePromptProvider: IScriptAiProvider = {
      name: 'PromptRefineMock',
      generateChatCompletion: async () => ({
        text: JSON.stringify({
          sceneNumber: 2,
          narration: 'Should be ignored because target is imagePrompt',
          imagePrompt: 'Cinematic 8k macro underwater shot of glowing tentacles.',
        }),
        model: 'test-model',
        rounds: 1,
        charsReceived: 100,
        keyRotations: 0,
      }),
      testConnection: async () => ({ success: true }),
    };

    ScriptAiService.setCustomProvider(refinePromptProvider);

    const promptResult = await ScriptAiService.refineScene({
      scene: originalScene,
      target: 'imagePrompt',
      userInstructions: 'Focus on tentacle details.',
    });

    expect(promptResult.success).toBe(true);
    expect(promptResult.refinedScene!.imagePrompt).toBe('Cinematic 8k macro underwater shot of glowing tentacles.');
    // Narration MUST remain untouched!
    expect(promptResult.refinedScene!.narration).toBe(originalScene.narration);
  });

  it('4. AI Re-Read slices original script lines locally without rewriting (ZBot Golden Rule #3)', async () => {
    const originalScript = [
      'Welcome to the future of robotics.',
      '[IMAGE: Sleek humanoid robot standing in clean research laboratory]',
      '',
      'Next-generation actuators give machines superhuman precision.',
      '[IMAGE: Close-up of robotic titanium fingers assembling microchip]',
    ].join('\n');

    const mockReReadProvider: IScriptAiProvider = {
      name: 'ReReadMock',
      generateChatCompletion: async () => ({
        text: JSON.stringify({
          scenes: [
            {
              sceneNumber: 1,
              narrationLines: [1, 1],
              imagePromptLines: [2, 2],
            },
            {
              sceneNumber: 2,
              narrationLines: [4, 4],
              imagePromptLines: [5, 5],
            },
          ],
        }),
        model: 'test-model',
        rounds: 1,
        charsReceived: 100,
        keyRotations: 0,
      }),
      testConnection: async () => ({ success: true }),
    };

    ScriptAiService.setCustomProvider(mockReReadProvider);

    const reReadResult = await ScriptAiService.reReadScript({
      rawScript: originalScript,
    });

    expect(reReadResult.success).toBe(true);
    expect(reReadResult.story?.scenes.length).toBe(2);

    // Strictly slices the original lines
    expect(reReadResult.story?.scenes[0].narration).toBe('Welcome to the future of robotics.');
    expect(reReadResult.story?.scenes[0].imagePrompt).toBe('[IMAGE: Sleek humanoid robot standing in clean research laboratory]');
    expect(reReadResult.story?.scenes[1].narration).toBe('Next-generation actuators give machines superhuman precision.');
    expect(reReadResult.story?.scenes[1].imagePrompt).toBe('[IMAGE: Close-up of robotic titanium fingers assembling microchip]');
  });

  it('5. GeminiOpenAiProvider rotates API keys automatically on 429 quota exhaustion', async () => {
    const keys = ['key_exhausted_1', 'key_valid_2'];
    const provider = new GeminiOpenAiProvider(keys, 'gemini-flash-latest');

    const keyUsed: string[] = [];

    // Mock postJson to simulate 429 on first key, 200 on second key
    (provider as any).postJson = async (payload: any, apiKey: string) => {
      keyUsed.push(apiKey);

      if (apiKey === 'key_exhausted_1') {
        return {
          statusCode: 429,
          headers: { 'retry-after': '5' },
          body: JSON.stringify({
            error: {
              message: 'Resource has been exhausted (e.g. check quota).',
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
        };
      }

      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({
          choices: [
            {
              message: { content: '{"status":"ok"}' },
              finish_reason: 'stop',
            },
          ],
        }),
      };
    };

    const result = await provider.generateChatCompletion('system', 'user', { timeoutMs: 10000 });
    expect(result.text).toBe('{"status":"ok"}');
    expect(result.keyRotations).toBe(1);
    expect(keyUsed).toEqual(['key_exhausted_1', 'key_valid_2']);
  });
});
