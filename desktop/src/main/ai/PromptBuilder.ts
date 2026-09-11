/**
 * PromptBuilder – Deterministic prompt construction with 4-tier precedence hierarchy.
 *
 * Precedence Order (highest to lowest):
 *  1. User Request / Instructions (topic, target scene count, custom instructions)
 *  2. Selected Skill (writing style, structure, pacing, prompt guidance)
 *  3. Channel Rulebook (channel tone, audience, content restrictions, avoided keywords)
 *  4. System Core Constraints (strict JSON format, 1 image prompt per scene, Meta AI exclusion)
 *
 * Guarantees:
 *  - Explicit exclusion of Meta AI in all visual generation guidance.
 *  - Golden Rule #2: Scene count strictly originates from image prompt count.
 *  - Enforces continuous scene numbering 1..N.
 *  - Produces valid JSON schemas with Markdown fence compatibility.
 */

import type {
  SkillEntity,
  ChannelEntity,
  ScriptAiGenerateParams,
  RefineSceneParams,
} from '../../shared/types';

export class PromptBuilder {
  /**
   * Builds the comprehensive System Prompt for full script generation.
   */
  static buildSystemPrompt(skill?: SkillEntity | null, channel?: ChannelEntity | null): string {
    const sections: string[] = [];

    // Base System Persona
    sections.push(
      'You are the lead narrative director and scriptwriter for an elite automated video production studio.'
    );

    // 4. System Core Constraints (Non-negotiable)
    sections.push(`
CRITICAL SYSTEM REQUIREMENTS:
- Output MUST be valid, parsable JSON matching the exact schema specified below.
- Every scene must have BOTH "narration" and "imagePrompt".
- Scene count strictly defines the visual progression of the video (1 image prompt per scene).
- "narration" must be complete, polished spoken text (never outline notes or bullets).
- "imagePrompt" must be a descriptive visual prompt designed for high-fidelity photorealistic image generation (Google Flow / Gemini).
- PERMANENT RULE: Never reference or use Meta AI.
- Scene numbering must be sequential starting at 1 (1, 2, 3... N).
`);

    // 3. Channel Rulebook Guidelines
    if (channel?.rulebook) {
      const rb = channel.rulebook;
      const channelConstraints: string[] = [];
      if (channel.name) channelConstraints.push(`- Channel Identity: ${channel.name}`);
      if (rb.tone) channelConstraints.push(`- Channel Tone: ${rb.tone}`);
      if (rb.targetAudience) channelConstraints.push(`- Target Audience: ${rb.targetAudience}`);
      if (rb.topicGuidelines) channelConstraints.push(`- Topic Guidelines: ${rb.topicGuidelines}`);
      if (rb.contentPillars && rb.contentPillars.length > 0) {
        channelConstraints.push(`- Content Pillars: ${rb.contentPillars.join(', ')}`);
      }
      if (rb.avoidKeywords && rb.avoidKeywords.length > 0) {
        channelConstraints.push(`- Avoid Keywords & Phrases: ${rb.avoidKeywords.join(', ')}`);
      }
      if (rb.voiceStyle) channelConstraints.push(`- Voice Style: ${rb.voiceStyle}`);

      if (channelConstraints.length > 0) {
        sections.push(`CHANNEL RULEBOOK GUIDELINES:\n${channelConstraints.join('\n')}`);
      }
    }

    // 2. Selected Skill Rules
    if (skill) {
      const skillRules: string[] = [];
      skillRules.push(`- Active Skill: ${skill.name}`);
      if (skill.description) skillRules.push(`- Skill Description: ${skill.description}`);
      if (skill.systemInstructions) skillRules.push(`- Skill Instructions: ${skill.systemInstructions}`);
      if (skill.writingStyle) skillRules.push(`- Writing Style: ${skill.writingStyle}`);
      if (skill.structureRequirements) skillRules.push(`- Narrative Structure: ${skill.structureRequirements}`);
      if (skill.sceneRequirements) skillRules.push(`- Scene Requirements: ${skill.sceneRequirements}`);
      if (skill.promptGuidance) skillRules.push(`- Visual Prompt Guidance: ${skill.promptGuidance}`);

      sections.push(`SKILL DIRECTIVES:\n${skillRules.join('\n')}`);
    }

    // JSON Output Contract
    sections.push(`
OUTPUT FORMAT (STRICT JSON ONLY):
Respond ONLY with a single JSON object in the following format (no conversational chatter before or after):
{
  "title": "Evocative Title for the Video",
  "thumbnailPrompt": "Detailed prompt for YouTube thumbnail image",
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "First scene narration spoken by the voiceover.",
      "imagePrompt": "Detailed cinematic visual description for the image generator.",
      "mood": "mysterious"
    }
  ]
}
`);

    return sections.join('\n\n');
  }

