import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChannelRepository } from '../main/storage/ChannelRepository';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import type { CreateChannelParams } from '../shared/types';

describe('ChannelRepository Unit & Safety Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-channel-repo-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    ChannelRepository.clearCache();
    ProjectRepository.clearCache();
  });

  afterEach(() => {
    ChannelRepository.clearCache();
    ProjectRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('1. Creates and persists a channel with unique ID and rulebook', async () => {
    const params: CreateChannelParams = {
      name: 'Deep Ocean Mysteries',
      description: 'Documentaries exploring the abyss',
      outputDir: path.join(tmpBaseDir, 'custom_output'),
      shortsOutputDir: path.join(tmpBaseDir, 'shorts_output'),
      longsOutputDir: path.join(tmpBaseDir, 'longs_output'),
      rulebook: {
        narrationStyle: 'Calm, authoritative documentary narration',
        visualStyle: 'Photorealistic deep sea photography with cinematic lighting',
        tone: 'Mysterious, informative, cinematic',
        contentRestrictions: 'No cartoon or low-resolution textures',
      },
      defaultAspectRatio: '16:9',
      defaultVoiceId: 'en-US-ChristopherNeural',
      defaultMotionStyle: 'slow_push_in',
      defaultTransitionStyle: 'cross_fade',
    };

    const channel = await ChannelRepository.create(params);

    expect(channel.id).toMatch(/^chan_/);
    expect(channel.name).toBe('Deep Ocean Mysteries');
    expect(channel.description).toBe('Documentaries exploring the abyss');
    expect(channel.rulebook?.narrationStyle).toContain('authoritative');
    expect(channel.defaultAspectRatio).toBe('16:9');
    expect(channel.enabled).toBe(true);
    expect(channel.stats.totalProjects).toBe(0);
    expect(channel.stats.deliveredVideos).toBe(0);

    // Verify disk persistence
    const reloaded = await ChannelRepository.get(channel.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.name).toBe('Deep Ocean Mysteries');
    expect(reloaded?.rulebook?.tone).toBe('Mysterious, informative, cinematic');
  });

  it('2. Enforces non-empty name validation', async () => {
    await expect(ChannelRepository.create({ name: '   ' })).rejects.toThrow('Channel name cannot be empty');
  });

  it('3. Enforces case-insensitive channel name uniqueness', async () => {
    await ChannelRepository.create({ name: 'Tech Radar' });

    await expect(ChannelRepository.create({ name: 'tech radar' })).rejects.toThrow(
      'Channel with name "tech radar" already exists'
    );
    await expect(ChannelRepository.create({ name: 'TECH RADAR' })).rejects.toThrow(
      'Channel with name "TECH RADAR" already exists'
    );
  });

  it('4. Retrieves channel by name case-insensitively', async () => {
    await ChannelRepository.create({ name: 'Ancient History' });

    const found = await ChannelRepository.getByName('ancient history');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Ancient History');

    const notFound = await ChannelRepository.getByName('Future Tech');
    expect(notFound).toBeNull();
  });

  it('5. Lists all channels sorted by creation date descending', async () => {
    const ch1 = await ChannelRepository.create({ name: 'Channel Alpha' });
    const ch2 = await ChannelRepository.create({ name: 'Channel Beta' });

    const all = await ChannelRepository.getAll();
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(ch2.id);
    expect(all[1].id).toBe(ch1.id);
  });

  it('6. Updates channel properties and rulebook atomically', async () => {
    const ch = await ChannelRepository.create({ name: 'Original Name' });

    const updated = await ChannelRepository.update(ch.id, {
      name: 'Updated Name',
      rulebook: {
        visualStyle: 'Hyper-detailed macro 8k',
      },
      defaultAspectRatio: '9:16',
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.rulebook?.visualStyle).toBe('Hyper-detailed macro 8k');
    expect(updated.defaultAspectRatio).toBe('9:16');

    // Verify cache eviction and disk reload
    ChannelRepository.clearCache();
    const diskReloaded = await ChannelRepository.get(ch.id);
    expect(diskReloaded?.name).toBe('Updated Name');
  });

  it('7. Prevents renaming channel to an already existing name', async () => {
    await ChannelRepository.create({ name: 'Alpha' });
    const beta = await ChannelRepository.create({ name: 'Beta' });

    await expect(ChannelRepository.update(beta.id, { name: 'ALPHA' })).rejects.toThrow(
      'Channel with name "ALPHA" already exists'
    );
  });

  it('8. Updates channel stats safely', async () => {
    const ch = await ChannelRepository.create({ name: 'Stats Channel' });
    expect(ch.stats.deliveredVideos).toBe(0);

    const updated = await ChannelRepository.updateStats(ch.id, {
      totalProjects: 5,
      deliveredVideos: 3,
      lastDeliveredAt: '2026-09-11T12:00:00.000Z',
    });

    expect(updated.stats.totalProjects).toBe(5);
    expect(updated.stats.deliveredVideos).toBe(3);
    expect(updated.stats.lastDeliveredAt).toBe('2026-09-11T12:00:00.000Z');
  });

  it('9. Safe channel deletion: unlinks associated projects without deleting them', async () => {
    const ch = await ChannelRepository.create({ name: 'Temporary Channel' });

    // Create 2 projects assigned to this channel
    const proj1 = await ProjectRepository.create({
      name: 'Project One',
      channelId: ch.id,
      channelName: ch.name,
      prompts: [{ text: 'Scene 1', type: 'image' }],
    });
    const proj2 = await ProjectRepository.create({
      name: 'Project Two',
      channelId: ch.id,
      channelName: ch.name,
      prompts: [{ text: 'Scene 2', type: 'image' }],
    });
    const projUnrelated = await ProjectRepository.create({
      name: 'Project Unrelated',
      prompts: [{ text: 'Scene 3', type: 'image' }],
    });

    expect(proj1.channelId).toBe(ch.id);
    expect(proj2.channelId).toBe(ch.id);
    expect(projUnrelated.channelId).toBeUndefined();

    // Delete the channel
    const delResult = await ChannelRepository.delete(ch.id);
    expect(delResult.success).toBe(true);
    expect(delResult.unassignedProjects).toBe(2);

    // Channel is gone
    const deletedChannel = await ChannelRepository.get(ch.id);
    expect(deletedChannel).toBeNull();

    // Verify projects are 100% intact, but unassigned!
    const reloaded1 = await ProjectRepository.get(proj1.projectId);
    expect(reloaded1).not.toBeNull();
    expect(reloaded1?.name).toBe('Project One');
    expect(reloaded1?.slots.length).toBe(1);
    expect(reloaded1?.channelId).toBeUndefined();
    expect(reloaded1?.channelName).toBeUndefined();

    const reloaded2 = await ProjectRepository.get(proj2.projectId);
    expect(reloaded2).not.toBeNull();
    expect(reloaded2?.name).toBe('Project Two');
    expect(reloaded2?.channelId).toBeUndefined();

    const reloadedUnrelated = await ProjectRepository.get(projUnrelated.projectId);
    expect(reloadedUnrelated).not.toBeNull();
    expect(reloadedUnrelated?.name).toBe('Project Unrelated');
  });
});
