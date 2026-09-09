import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { ZipService } from '../main/utils/ZipService';

describe('ZipService Unit & Safety Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should safely extract valid image files in natural sorted order', async () => {
    const zip = new AdmZip();
    zip.addFile('10_final.jpg', Buffer.from('image 10 content'));
    zip.addFile('1_start.png', Buffer.from('image 1 content'));
    zip.addFile('2_middle.webp', Buffer.from('image 2 content'));
    zip.addFile('readme.txt', Buffer.from('ignore me non-image'));

    const zipPath = path.join(tempDir, 'valid.zip');
    zip.writeZip(zipPath);

    const result = await ZipService.extractImageZip(zipPath);

    expect(result.files.length).toBe(3);
    expect(result.files[0].name).toBe('1_start.png');
    expect(result.files[1].name).toBe('2_middle.webp');
    expect(result.files[2].name).toBe('10_final.jpg');

    // Verify extracted files actually exist on disk
    for (const f of result.files) {
      expect(fs.existsSync(f.path)).toBe(true);
    }

    // Clean up extracted temp directory
    ZipService.cleanupExtractedDir(result.tempDir);
    expect(fs.existsSync(result.tempDir)).toBe(false);
  });

  it('should block directory traversal attacks (e.g. ../evil.png)', async () => {
    const zip = new AdmZip();
    zip.addFile('evil.png', Buffer.from('malicious'));
    zip.getEntries()[0].entryName = '../evil.png';
    const zipPath = path.join(tempDir, 'traversal.zip');
    zip.writeZip(zipPath);

    await expect(ZipService.extractImageZip(zipPath)).rejects.toThrow(
      /directory traversal detected/i
    );
  });

  it('should enforce resource limits (max file count)', async () => {
    const zip = new AdmZip();
    for (let i = 0; i < 505; i++) {
      zip.addFile(`img_${i}.png`, Buffer.from('tiny'));
    }
    const zipPath = path.join(tempDir, 'bomb.zip');
    zip.writeZip(zipPath);

    await expect(ZipService.extractImageZip(zipPath)).rejects.toThrow(
      /too many entries/i
    );
  });

  it('should create ordered zip archive with serial slot naming (01_video.mp4, 02_video.mp4)', async () => {
    const f1 = path.join(tempDir, 'random_gen_hash123.mp4');
    const f2 = path.join(tempDir, 'another_video_999.mp4');
    fs.writeFileSync(f1, Buffer.from('video 1 data'));
    fs.writeFileSync(f2, Buffer.from('video 2 data'));

    const items = [
      { slotIndex: 1, sourcePath: f2, filename: 'video_b.mp4', type: 'video' as const },
      { slotIndex: 0, sourcePath: f1, filename: 'video_a.mp4', type: 'video' as const },
    ];

    const outZip = path.join(tempDir, 'export.zip');
    await ZipService.createOrderedZipArchive(items, outZip);

    expect(fs.existsSync(outZip)).toBe(true);
    const readZip = new AdmZip(outZip);
    const entryNames = readZip.getEntries().map((e) => e.entryName);

    // slotIndex 0 must be 01_video.mp4, slotIndex 1 must be 02_video.mp4
    expect(entryNames).toEqual(['01_video.mp4', '02_video.mp4']);
  });
});
