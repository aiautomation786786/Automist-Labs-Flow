/**
 * MockScriptAiProvider – Deterministic, offline provider for test suites
 * and zero-key development environments.
 *
 * Guarantees:
 *  1. Truthful Reporting: Clearly flags isMock: true; NEVER falsely claims cloud API execution.
 *  2. Schema Compliance: Generates strictly valid JSON stories that pass ScriptValidator.
 *  3. Respects Parameters: Honors requested scene count, topic, and formatting rules.
 *  4. Fast & Offline: Requires no external network or API credentials.
 */

import type {
  IScriptAiProvider,
  ProviderCompletionOptions,
  ProviderCompletionResult,
} from './ScriptAiTypes';

export class MockScriptAiProvider implements IScriptAiProvider {
  readonly id = 'mock-ai';
  readonly name = 'Deterministic Mock Provider (Offline / Tests)';

  async generateChatCompletion(
    systemPrompt: string,
    userPrompt: string,
    options: ProviderCompletionOptions = {}
  ): Promise<ProviderCompletionResult> {
    const startTime = Date.now();

    if (options.signal?.aborted) {
      throw new Error('Script AI generation cancelled');
    }

    options.onProgress?.({
      stage: 'generating',
      round: 1,
      totalRounds: 1,
      charsReceived: 100,
      tailSnippet: 'Generating deterministic mock story...',
    });

    // Check if this is a scene refinement request
    if (systemPrompt.includes('refine ONLY the') || userPrompt.includes('EXISTING SCENE')) {
      const sceneNumMatch = userPrompt.match(/EXISTING SCENE (\d+):/i);
      const sceneNum = sceneNumMatch ? parseInt(sceneNumMatch[1], 10) : 1;

      const isPromptOnly = systemPrompt.includes('visual image prompt');
      const isNarrationOnly = systemPrompt.includes('narration voiceover');

      const mockRefinedScene = {
        sceneNumber: sceneNum,
        narration: isPromptOnly
          ? 'Original preserved voiceover narration.'
          : 'Refined narration delivered with heightened dramatic cadence and cinematic authority.',
        imagePrompt: isNarrationOnly
          ? 'Original preserved image prompt.'
          : 'Refined hyper-detailed 35mm film still, dramatic volumetric lighting, 8k photorealistic resolution.',
        mood: 'epic',
      };

      return {
        text: JSON.stringify(mockRefinedScene, null, 2),
        model: 'mock-ai-v1',
        rounds: 1,
        charsReceived: 200,
        keyRotations: 0,
        durationMs: Date.now() - startTime,
        isMock: true,
      };
    }

    // Check if this is an AI Re-read skeleton request
    if (systemPrompt.includes('script layout analyzer') || userPrompt.includes('NUMBERED SCRIPT SKELETON:')) {
      const mockReRead = {
        scenes: [
          { sceneNumber: 1, narrationLines: [1, 2], imagePromptLines: [3, 4] },
          { sceneNumber: 2, narrationLines: [5, 6], imagePromptLines: [7, 8] },
          { sceneNumber: 3, narrationLines: [9, 10], imagePromptLines: [11, 12] },
        ],
      };

      return {
        text: JSON.stringify(mockReRead, null, 2),
        model: 'mock-ai-v1',
        rounds: 1,
        charsReceived: 150,
        keyRotations: 0,
        durationMs: Date.now() - startTime,
        isMock: true,
      };
    }

    // Full Story Generation
    // Extract topic and scene count
    const topicMatch = userPrompt.match(/TOPIC \/ PREMISE: "([^"]+)"/i);
    const topic = topicMatch ? topicMatch[1] : 'Explorations in Discovery';

    const countMatch = userPrompt.match(/TARGET SCENE COUNT: Exactly (\d+) scenes/i);
    const sceneCount = countMatch ? parseInt(countMatch[1], 10) : 3;

    const scenes = [];
    for (let i = 1; i <= sceneCount; i++) {
      scenes.push({
        sceneNumber: i,
        narration: `Scene ${i} narrates the unfolding mysteries of ${topic}, capturing the viewer with captivating details and historical depth.`,
        imagePrompt: `Cinematic frame of ${topic} scene ${i}, golden hour natural lighting, 35mm photograph, 8k resolution, photorealistic composition`,
        mood: i === 1 ? 'mysterious' : i === sceneCount ? 'awe' : 'wonder',
      });
    }

    const mockStory = {
      title: topic.length > 50 ? topic.slice(0, 50) : topic,
      thumbnailPrompt: `Eye-catching YouTube thumbnail of ${topic}, vivid glowing accents, high contrast cinematic focal point`,
      scenes,
    };

    return {
      text: JSON.stringify(mockStory, null, 2),
      model: 'mock-ai-v1',
      rounds: 1,
      charsReceived: 400,
      keyRotations: 0,
      durationMs: Date.now() - startTime,
      isMock: true,
    };
  }

  async testConnection(): Promise<{ success: boolean; model: string; isMock: boolean }> {
    return {
      success: true,
      model: 'mock-ai-v1',
      isMock: true,
    };
  }
}
