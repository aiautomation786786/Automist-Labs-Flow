import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChannelHistoryRepository } from '../main/storage/ChannelHistoryRepository';
import type { DeliveryHistoryRecord } from '../shared/types';

describe('ChannelHistoryRepository Unit Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-history-repo-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    ChannelHistoryRepository.clearCache();
  });

  afterEach(async () => {
    ChannelHistoryRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('1. Records and retrieves delivery records with automatic ID and timestamp', async () => {
    const record = await ChannelHistoryRepository.record({
      projectId: 'proj_abc123',
      projectName: 'Deep Ocean Trench',
      channelId: 'chan_xyz789',
      channelName: 'Ocean Documentaries',
      sourceVideoPath: '/path/to/final.mp4',
      deliveredVideoPath: '/path/to/delivered/deep_ocean_trench.mp4',
      deliveredThumbnailPath: '/path/to/delivered/deep_ocean_trench-thumbnail.jpg',
      aspectRatio: '16:9',
      durationSeconds: 24.5,
      fileSizeBytes: 10485760,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
    });

    expect(record.id).toMatch(/^deliv_/);
    expect(record.deliveredAt).toBeDefined();
    expect(record.status).toBe('delivered');

    // Retrieve by ID
    const fetched = await ChannelHistoryRepository.getById(record.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.projectName).toBe('Deep Ocean Trench');
    expect(fetched?.durationSeconds).toBe(24.5);
  });

  it('2. Records failed delivery with error message', async () => {
    const failed = await ChannelHistoryRepository.record({
      projectId: 'proj_fail',
      projectName: 'Failed Video',
      channelId: 'chan_fail',
      channelName: 'Test Channel',
      sourceVideoPath: '/missing/final.mp4',
      deliveredVideoPath: '',
      aspectRatio: '9:16',
      durationSeconds: 0,
      fileSizeBytes: 0,
      videoCodec: 'none',
      audioCodec: 'none',
      status: 'failed',
      error: 'Final video not found on disk',
    });

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Final video not found on disk');

    const result = await ChannelHistoryRepository.query({ status: 'failed' });
    expect(result.total).toBe(1);
    expect(result.records[0].projectName).toBe('Failed Video');
  });

  it('3. Filters delivery history by channelId', async () => {
    await ChannelHistoryRepository.record({
      projectId: 'p1',
      projectName: 'Video One',
      channelId: 'chan_A',
      channelName: 'Channel A',
      sourceVideoPath: '/src1',
      deliveredVideoPath: '/dst1',
      aspectRatio: '16:9',
      durationSeconds: 10,
      fileSizeBytes: 1000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
    });

    await ChannelHistoryRepository.record({
      projectId: 'p2',
      projectName: 'Video Two',
      channelId: 'chan_B',
      channelName: 'Channel B',
      sourceVideoPath: '/src2',
      deliveredVideoPath: '/dst2',
      aspectRatio: '16:9',
      durationSeconds: 15,
      fileSizeBytes: 1500,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
    });

    const chAResult = await ChannelHistoryRepository.query({ channelId: 'chan_A' });
    expect(chAResult.total).toBe(1);
    expect(chAResult.records[0].channelName).toBe('Channel A');

    const chBResult = await ChannelHistoryRepository.query({ channelId: 'chan_B' });
    expect(chBResult.total).toBe(1);
    expect(chBResult.records[0].channelName).toBe('Channel B');
  });

  it('4. Searches delivery history by query string across name and paths', async () => {
    await ChannelHistoryRepository.record({
      projectId: 'p1',
      projectName: 'Supermassive Black Hole',
      channelId: 'c1',
      channelName: 'Cosmos',
      sourceVideoPath: '/src1',
      deliveredVideoPath: '/dst/supermassive_black_hole.mp4',
      aspectRatio: '16:9',
      durationSeconds: 12,
      fileSizeBytes: 2000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
    });

    await ChannelHistoryRepository.record({
      projectId: 'p2',
      projectName: 'Quantum Computing 101',
      channelId: 'c2',
      channelName: 'Tech Today',
      sourceVideoPath: '/src2',
      deliveredVideoPath: '/dst/quantum_computing.mp4',
      aspectRatio: '16:9',
      durationSeconds: 14,
      fileSizeBytes: 2500,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
    });

    const searchCosmos = await ChannelHistoryRepository.query({ searchQuery: 'cosmos' });
    expect(searchCosmos.total).toBe(1);
    expect(searchCosmos.records[0].projectName).toBe('Supermassive Black Hole');

    const searchQuantum = await ChannelHistoryRepository.query({ searchQuery: 'quantum' });
    expect(searchQuantum.total).toBe(1);
    expect(searchQuantum.records[0].channelName).toBe('Tech Today');
  });

  it('5. Paginates query results with limit and offset', async () => {
    for (let i = 1; i <= 10; i++) {
      await ChannelHistoryRepository.record({
        projectId: `p_${i}`,
        projectName: `Video ${i}`,
        channelId: 'c_common',
        channelName: 'Common Channel',
        sourceVideoPath: `/src/${i}`,
        deliveredVideoPath: `/dst/${i}.mp4`,
        aspectRatio: '16:9',
        durationSeconds: 10,
        fileSizeBytes: 1000,
        videoCodec: 'h264',
        audioCodec: 'aac',
        status: 'delivered',
      });
    }

    const page1 = await ChannelHistoryRepository.query({ limit: 4, offset: 0 });
    expect(page1.total).toBe(10);
    expect(page1.records.length).toBe(4);
    // unshift means latest is first (Video 10, 9, 8, 7)
    expect(page1.records[0].projectName).toBe('Video 10');

    const page2 = await ChannelHistoryRepository.query({ limit: 4, offset: 4 });
    expect(page2.records.length).toBe(4);
    expect(page2.records[0].projectName).toBe('Video 6');

    const page3 = await ChannelHistoryRepository.query({ limit: 4, offset: 8 });
    expect(page3.records.length).toBe(2);
    expect(page3.records[0].projectName).toBe('Video 2');
    expect(page3.records[1].projectName).toBe('Video 1');
  });

  it('6. Clears delivery history completely', async () => {
    await ChannelHistoryRepository.record({
      projectId: 'p_clear',
      projectName: 'To Clear',
      channelId: 'c_clear',
      channelName: 'Clear Channel',
      sourceVideoPath: '/src',
      deliveredVideoPath: '/dst',
      aspectRatio: '16:9',
      durationSeconds: 5,
      fileSizeBytes: 500,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
    });

    expect((await ChannelHistoryRepository.query()).total).toBe(1);
    await ChannelHistoryRepository.clear();
    expect((await ChannelHistoryRepository.query()).total).toBe(0);
  });
});
