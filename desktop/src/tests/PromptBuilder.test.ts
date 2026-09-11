import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../main/ai/PromptBuilder';
import type { SkillEntity, ChannelEntity } from '../shared/types';

describe('PromptBuilder Unit Tests', () => {
  const mockSkill: SkillEntity = {
    id: 'skill_test_123',
    name: 'Epic Space Odyssey',
    description: 'Cosmic documentary style',
    systemInstructions: 'Act as a renowned astronomer and writer.',
    writingStyle: 'Awe-inspiring, majestic, scientific',
    structureRequirements: 'Mystery hook, scientific deep dive, grand philosophical wrap up',
    sceneRequirements: '15-20 words per scene',
    promptGuidance: 'Cinematic deep space Hubble telescope style, anamorphic lens flares, unreal engine 5 render',
    channelCompatibility: ['space', 'science'],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockChannel: ChannelEntity = {
    id: 'channel_test_456',
    name: 'Cosmos Unleashed',
    description: 'Science channel',
    rulebook: {
      tone: 'Mysterious and cinematic',
      targetAudience: 'Curious adults aged 18-35',
      topicGuidelines: 'Hard science, space exploration, deep mysteries',
      contentPillars: ['Astrophysics', 'Quantum Realities', 'Cosmology'],
      avoidKeywords: ['clickbait', 'insane', 'shocking'],
      voiceStyle: 'Deep, calm baritone narration',
    },
    outputConfig: {
      defaultAspectRatio: '16:9',
      defaultResolution: '1080p',
    },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { totalProjects: 0, deliveredVideos: 0 },
  };

  it('1. Enforces System Core Constraints, JSON schema, and Meta AI exclusion in system prompt', () => {
    const prompt = PromptBuilder.buildSystemPrompt();

    expect(prompt).toContain('CRITICAL SYSTEM REQUIREMENTS:');
    expect(prompt).toContain('PERMANENT RULE: Never reference or use Meta AI');
    expect(prompt).toContain('Output MUST be valid, parsable JSON');
    expect(prompt).toContain('OUTPUT FORMAT (STRICT JSON ONLY)');
    expect(prompt).toContain('"scenes": [');
  });

  it('2. Embeds Skill Directives and Channel Rulebook in deterministic hierarchy', () => {
    const prompt = PromptBuilder.buildSystemPrompt(mockSkill, mockChannel);

    // Channel Rulebook section
    expect(prompt).toContain('CHANNEL RULEBOOK GUIDELINES:');
    expect(prompt).toContain('- Channel Identity: Cosmos Unleashed');
    expect(prompt).toContain('- Channel Tone: Mysterious and cinematic');
    expect(prompt).toContain('- Target Audience: Curious adults aged 18-35');
    expect(prompt).toContain('- Content Pillars: Astrophysics, Quantum Realities, Cosmology');
    expect(prompt).toContain('- Avoid Keywords & Phrases: clickbait, insane, shocking');

    // Skill Directives section
    expect(prompt).toContain('SKILL DIRECTIVES:');
    expect(prompt).toContain('- Active Skill: Epic Space Odyssey');
    expect(prompt).toContain('- Writing Style: Awe-inspiring, majestic, scientific');
    expect(prompt).toContain('- Visual Prompt Guidance: Cinematic deep space Hubble telescope style');
  });

  it('3. User Prompt enforces Tier 1 precedence (User Instructions override)', () => {
    const userPrompt = PromptBuilder.buildUserPrompt({
      topic: 'The James Webb Deep Field Mystery',
      targetSceneCount: 5,
      targetDurationSeconds: 45,
      aspectRatio: '16:9',
      tone: 'Wonder and awe',
      userInstructions: 'Emphasize the red shift anomalies in galaxy GLASS-z12.',
    });

    expect(userPrompt).toContain('TOPIC / PREMISE: "The James Webb Deep Field Mystery"');
    expect(userPrompt).toContain('TARGET SCENE COUNT: Exactly 5 scenes.');
    expect(userPrompt).toContain('ASPECT RATIO: 16:9 (Horizontal Long-form)');
    expect(userPrompt).toContain('SPECIFIC USER INSTRUCTIONS (HIGHEST PRIORITY - OVERRIDES ALL CONFLICTS):');
    expect(userPrompt).toContain('Emphasize the red shift anomalies in galaxy GLASS-z12.');
  });

  it('4. Refine Scene Prompt targets only the specified field and enforces preservation', () => {
    const narrationRefine = PromptBuilder.buildRefineScenePrompt(
      {
        scene: {
          sceneNumber: 3,
          narration: 'A quiet star collapses under gravity.',
          imagePrompt: 'A dying star imploding in dark space.',
          mood: 'somber',
        },
        target: 'narration',
        userInstructions: 'Make it more dramatic and urgent.',
      },
      mockSkill,
      mockChannel
    );

    expect(narrationRefine.systemPrompt).toContain('refine ONLY the narration voiceover for Scene 3');
    expect(narrationRefine.systemPrompt).toContain('CRITICAL PRESERVATION RULES:');
    expect(narrationRefine.systemPrompt).toContain('Change ONLY what the user asked for');
    expect(narrationRefine.userPrompt).toContain('EXISTING SCENE 3:');
    expect(narrationRefine.userPrompt).toContain('Make it more dramatic and urgent');

    const promptRefine = PromptBuilder.buildRefineScenePrompt(
      {
        scene: {
          sceneNumber: 2,
          narration: 'Original voiceover text.',
          imagePrompt: 'Basic planet view.',
        },
        target: 'imagePrompt',
        userInstructions: 'Add volumetric solar flares and cosmic gas clouds.',
      },
      mockSkill,
      mockChannel
    );

    expect(promptRefine.systemPrompt).toContain('refine ONLY the visual image prompt for Scene 2');
    expect(promptRefine.systemPrompt).toContain('Visual Guidance: Cinematic deep space Hubble telescope style');
    expect(promptRefine.userPrompt).toContain('Add volumetric solar flares and cosmic gas clouds');
  });

  it('5. AI Re-Read prompt strictly enforces line numbers only (ZBot Golden Rule #3)', () => {
    const skeleton = [
      '1: Scene 1: The Cosmic Horizon',
      '2: Deep in the void of space, light struggles to escape.',
      '3: [PROMPT: Ultra wide shot of dark matter web with glowing filaments]',
    ];

    const { systemPrompt, userPrompt } = PromptBuilder.buildAiReReadPrompt(skeleton);

    expect(systemPrompt).toContain('CRITICAL INVARIANT (ZBOT GOLDEN RULE #3):');
    expect(systemPrompt).toContain('You MUST NOT return or rewrite any text!');
    expect(systemPrompt).toContain('"narrationLines": [startLine, endLine]');
    expect(systemPrompt).toContain('"imagePromptLines": [startLine, endLine]');
    expect(userPrompt).toContain('NUMBERED SCRIPT SKELETON:');
    expect(userPrompt).toContain('1: Scene 1: The Cosmic Horizon');
  });
});
