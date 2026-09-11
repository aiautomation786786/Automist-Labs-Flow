import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iflow-gen-script-test-'));
process.env['LOCALAPPDATA'] = tmpDir;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScriptAiService } from '../main/ai/ScriptAiService';
import { AssetManager } from '../main/storage/AssetManager';
import { MockScriptAiProvider } from '../main/ai/MockScriptAiProvider';

describe('Generated Script Intermediate Artifacts (ZBot §9 Parity)', () => {
  let testEnvDir: string;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    originalLocalAppData = process.env['LOCALAPPDATA'];
    testEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iflow-artifact-env-'));
    process.env['LOCALAPPDATA'] = testEnvDir;
    ScriptAiService.setCustomProvider(new MockScriptAiProvider());
  });

  afterEach(() => {
    ScriptAiService.setCustomProvider(null);
    try {
      fs.rmSync(testEnvDir, { recursive: true, force: true });
    } catch {}
    process.env['LOCALAPPDATA'] = originalLocalAppData;
  });

  it('persists raw generated script to userData/generated-scripts/ on generation completion', async () => {
    const result = await ScriptAiService.generateScript({
      topic: 'The Mysteries of Black Holes',
      targetSceneCount: 3,
      targetDurationSeconds: 45,
      tone: 'Cinematic & Engaging',
    });

    expect(result.success).toBe(true);
    expect(result.savedScriptPath).toBeDefined();

    const savedPath = result.savedScriptPath!;
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toContain('generated-scripts');
    expect(savedPath.endsWith('.md')).toBe(true);

    // Verify content written to disk
    const content = fs.readFileSync(savedPath, 'utf-8');
    expect(content).toContain('SCENE');
    expect(content).toContain('NARRATION:');
    expect(content).toContain('IMAGE:');

    // Verify directory exists in AssetManager
    const genDir = AssetManager.getGeneratedScriptsDir();
    expect(fs.existsSync(genDir)).toBe(true);
    const files = fs.readdirSync(genDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.includes('black_holes'))).toBe(true);
  });
});