  /**
   * Builds the User Message for full script generation.
   */
  static buildUserPrompt(params: ScriptAiGenerateParams): string {
    const lines: string[] = [];

    lines.push(`TOPIC / PREMISE: "${params.topic}"`);

    if (params.targetSceneCount && params.targetSceneCount > 0) {
      lines.push(`TARGET SCENE COUNT: Exactly ${params.targetSceneCount} scenes.`);
    } else {
      lines.push(`TARGET SCENE COUNT: 4 to 6 scenes.`);
    }

    if (params.targetDurationSeconds && params.targetDurationSeconds > 0) {
      lines.push(`TARGET TOTAL DURATION: Approximately ${params.targetDurationSeconds} seconds.`);
    }

    if (params.aspectRatio) {
      lines.push(`ASPECT RATIO: ${params.aspectRatio} (${params.aspectRatio === '9:16' ? 'Vertical Short' : 'Horizontal Long-form'})`);
    }

    if (params.tone) {
      lines.push(`DESIRED TONE: ${params.tone}`);
    }

    // 1. User Instructions (Highest Precedence)
    if (params.userInstructions?.trim()) {
      lines.push(`\nSPECIFIC USER INSTRUCTIONS (HIGHEST PRIORITY - OVERRIDES ALL CONFLICTS):\n${params.userInstructions.trim()}`);
    }

    lines.push('\nGenerate the complete structured JSON script now.');
    return lines.join('\n');
  }

  /**
   * Builds the System & User prompt for refining a single scene.
   * Modifies ONLY the targeted property (narration or imagePrompt), preserving everything else.
   */
  static buildRefineScenePrompt(params: RefineSceneParams, skill?: SkillEntity | null, channel?: ChannelEntity | null): { systemPrompt: string; userPrompt: string } {
    const targetField = params.target === 'narration' ? 'narration voiceover' : params.target === 'imagePrompt' ? 'visual image prompt' : 'both narration and image prompt';

    const systemPrompt = `You are a professional video editor and script doctor.
Your job is to refine ONLY the ${targetField} for Scene ${params.scene.sceneNumber}.

CRITICAL PRESERVATION RULES:
- Change ONLY what the user asked for.
- Do NOT rewrite or alter any other part of the story.
- Respond ONLY with a valid JSON object containing the refined scene.
${channel?.rulebook?.tone ? `- Channel Tone: ${channel.rulebook.tone}` : ''}
${skill?.promptGuidance && params.target !== 'narration' ? `- Visual Guidance: ${skill.promptGuidance}` : ''}
${skill?.writingStyle && params.target !== 'imagePrompt' ? `- Writing Style: ${skill.writingStyle}` : ''}

OUTPUT SCHEMA:
{
  "sceneNumber": ${params.scene.sceneNumber},
  "narration": "Refined narration text",
  "imagePrompt": "Refined image prompt text",
  "mood": "Refined or existing mood"
}`;

    const userLines: string[] = [
      `EXISTING SCENE ${params.scene.sceneNumber}:`,
      `- Narration: "${params.scene.narration}"`,
      `- Image Prompt: "${params.scene.imagePrompt}"`,
      `- Mood: "${params.scene.mood || 'neutral'}"`,
    ];

    if (params.storyContext?.title) {
      userLines.push(`- Story Title: "${params.storyContext.title}"`);
    }

    if (params.userInstructions?.trim()) {
      userLines.push(`\nUSER INSTRUCTIONS (Refine ${targetField}):\n${params.userInstructions.trim()}`);
    } else {
      userLines.push(`\nPlease enhance and polish the ${targetField} for maximum cinematic impact.`);
    }

    return {
      systemPrompt,
      userPrompt: userLines.join('\n'),
    };
  }

  /**
   * Builds prompt for AI Re-read (§8.4 of ZBot spec).
   * Generates line-number skeleton prompt so the model returns ONLY line number ranges.
   * Golden Rule #3: "An AI may FIND structure (line numbers) but never REWRITE user prompts."
   */
  static buildAiReReadPrompt(skeletonLines: string[]): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a script layout analyzer.
Given a numbered skeleton of a script, identify the exact 1-indexed line number ranges for each scene's narration and image prompt.

CRITICAL INVARIANT (ZBOT GOLDEN RULE #3):
- You MUST NOT return or rewrite any text!
- Return ONLY line number ranges [startLine, endLine] pointing to the numbered lines.
- Reject imagined ranges.

OUTPUT FORMAT (JSON ONLY):
{
  "scenes": [
    {
      "sceneNumber": 1,
      "narrationLines": [startLine, endLine],
      "imagePromptLines": [startLine, endLine]
    }
  ]
}`;

    const userPrompt = `NUMBERED SCRIPT SKELETON:\n${skeletonLines.join('\n')}\n\nIdentify the line number ranges for every scene.`;

    return { systemPrompt, userPrompt };
  }
}
