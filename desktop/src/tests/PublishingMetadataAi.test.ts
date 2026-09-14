import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScriptAiService } from '../main/ai/ScriptAiService';

describe('PublishingMetadataAi Unit & Model Separation Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pub-meta-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('1. Generates publishing metadata and keeps suggestedThumbnailHook strictly separate from YouTubePublishingMetadata', async () => {
    const projectId = 'p_meta_ai_test';
    const projectDir = path.join(tmpBaseDir, 'GoogleFlowApp', 'projects', projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    // Set up project.json
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify({
        projectId,
        name: 'The Secret History of the Pyramids',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        slots: [
          {
            slotIndex: 0,
            type: 'video',
            prompt: 'Cinematic aerial view of the Great Pyramids at dawn',
            status: 'completed',
          },
        ],
        settings: {},
      })
    );

    // Call generatePublishingMetadata
    const result = await ScriptAiService.generatePublishingMetadata(projectId);

    expect(result).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.metadata.title).toBeDefined();
    expect(result.metadata.description).toBeDefined();
    expect(Array.isArray(result.metadata.tags)).toBe(true);
    expect(result.metadata.privacyStatus).toBe('private');

    // Strict Architectural Invariant Test:
    // suggestedThumbnailHook MUST be separated into PublishingAiSuggestion and MUST NOT be inside metadata
    expect(result.suggestedThumbnailHook).toBeDefined();
    expect(typeof result.suggestedThumbnailHook).toBe('string');
    expect((result.metadata as any).suggestedThumbnailHook).toBeUndefined();

    // Verify metadata object keys are strictly YouTube publishing properties only
    const metadataKeys = Object.keys(result.metadata);
    for (const key of metadataKeys) {
      expect([
        'title',
        'description',
        'tags',
        'privacyStatus',
        'scheduledPublishAt',
        'categoryId',
        'thumbnailPath',
      ]).toContain(key);
    }
  });
});
