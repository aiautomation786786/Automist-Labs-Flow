/**
 * Tests for AssetManager.
 *
 * Verifies directory structures, deterministic filename generation, and output validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AssetManager } from '../main/storage/AssetManager';

describe('AssetManager', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-asset-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('should ensure all project subdirectories exist', () => {
    const dirs = AssetManager.ensureProjectDirectories('proj_test_01');

    expect(fs.existsSync(dirs.projectDir)).toBe(true);
    expect(fs.existsSync(dirs.imagesDir)).toBe(true);
    expect(fs.existsSync(dirs.videosDir)).toBe(true);
    expect(fs.existsSync(dirs.thumbnailsDir)).toBe(true);
    expect(fs.existsSync(dirs.logsDir)).toBe(true);
  });

  it('should generate collision-free deterministic image filenames', () => {
    const p1 = AssetManager.getImageDestinationPath('proj_test_01', 0, 'slot_a1', 'job_1');
    const p2 = AssetManager.getImageDestinationPath('proj_test_01', 1, 'slot_b2', 'job_2');

    expect(p1).toContain('slot_00_slot_a1_job_1.png');
    expect(p2).toContain('slot_01_slot_b2_job_2.png');
    expect(p1).not.toBe(p2);
  });

  it('should generate collision-free deterministic video filenames', () => {
    const p = AssetManager.getVideoDestinationPath('proj_test_01', 3, 'slot_c3', 'job_3');
    expect(p).toContain('slot_03_slot_c3_job_3.mp4');
  });

  it('verifyOutputFile should pass for existing non-empty file in project dir', () => {
    const targetPath = AssetManager.getImageDestinationPath('proj_test_01', 0, 'slot_a1', 'job_1');
    fs.writeFileSync(targetPath, Buffer.from('VALID_IMAGE_DATA'));

    const check = AssetManager.verifyOutputFile(targetPath, 'proj_test_01');
    expect(check.valid).toBe(true);
    expect(check.sizeBytes).toBeGreaterThan(0);
  });

  it('verifyOutputFile should fail for non-existent file', () => {
    const missingPath = path.join(AssetManager.getProjectDir('proj_test_01'), 'images', 'nonexistent.png');
    const check = AssetManager.verifyOutputFile(missingPath, 'proj_test_01');

    expect(check.valid).toBe(false);
    expect(check.error).toContain('does not exist');
  });

  it('verifyOutputFile should fail for empty (0 bytes) file', () => {
    const emptyPath = AssetManager.getImageDestinationPath('proj_test_01', 0, 'slot_a1', 'job_empty');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));

    const check = AssetManager.verifyOutputFile(emptyPath, 'proj_test_01');
    expect(check.valid).toBe(false);
    expect(check.error).toContain('empty (0 bytes)');
  });

  it('verifyOutputFile should fail if file is outside the expected project dir', () => {
    const outsideFile = path.join(tmpBaseDir, 'outside.png');
    fs.writeFileSync(outsideFile, Buffer.from('OUTSIDE_DATA'));

    const check = AssetManager.verifyOutputFile(outsideFile, 'proj_test_01');
    expect(check.valid).toBe(false);
    expect(check.error).toContain('Security violation');
  });
});
