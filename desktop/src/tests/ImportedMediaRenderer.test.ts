import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { ImportedMediaRenderer } from '../main/render/ImportedMediaRenderer';
import { MediaImportService } from '../main/import/MediaImportService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { StoryRepository } from '../main/storage/StoryRepository';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('ImportedMediaRenderer', () => {
  let tmpDir: string;
  let prevLocalAppData: string | undefined;
  let ffmpegBin: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imported_render_test_'));
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
        '-i', 'color=c=purple:s=320x240:r=25:d=2.0',
        '-f', 'lavfi',
        '-i', 'sine=f=500:d=2.0',
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

  it('rejects non-imported projects', async () => {
    const normalProject = await ProjectRepository.create({
      name: 'Normal AI Project',
      prompts: [{ text: 'Prompt 1', type: 'video' }],
    });

    await expect(
      ImportedMediaRenderer.renderImportedVideo({
        projectId: normalProject.projectId,
        rawModeOnly: true,
      })
    ).rejects.toThrow(/no sourceMedia/i);
  });

  it('renders imported video in raw stream copy mode', async () => {
    const sourceVideoPath = path.join(tmpDir, 'source_raw.mp4');
    generateSampleVideo(sourceVideoPath);

    const project = await MediaImportService.importMedia({
      filePath: sourceVideoPath,
      name: 'Raw Remux Project',
    });

    let progressCalls = 0;
    const manifest = await ImportedMediaRenderer.renderImportedVideo(
      {
        projectId: project.projectId,
        rawModeOnly: true,
      },
      {
        onProgress: (p) => {
          if (p >= 0) progressCalls++;
        },
      }
    );

    expect(manifest.status).toBe('completed');
    expect(manifest.absoluteVideoPath).toBeDefined();
    expect(fs.existsSync(manifest.absoluteVideoPath)).toBe(true);
    expect(manifest.durationSeconds).toBeGreaterThan(1.5);
    expect(manifest.durationSeconds).toBeLessThan(2.5);
    expect(progressCalls).toBeGreaterThan(0);

    // Verify manifest persisted in StoryRepository
    const loadedManifest = await StoryRepository.getFinalRenderManifest(project.projectId);
    expect(loadedManifest).toBeDefined();
    expect(loadedManifest?.status).toBe('completed');
  });

  it('burns styled subtitles from transcript cues into final video', async () => {
    const sourceVideoPath = path.join(tmpDir, 'source_with_subtitles.mp4');
    generateSampleVideo(sourceVideoPath);

    const project = await MediaImportService.importMedia({
      filePath: sourceVideoPath,
      name: 'Subtitle Burn Project',
    });

    // Attach mock transcript to project
    project.transcript = {
      version: 1,
      projectId: project.projectId,
      sourceMediaPath: project.sourceMedia!.mediaPath,
      fullText: 'Hello world this is subtitle test.',
      cues: [
        {
          cueIndex: 0,
          startMs: 100,
          endMs: 900,
          text: 'Hello world',
          words: [
            { word: 'Hello', startMs: 100, endMs: 400 },
            { word: 'world', startMs: 400, endMs: 900 },
          ],
        },
        {
          cueIndex: 1,
          startMs: 1000,
          endMs: 1800,
          text: 'this is subtitle test.',
          words: [
            { word: 'this', startMs: 1000, endMs: 1200 },
            { word: 'is', startMs: 1200, endMs: 1400 },
            { word: 'subtitle', startMs: 1400, endMs: 1600 },
            { word: 'test.', startMs: 1600, endMs: 1800 },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
      provider: 'mock',
    };
    await ProjectRepository.save(project);

    const manifest = await ImportedMediaRenderer.renderImportedVideo({
      projectId: project.projectId,
      rawModeOnly: false,
      subtitleStyle: 'classic',
    });

    expect(manifest.status).toBe('completed');
    expect(manifest.absoluteVideoPath).toBeDefined();
    expect(fs.existsSync(manifest.absoluteVideoPath)).toBe(true);
    expect(manifest.durationSeconds).toBeGreaterThan(1.5);

    // Subtitle file should exist in project renders directory
    const projectDir = AssetManager.getProjectDir(project.projectId);
    const subtitleAssPath = path.join(projectDir, 'subtitles', 'imported_subtitles.ass');
    expect(fs.existsSync(subtitleAssPath)).toBe(true);
    const assContent = fs.readFileSync(subtitleAssPath, 'utf8');
    expect(assContent).toContain('[Script Info]');
    expect(assContent).toContain('Hello world');
  });
});
