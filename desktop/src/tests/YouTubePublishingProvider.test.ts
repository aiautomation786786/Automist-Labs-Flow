import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { YouTubePublishingProvider } from '../main/publishing/YouTubePublishingProvider';
import { PublishingAccountRepository } from '../main/publishing/PublishingAccountRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import type { YouTubePublishingMetadata, PublishingProgressEvent } from '../shared/types';

describe('YouTubePublishingProvider Resumable Upload & Invariant Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;
  const originalFetch = global.fetch;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-yt-pub-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    PublishingAccountRepository.clearCache();
    ProjectRepository.clearCache();
    vi.restoreAllMocks();

    // Mock video probe validation for deterministic fast testing
    vi.spyOn(YouTubePublishingProvider, 'validateVideo').mockResolvedValue({
      valid: true,
      durationSeconds: 15,
      sizeBytes: 1024 * 1024,
    });
  });

  afterEach(() => {
    PublishingAccountRepository.clearCache();
    ProjectRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    global.fetch = originalFetch;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  async function setupProjectWithVideo(projectId: string): Promise<{ projectDir: string; videoPath: string }> {
    const projectDir = path.join(tmpBaseDir, 'GoogleFlowApp', 'projects', projectId);
    const videosDir = path.join(projectDir, 'videos');
    const metadataDir = path.join(projectDir, 'metadata');
    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(metadataDir, { recursive: true });

    // Create a 1MB test video file
    const videoPath = path.join(videosDir, 'final.mp4');
    fs.writeFileSync(videoPath, Buffer.alloc(1024 * 1024, 0x41));

    const finalDir = path.join(projectDir, 'final');
    fs.mkdirSync(finalDir, { recursive: true });
    fs.writeFileSync(path.join(finalDir, 'final.mp4'), Buffer.alloc(1024 * 1024, 0x41));

    // Final render manifest
    fs.writeFileSync(
      path.join(metadataDir, 'final_render.json'),
      JSON.stringify({
        status: 'completed',
        projectId,
        relativeVideoPath: 'videos/final.mp4',
        durationSeconds: 15,
        width: 1080,
        height: 1920,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fileSizeBytes: 1024 * 1024,
      })
    );

    // Project JSON
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify({
        projectId,
        name: 'Test YouTube Project',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        slots: [],
        settings: {},
      })
    );

    return { projectDir, videoPath };
  }

  it('1. Performs full resumable upload lifecycle and emits progress events', async () => {
    const { projectDir } = await setupProjectWithVideo('p_yt_success');

    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Uploader Channel',
      externalChannelId: 'UC_TEST',
      externalChannelTitle: 'Uploader Studio',
      secrets: {
        clientId: 'cid',
        clientSecret: 'csec',
        accessToken: 'valid-access-token',
        tokenExpiryMs: Date.now() + 3600000,
      },
    });

    const progressEvents: PublishingProgressEvent[] = [];

    // Mock fetch for resumable upload:
    // Step 1: POST to initiate session -> returns 200 with Location header
    // Step 2: PUT chunk -> returns 200 with YouTube video resource
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('uploadType=resumable')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session-999',
          }),
        };
      }
      if (url.includes('upload_id=session-999')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'yt_video_12345',
            snippet: { title: 'Uploaded Video' },
            status: { privacyStatus: 'private' },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const metadata: YouTubePublishingMetadata = {
      title: 'Awesome AI Video',
      description: 'Created with Infinity Flow',
      tags: ['ai', 'flow'],
      privacyStatus: 'private',
    };

    const result = await YouTubePublishingProvider.publishVideo(
      {
        projectId: 'p_yt_success',
        publishingAccountId: account.id,
        metadata,
      },
      (ev) => progressEvents.push(ev)
    );

    expect(result.status).toBe('published');
    expect(result.platformVideoId).toBe('yt_video_12345');
    expect(result.publishedUrl).toBe('https://youtu.be/yt_video_12345');

    // Verify progress events were emitted
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.some((e) => e.stage === 'uploading')).toBe(true);
    expect(progressEvents[progressEvents.length - 1].status).toBe('published');
    expect(progressEvents[progressEvents.length - 1].percent).toBe(100);

    // Verify project.json was updated with publishing state
    const updatedProject = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
    expect(updatedProject.publishing.status).toBe('published');
    expect(updatedProject.publishing.platformVideoId).toBe('yt_video_12345');
  });

  it('2. Prevents duplicate uploads without forceRetry flag', async () => {
    const { projectDir } = await setupProjectWithVideo('p_yt_duplicate');

    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Dup Channel',
      externalChannelId: 'UC_DUP',
      externalChannelTitle: 'Dup Studio',
      secrets: { clientId: 'cid', accessToken: 'token' },
    });

    // Mark project as already published
    const projectPath = path.join(projectDir, 'project.json');
    const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    proj.publishing = {
      status: 'published',
      platformVideoId: 'existing_video_id',
      publishedUrl: 'https://youtu.be/existing_video_id',
      publishedAt: new Date().toISOString(),
    };
    fs.writeFileSync(projectPath, JSON.stringify(proj));

    const metadata: YouTubePublishingMetadata = {
      title: 'Duplicate Attempt',
      description: 'desc',
      tags: [],
      privacyStatus: 'private',
    };

    await expect(
      YouTubePublishingProvider.publishVideo({
        projectId: 'p_yt_duplicate',
        publishingAccountId: account.id,
        metadata,
        forceRetry: false,
      })
    ).rejects.toThrow(/already been published to YouTube/i);
  });

  it('3. Recovers interrupted upload via 308 Resume Incomplete status query', async () => {
    await setupProjectWithVideo('p_yt_resume');

    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Resume Channel',
      externalChannelId: 'UC_RESUME',
      externalChannelTitle: 'Resume Studio',
      secrets: { clientId: 'cid', accessToken: 'token' },
    });

    let chunkUploadAttempts = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('uploadType=resumable')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session-resume-1',
          }),
        };
      }
      if (url.includes('upload_id=session-resume-1')) {
        chunkUploadAttempts++;
        // First chunk fails/disconnects with 308 Range
        if (chunkUploadAttempts === 1) {
          return {
            ok: false,
            status: 308,
            headers: new Headers({
              range: 'bytes=0-524287', // Half uploaded (512KB)
            }),
          };
        }
        // Second attempt finishes the remaining bytes
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'recovered_yt_video_id',
            snippet: { title: 'Recovered Video' },
            status: { privacyStatus: 'unlisted' },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const metadata: YouTubePublishingMetadata = {
      title: 'Resumed Upload',
      description: 'desc',
      tags: ['resumed'],
      privacyStatus: 'unlisted',
    };

    const result = await YouTubePublishingProvider.publishVideo({
      projectId: 'p_yt_resume',
      publishingAccountId: account.id,
      metadata,
      forceRetry: true,
    });

    expect(result.status).toBe('published');
    expect(result.platformVideoId).toBe('recovered_yt_video_id');
  });

  it('4. Handles YouTube-native scheduled publishing', async () => {
    await setupProjectWithVideo('p_yt_scheduled');

    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Sched Channel',
      externalChannelId: 'UC_SCHED',
      externalChannelTitle: 'Sched Studio',
      secrets: { clientId: 'cid', accessToken: 'token' },
    });

    let capturedInitBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (url.includes('uploadType=resumable')) {
        capturedInitBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session-sched',
          }),
        };
      }
      if (url.includes('upload_id=session-sched')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'scheduled_video_id',
            snippet: { title: 'Scheduled' },
            status: { privacyStatus: 'private', publishAt: capturedInitBody?.status?.publishAt },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const targetDate = new Date(Date.now() + 86400000).toISOString();
    const metadata: YouTubePublishingMetadata = {
      title: 'Scheduled Release',
      description: 'Releasing tomorrow',
      tags: ['future'],
      privacyStatus: 'private',
      scheduledPublishAt: targetDate,
    };

    const result = await YouTubePublishingProvider.publishVideo({
      projectId: 'p_yt_scheduled',
      publishingAccountId: account.id,
      metadata,
    });

    expect(result.status).toBe('published');
    expect(capturedInitBody).not.toBeNull();
    // YouTube native schedule requires status.publishAt and status.privacyStatus='private'
    expect(capturedInitBody.status.publishAt).toBe(targetDate);
    expect(capturedInitBody.status.privacyStatus).toBe('private');
  });

  it('5. Maps Google API quota errors cleanly to user messages without quota circumvention', async () => {
    await setupProjectWithVideo('p_yt_quota');

    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Quota Channel',
      externalChannelId: 'UC_QUOTA',
      externalChannelTitle: 'Quota Studio',
      secrets: { clientId: 'cid', accessToken: 'token' },
    });

    const quotaResponsePayload = {
      error: {
        errors: [{ reason: 'quotaExceeded', message: 'The request cannot be completed because you have exceeded your quota.' }],
        code: 403,
        message: 'Quota Exceeded',
      },
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('uploadType=resumable')) {
        return {
          ok: false,
          status: 403,
          text: async () => JSON.stringify(quotaResponsePayload),
          json: async () => quotaResponsePayload,
        };
      }
      return { ok: false, status: 404 };
    });

    const metadata: YouTubePublishingMetadata = {
      title: 'Quota Exceeded Attempt',
      description: 'desc',
      tags: [],
      privacyStatus: 'private',
    };

    await expect(
      YouTubePublishingProvider.publishVideo({
        projectId: 'p_yt_quota',
        publishingAccountId: account.id,
        metadata,
      })
    ).rejects.toThrow(/YouTube API daily upload quota exceeded/i);
  });
});
