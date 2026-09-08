import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SafeDownloader } from '../main/engine/SafeDownloader';
import { ModelSelector, NANO_BANANA_2 } from '../main/engine/ModelSelector';
import { AssetManager } from '../main/storage/AssetManager';
import { getAppDataDir } from '../main/utils/AppLogger';

describe('Phase 5.4: MIME Detection and Dynamic Image Extension Handling', () => {
  it('detects PNG magic bytes correctly', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const res = SafeDownloader.detectImageMime(pngHeader);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/png');
    expect(res.extension).toBe('.png');
  });

  it('detects JPEG magic bytes correctly', () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const res = SafeDownloader.detectImageMime(jpegHeader);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/jpeg');
    expect(res.extension).toBe('.jpg');
  });

  it('detects WebP magic bytes correctly', () => {
    const riffWebp = Buffer.alloc(16);
    riffWebp.write('RIFF', 0, 'ascii');
    riffWebp.writeUInt32LE(100, 4);
    riffWebp.write('WEBP', 8, 'ascii');
    const res = SafeDownloader.detectImageMime(riffWebp);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/webp');
    expect(res.extension).toBe('.webp');
  });

  it('detects GIF magic bytes correctly', () => {
    const gifHeader = Buffer.from('GIF89a...');
    const res = SafeDownloader.detectImageMime(gifHeader);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/gif');
    expect(res.extension).toBe('.gif');
  });

  it('detects AVIF magic bytes correctly', () => {
    const avifHeader = Buffer.alloc(16);
    avifHeader.write('ftyp', 4, 'ascii');
    const res = SafeDownloader.detectImageMime(avifHeader);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/avif');
    expect(res.extension).toBe('.avif');
  });

  it('falls back to Content-Type header when magic bytes are unknown', () => {
    const randomBuffer = Buffer.from('non-standard-header-image-data-payload');
    const res = SafeDownloader.detectImageMime(randomBuffer, 'image/webp; charset=utf-8');
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/webp');
    expect(res.extension).toBe('.webp');
  });

  it('rejects invalid or unknown payloads', () => {
    const randomBuffer = Buffer.from('some random text');
    const res = SafeDownloader.detectImageMime(randomBuffer, 'text/plain');
    expect(res.isValid).toBe(false);
    expect(res.mimeType).toBe('application/octet-stream');
  });
});

describe('Phase 5.4: Strict Nano Banana 2 Model Enforcement', () => {
  it('identifies video models correctly to avoid accidental image usage', () => {
    expect(ModelSelector.isVideoModel('Omni Flash')).toBe(true);
    expect(ModelSelector.isVideoModel('Veo 3.1')).toBe(true);
    expect(ModelSelector.isVideoModel('Veo 2')).toBe(true);
    expect(ModelSelector.isVideoModel(NANO_BANANA_2)).toBe(false);
  });
});

describe('Phase 5.4: AssetManager Output Validation with Multi-MIME Support', () => {
  const testProjectId = 'test_proj_p54';
  let projectDir: string;

  beforeEach(() => {
    projectDir = AssetManager.getProjectDir(testProjectId);
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('validates WebP output file safely inside project images directory', () => {
    const imgPath = AssetManager.getImageDestinationPath(testProjectId, 0, 'prompt_1', 'job_1', '.webp');
    expect(imgPath.endsWith('.webp')).toBe(true);

    // File doesn't exist yet
    let check = AssetManager.verifyOutputFile(imgPath, testProjectId);
    expect(check.valid).toBe(false);

    // Write valid file
    fs.writeFileSync(imgPath, Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]));
    check = AssetManager.verifyOutputFile(imgPath, testProjectId);
    expect(check.valid).toBe(true);
    expect(check.sizeBytes).toBeGreaterThan(0);
  });

  it('rejects 0-byte output files', () => {
    const imgPath = AssetManager.getImageDestinationPath(testProjectId, 0, 'prompt_1', 'job_empty', '.png');
    fs.writeFileSync(imgPath, Buffer.alloc(0));
    const check = AssetManager.verifyOutputFile(imgPath, testProjectId);
    expect(check.valid).toBe(false);
    expect(check.error).toContain('empty');
  });

  it('rejects files outside the project directory (security check)', () => {
    const outsidePath = path.join(getAppDataDir(), 'outside_file.png');
    fs.writeFileSync(outsidePath, Buffer.from('test'));
    const check = AssetManager.verifyOutputFile(outsidePath, testProjectId);
    expect(check.valid).toBe(false);
    expect(check.error).toContain('Security violation');
    fs.unlinkSync(outsidePath);
  });
});
