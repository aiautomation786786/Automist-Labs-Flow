import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { AudioTranscriptionService } from '../main/transcription/AudioTranscriptionService';
import { MediaImportService } from '../main/import/MediaImportService';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { AssetManager } from '../main/storage/AssetManager';
import { FfmpegResolver } from '../main/utils/FfmpegResolver';
import { GeminiApiKeyManager } from '../main/ai/GeminiApiKeyManager';
import type { TranscriptCue } from '../shared/types';

describe('AudioTranscriptionService', () => {
  let tmpDir: string;
  let prevLocalAppData: string | undefined;
  let ffmpegBin: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcription_test_'));
    prevLocalAppData = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = tmpDir;
    ffmpegBin = FfmpegResolver.findFfmpeg() || 'ffmpeg';
    // Ensure test mock is cleared before each test
    AudioTranscriptionService.setTestMockProvider(null);
  });

  afterEach(async () => {
    AudioTranscriptionService.setTestMockProvider(null);
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

  function generateSampleVideo(outputPath: string, withAudio = true): void {
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=320x240:r=25:d=2.0',
    ];
    if (withAudio) {
      args.push('-f', 'lavfi', '-i', 'sine=f=440:d=2.0');
      args.push('-c:a', 'aac', '-shortest');
    } else {
      args.push('-an');
    }
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', outputPath);
    execFileSync(ffmpegBin, args, { stdio: 'ignore' });
  }

  it('PRODUCTION KEY GUARD: rejects transcription if no Gemini keys are configured and no test mock is set', async () => {
    const videoPath = path.join(tmpDir, 'test_key_guard.mp4');
    generateSampleVideo(videoPath, true);

    const project = await MediaImportService.importMedia({
      filePath: videoPath,
      name: 'Key Guard Test',
    });

    // Verify key manager has no keys in isolated temp dir
    const keyMgr = GeminiApiKeyManager.getInstance();
    expect(keyMgr.getKeyCount()).toBe(0);

    // Calling transcribeProject without keys or mock must reject with clear actionable message
    await expect(
      AudioTranscriptionService.transcribeProject(project.projectId)
    ).rejects.toThrow('Gemini transcription requires a configured Gemini API key. Please add your API key in Settings.');
  });

  it('rejects transcription if the imported video has no audio track', async () => {
    const silentVideoPath = path.join(tmpDir, 'silent.mp4');
    generateSampleVideo(silentVideoPath, false);

    const project = await MediaImportService.importMedia({
      filePath: silentVideoPath,
      name: 'Silent Video Test',
    });

    expect(project.sourceMedia?.hasAudio).toBe(false);

    // Provide mock so key guard passes
    AudioTranscriptionService.setTestMockProvider({
      transcribe: async () => ({ fullText: '', cues: [] }),
    });

    await expect(
      AudioTranscriptionService.transcribeProject(project.projectId)
    ).rejects.toThrow(/no audio track/i);
  });

  it('validates and normalizes Gemini markdown-fenced cues response', () => {
    const rawJson = '```json\n{\n  "cues": [\n    {"startMs": 0, "endMs": 1000, "text": "Hello world"},\n    {"startMs": 1000, "endMs": 2000, "text": "This is a test."}\n  ]\n}\n```';

    const result = AudioTranscriptionService.validateTranscriptCues(rawJson);
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].cueIndex).toBe(0);
    expect(result.cues[0].text).toBe('Hello world');
    expect(result.cues[0].startMs).toBe(0);
    expect(result.cues[0].endMs).toBe(1000);
    expect(result.cues[1].cueIndex).toBe(1);
    expect(result.fullText).toBe('Hello world This is a test.');
  });

  it('filters out invalid cues with negative times or endMs <= startMs', () => {
    const rawJson = JSON.stringify({
      cues: [
        { startMs: -50, endMs: 500, text: 'Negative start' },
        { startMs: 500, endMs: 500, text: 'Zero duration' },
        { startMs: 800, endMs: 600, text: 'Inverted duration' },
        { startMs: 1000, endMs: 1500, text: 'Valid cue' },
      ],
    });

    const result = AudioTranscriptionService.validateTranscriptCues(rawJson);
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].text).toBe('Valid cue');
  });

  it('extracts audio, executes test mock provider, and persists transcript.json', async () => {
    const videoPath = path.join(tmpDir, 'transcribe_full_test.mp4');
    generateSampleVideo(videoPath, true);

    const project = await MediaImportService.importMedia({
      filePath: videoPath,
      name: 'Full Transcribe Test',
    });

    const mockCues: TranscriptCue[] = [
      { cueIndex: 0, startMs: 100, endMs: 800, text: 'Welcome to Infinity Flow.' },
      { cueIndex: 1, startMs: 850, endMs: 1600, text: 'Full audio transcription works.' },
    ];

    AudioTranscriptionService.setTestMockProvider({
      transcribe: async (audioBuffer) => {
        expect(audioBuffer.length).toBeGreaterThan(0);
        return {
          fullText: 'Welcome to Infinity Flow. Full audio transcription works.',
          cues: mockCues,
        };
      },
    });

    const transcript = await AudioTranscriptionService.transcribeProject(project.projectId);

    expect(transcript).toBeDefined();
    expect(transcript.projectId).toBe(project.projectId);
    expect(transcript.cues).toHaveLength(2);
    expect(transcript.cues[0].text).toBe('Welcome to Infinity Flow.');

    // Verify metadata/transcript.json was persisted on disk
    const projectDir = AssetManager.getProjectDir(project.projectId);
    const transcriptFilePath = path.join(projectDir, 'metadata', 'transcript.json');
    expect(fs.existsSync(transcriptFilePath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(transcriptFilePath, 'utf8'));
    expect(persisted.cues).toHaveLength(2);

    // Verify project entity has transcript attached
    const updatedProject = await ProjectRepository.get(project.projectId);
    expect(updatedProject?.transcript).toBeDefined();
    expect(updatedProject?.transcript?.cues).toHaveLength(2);
  });

  it('cancels active transcription when cancelTranscription is called', async () => {
    const videoPath = path.join(tmpDir, 'cancel_test.mp4');
    generateSampleVideo(videoPath, true);

    const project = await MediaImportService.importMedia({
      filePath: videoPath,
      name: 'Cancel Test',
    });

    let cancelTriggered = false;

    AudioTranscriptionService.setTestMockProvider({
      transcribe: async (_audio, signal) => {
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            cancelTriggered = true;
            reject(new Error('Transcription aborted by signal'));
          });
        });
      },
    });

    const transcribePromise = AudioTranscriptionService.transcribeProject(project.projectId);

    // Trigger cancellation after 100ms
    setTimeout(() => {
      AudioTranscriptionService.cancelTranscription(project.projectId);
    }, 100);

    await expect(transcribePromise).rejects.toThrow();
    expect(cancelTriggered).toBe(true);
  });
});
