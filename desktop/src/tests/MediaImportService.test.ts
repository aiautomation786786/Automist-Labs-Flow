import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { MediaImportService } from '../main/import/MediaImportService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('MediaImportService', () => {
  let tmpDir: string;
  let prevLocalAppData: string | undefined;
  let ffmpegBin: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media_import_test_'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tmpDir;
    ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150));
    if (prevLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = prevLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  function generateSampleVideo(outputPath: string): void {
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=green:s=320x240:r=25:d=1.5',
        '-f', 'lavfi',
        '-i', 'sine=f=440:d=1.5',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        outputPath,
      ],
      { stdio: 'ignore' }
    );
  }

  it('computes streaming SHA-256 hash deterministically', async () => {
    const filePath = path.join(tmpDir, 'test_hash.mp4');
    fs.writeFileSync(filePath, 'constant content for sha256 testing 12345');

    const hash1 = await MediaImportService.computeFileSha256(filePath);
    const hash2 = await MediaImportService.computeFileSha256(filePath);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('safely copies video leaving user source file 100% untouched', async () => {
    const userSourceDir = path.join(tmpDir, 'user_external_folder');
    fs.mkdirSync(userSourceDir, { recursive: true });
    const userVideoPath = path.join(userSourceDir, 'original_camera_roll.mp4');
    generateSampleVideo(userVideoPath);

    const sourceStatsBefore = fs.statSync(userVideoPath);
    const sourceHashBefore = await MediaImportService.computeFileSha256(userVideoPath);

    const project = await MediaImportService.importMedia({
      filePath: userVideoPath,
      name: 'My Imported Vlog',
    });

    // Verify source file still exists, untouched
    expect(fs.existsSync(userVideoPath)).toBe(true);
    const sourceStatsAfter = fs.statSync(userVideoPath);
    const sourceHashAfter = await MediaImportService.computeFileSha256(userVideoPath);
    expect(sourceStatsAfter.size).toBe(sourceStatsBefore.size);
    expect(sourceHashAfter).toBe(sourceHashBefore);

    // Verify project entity invariants
    expect(project.origin).toBe('imported');
    expect(project.name).toBe('My Imported Vlog');
    expect(project.sourceMedia).toBeDefined();
    expect(project.sourceMedia?.originalFilename).toBe('original_camera_roll.mp4');
    expect(project.sourceMedia?.hashSha256).toBe(sourceHashBefore);
    expect(project.sourceMedia?.width).toBe(320);
    expect(project.sourceMedia?.height).toBe(240);
    expect(project.sourceMedia?.hasAudio).toBe(true);

    // Verify project-local copy exists
    const projectDir = AssetManager.getProjectDir(project.projectId);
    const localVideoCopy = path.join(projectDir, project.sourceMedia!.mediaPath);
    expect(fs.existsSync(localVideoCopy)).toBe(true);
    expect(fs.statSync(localVideoCopy).size).toBe(sourceStatsBefore.size);
  });

  it('rejects unsupported file formats', async () => {
    const textFile = path.join(tmpDir, 'document.txt');
    fs.writeFileSync(textFile, 'hello world');

    await expect(
      MediaImportService.importMedia({ filePath: textFile })
    ).rejects.toThrow(/Unsupported video format/i);
  });

  it('detects duplicate imports by SHA-256 hash', async () => {
    const videoPath = path.join(tmpDir, 'duplicate_test.mp4');
    generateSampleVideo(videoPath);

    const project1 = await MediaImportService.importMedia({
      filePath: videoPath,
      name: 'Import Run 1',
    });

    const duplicateProject = await MediaImportService.findDuplicateProject(project1.sourceMedia!.hashSha256);
    expect(duplicateProject).toBeDefined();
    expect(duplicateProject?.projectId).toBe(project1.projectId);
  });
});
