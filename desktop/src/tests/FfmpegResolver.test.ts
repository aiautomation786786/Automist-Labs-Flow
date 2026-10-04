import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';

describe('FfmpegResolver cross-platform binary resolution', () => {
  let tempDir: string;
  const originalPlatform = process.platform;
  const originalFfmpegEnv = process.env.FFMPEG_PATH;
  const originalFfprobeEnv = process.env.FFPROBE_PATH;
  const originalResourcesPath = (process as any).resourcesPath;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalProgramFiles = process.env.ProgramFiles;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-resolver-test-'));
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    delete (process as any).resourcesPath;
    FfmpegResolver.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    FfmpegResolver.clearCache();

    if (originalFfmpegEnv !== undefined) {
      process.env.FFMPEG_PATH = originalFfmpegEnv;
    } else {
      delete process.env.FFMPEG_PATH;
    }

    if (originalFfprobeEnv !== undefined) {
      process.env.FFPROBE_PATH = originalFfprobeEnv;
    } else {
      delete process.env.FFPROBE_PATH;
    }

    if (originalResourcesPath !== undefined) {
      (process as any).resourcesPath = originalResourcesPath;
    } else {
      delete (process as any).resourcesPath;
    }

    if (originalLocalAppData !== undefined) {
      process.env.LOCALAPPDATA = originalLocalAppData;
    } else {
      delete process.env.LOCALAPPDATA;
    }

    if (originalProgramFiles !== undefined) {
      process.env.ProgramFiles = originalProgramFiles;
    } else {
      delete process.env.ProgramFiles;
    }

    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });

    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('1. FFMPEG_PATH override wins over all other candidates', () => {
    const customFfmpeg = path.join(tempDir, 'custom-ffmpeg');
    fs.writeFileSync(customFfmpeg, '#!/bin/sh\necho ffmpeg', { mode: 0o755 });

    process.env.FFMPEG_PATH = customFfmpeg;
    FfmpegResolver.clearCache();

    const resolved = FfmpegResolver.findFfmpeg();
    expect(resolved).toBe(customFfmpeg);
  });

  it('2. FFPROBE_PATH override wins over all other candidates', () => {
    const customFfprobe = path.join(tempDir, 'custom-ffprobe');
    fs.writeFileSync(customFfprobe, '#!/bin/sh\necho ffprobe', { mode: 0o755 });

    process.env.FFPROBE_PATH = customFfprobe;
    FfmpegResolver.clearCache();

    const resolved = FfmpegResolver.findFfprobe();
    expect(resolved).toBe(customFfprobe);
  });

  it('3. Installed static package binary is accepted when present', () => {
    const resolvedFfmpeg = FfmpegResolver.findFfmpeg();
    expect(resolvedFfmpeg).toBeTruthy();
    expect(resolvedFfmpeg).toContain('ffmpeg-static');
    expect(fs.existsSync(resolvedFfmpeg!)).toBe(true);

    const resolvedFfprobe = FfmpegResolver.findFfprobe();
    expect(resolvedFfprobe).toBeTruthy();
    expect(resolvedFfprobe).toContain('ffprobe');
    expect(fs.existsSync(resolvedFfprobe!)).toBe(true);
  });

  it('4. macOS standard path handling resolves system candidates', () => {
    vi.spyOn(FfmpegResolver, 'resolveStaticBinary').mockReturnValue(null);
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    vi.spyOn(FfmpegResolver, 'fileExists').mockImplementation((p: string) => {
      return p === '/opt/homebrew/bin/ffmpeg' || p === '/opt/homebrew/bin/ffprobe';
    });

    FfmpegResolver.clearCache();
    expect(FfmpegResolver.findFfmpeg()).toBe('/opt/homebrew/bin/ffmpeg');
    expect(FfmpegResolver.findFfprobe()).toBe('/opt/homebrew/bin/ffprobe');
  });

  it('5. Existing Windows candidate behavior remains represented', () => {
    vi.spyOn(FfmpegResolver, 'resolveStaticBinary').mockReturnValue(null);
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    vi.spyOn(FfmpegResolver, 'fileExists').mockImplementation((p: string) => {
      return p === 'C:\\ffmpeg\\bin\\ffmpeg.exe' || p === 'C:\\ffmpeg\\bin\\ffprobe.exe';
    });

    FfmpegResolver.clearCache();
    expect(FfmpegResolver.findFfmpeg()).toBe('C:\\ffmpeg\\bin\\ffmpeg.exe');
    expect(FfmpegResolver.findFfprobe()).toBe('C:\\ffmpeg\\bin\\ffprobe.exe');
  });

  it('6. Packaged resource candidate: resourcesPath/bin/ffmpeg is preferred before static or system binaries', () => {
    const mockResources = path.join(tempDir, 'resources');
    const binDir = path.join(mockResources, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const packagedFfmpeg = path.join(binDir, 'ffmpeg');
    fs.writeFileSync(packagedFfmpeg, 'dummy');

    (process as any).resourcesPath = mockResources;
    FfmpegResolver.clearCache();

    expect(FfmpegResolver.findFfmpeg()).toBe(packagedFfmpeg);
  });

  it('7. Packaged resource candidate: resourcesPath/bin/ffprobe is preferred before static or system binaries', () => {
    const mockResources = path.join(tempDir, 'resources');
    const binDir = path.join(mockResources, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const packagedFfprobe = path.join(binDir, 'ffprobe');
    fs.writeFileSync(packagedFfprobe, 'dummy');

    (process as any).resourcesPath = mockResources;
    FfmpegResolver.clearCache();

    expect(FfmpegResolver.findFfprobe()).toBe(packagedFfprobe);
  });

  it('8. Windows .exe packaged candidates remain supported in packaged apps', () => {
    const mockResources = path.join(tempDir, 'win-resources');
    const binDir = path.join(mockResources, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const packagedFfmpegExe = path.join(binDir, 'ffmpeg.exe');
    const packagedFfprobeExe = path.join(binDir, 'ffprobe.exe');
    fs.writeFileSync(packagedFfmpegExe, 'dummy');
    fs.writeFileSync(packagedFfprobeExe, 'dummy');

    (process as any).resourcesPath = mockResources;
    FfmpegResolver.clearCache();

    expect(FfmpegResolver.findFfmpeg()).toBe(packagedFfmpegExe);
    expect(FfmpegResolver.findFfprobe()).toBe(packagedFfprobeExe);
  });

  it('9. Missing concrete candidates gracefully fall back to PATH command', () => {
    vi.spyOn(FfmpegResolver, 'resolveStaticBinary').mockReturnValue(null);
    vi.spyOn(FfmpegResolver, 'fileExists').mockReturnValue(false);

    FfmpegResolver.clearCache();
    expect(FfmpegResolver.findFfmpeg()).toBe('ffmpeg');
    expect(FfmpegResolver.findFfprobe()).toBe('ffprobe');
  });

  it('10. ffmpeg and ffprobe resolution are completely independent', () => {
    const customFfmpeg = path.join(tempDir, 'custom-ffmpeg-only');
    fs.writeFileSync(customFfmpeg, '#!/bin/sh\necho ffmpeg', { mode: 0o755 });

    process.env.FFMPEG_PATH = customFfmpeg;
    delete process.env.FFPROBE_PATH;
    FfmpegResolver.clearCache();

    expect(FfmpegResolver.findFfmpeg()).toBe(customFfmpeg);
    const resolvedProbe = FfmpegResolver.findFfprobe();
    expect(resolvedProbe).not.toBe(customFfmpeg);
    expect(resolvedProbe).toContain('ffprobe');
  });
});
