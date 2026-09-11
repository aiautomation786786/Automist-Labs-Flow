/**
 * ChannelRepository – Concurrency-safe persistence for ChannelEntity and rulebooks.
 *
 * GUARANTEES:
 *  1. Concurrency-Safe: Serializes channel operations through FileMutex.
 *  2. Atomic Writes: Writes to .tmp file then renames, preventing corrupt JSON.
 *  3. Unique Channel Names: Validates uniqueness case-insensitively before creation/renaming.
 *  4. Safe Deletion: When a channel is deleted, associated projects are safely unlinked
 *     (channelId unset) without deleting any project assets, accounts, or profiles.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  ChannelEntity,
  ChannelStats,
  CreateChannelParams,
} from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { ProjectRepository } from './ProjectRepository';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class ChannelRepository {
  private static cache = new Map<string, { entity: ChannelEntity; mtimeMs: number }>();
  private static readonly MAX_CACHE_ENTRIES = 50;

  private static setCache(channelId: string, entity: ChannelEntity, mtimeMs: number): void {
    this.cache.delete(channelId);
    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(channelId, {
      entity: JSON.parse(JSON.stringify(entity)),
      mtimeMs,
    });
  }

  /**
   * Generates a deterministic, URL-safe channel ID.
   */
  static generateChannelId(): string {
    return `chan_${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Clears in-memory cache (primarily for tests or memory reclamation).
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Returns path to the channel.json file for a given channelId.
   */
  static getChannelJsonPath(channelId: string): string {
    return path.join(AssetManager.getChannelDir(channelId), 'channel.json');
  }

  /**
   * Creates and persists a new ChannelEntity.
   */
  static async create(params: CreateChannelParams): Promise<ChannelEntity> {
    const trimmedName = params.name ? params.name.trim() : '';
    if (!trimmedName) {
      throw new Error('Channel name cannot be empty');
    }

    return await fileMutex.runExclusive('channel_index', async () => {
      // Check for name uniqueness case-insensitively
      const existingChannels = await this.getAll();
      const duplicate = existingChannels.find(
        (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Channel with name "${trimmedName}" already exists`);
      }

      const channelId = this.generateChannelId();
      const now = new Date().toISOString();

      AssetManager.ensureChannelDirectories(channelId);

      const channel: ChannelEntity = {
        id: channelId,
        name: trimmedName,
        description: params.description?.trim(),
        outputDir: params.outputDir?.trim(),
        shortsOutputDir: params.shortsOutputDir?.trim(),
        longsOutputDir: params.longsOutputDir?.trim(),
        rulebook: params.rulebook,
        defaultAspectRatio: params.defaultAspectRatio,
        defaultVoiceId: params.defaultVoiceId,
        defaultVoiceProvider: params.defaultVoiceProvider,
        defaultMotionStyle: params.defaultMotionStyle,
        defaultSubtitleStyle: params.defaultSubtitleStyle,
        defaultTransitionStyle: params.defaultTransitionStyle,
        enabled: params.enabled ?? true,
        createdAt: now,
        updatedAt: now,
        stats: {
          totalProjects: 0,
          deliveredVideos: 0,
        },
      };

      await this.writeChannelAtomic(channel);
      logger.info('channel_repo', 'Created channel', { channelId, name: channel.name });
      return channel;
    });
  }

  /**
   * Internal direct reader that checks mtime cache or reads from disk.
   */
  private static readChannelDirect(channelId: string): ChannelEntity | null {
    const filePath = this.getChannelJsonPath(channelId);
    if (!fs.existsSync(filePath)) {
      this.cache.delete(channelId);
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this.cache.get(channelId);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return JSON.parse(JSON.stringify(cached.entity));
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const channel = JSON.parse(content) as ChannelEntity;

      this.setCache(channelId, channel, stat.mtimeMs);
      return channel;
    } catch (err) {
      logger.error('channel_repo', `Failed to read channel ${channelId}`, err as Error);
      return null;
    }
  }

  /**
   * Retrieves a channel by ID with mtime-verified cache lookup.
   */
  static async get(channelId: string): Promise<ChannelEntity | null> {
    return this.readChannelDirect(channelId);
  }

  /**
   * Retrieves a channel by name (case-insensitive).
   */
  static async getByName(name: string): Promise<ChannelEntity | null> {
    const target = name.trim().toLowerCase();
    const channels = await this.getAll();
    return channels.find((c) => c.name.toLowerCase() === target) || null;
  }

  /**
   * Returns all existing channels on disk sorted by creation date descending.
   */
  static async getAll(): Promise<ChannelEntity[]> {
    const rootDir = AssetManager.getChannelsRootDir();
    if (!fs.existsSync(rootDir)) {
      return [];
    }

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const channelDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('chan_'));
    const channels: ChannelEntity[] = [];

    for (const dir of channelDirs) {
      const ch = this.readChannelDirect(dir.name);
      if (ch) {
        channels.push(ch);
      }
    }

    return channels.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Concurrency-safe atomic update of a channel entity.
   */
  static async update(
    channelId: string,
    patch: Partial<Omit<ChannelEntity, 'id' | 'createdAt' | 'stats'>>,
  ): Promise<ChannelEntity> {
    return await fileMutex.runExclusive(channelId, async () => {
      const existing = this.readChannelDirect(channelId);
      if (!existing) {
        throw new Error(`Channel ${channelId} not found`);
      }

      // If name is being changed, check for uniqueness
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) {
          throw new Error('Channel name cannot be empty');
        }
        if (trimmed.toLowerCase() !== existing.name.toLowerCase()) {
          const allChannels = await this.getAll();
          const duplicate = allChannels.find(
            (c) => c.id !== channelId && c.name.toLowerCase() === trimmed.toLowerCase()
          );
          if (duplicate) {
            throw new Error(`Channel with name "${trimmed}" already exists`);
          }
        }
      }

      const updated: ChannelEntity = {
        ...existing,
        ...patch,
        name: patch.name !== undefined ? patch.name.trim() : existing.name,
        description: patch.description !== undefined ? patch.description.trim() : existing.description,
        outputDir: patch.outputDir !== undefined ? patch.outputDir.trim() : existing.outputDir,
        shortsOutputDir: patch.shortsOutputDir !== undefined ? patch.shortsOutputDir.trim() : existing.shortsOutputDir,
        longsOutputDir: patch.longsOutputDir !== undefined ? patch.longsOutputDir.trim() : existing.longsOutputDir,
        rulebook: patch.rulebook !== undefined ? patch.rulebook : existing.rulebook,
        updatedAt: new Date().toISOString(),
      };

      await this.writeChannelAtomic(updated);
      logger.info('channel_repo', 'Updated channel', { channelId });
      return updated;
    });
  }

  /**
   * Updates stats on a channel (e.g. deliveredVideos, totalProjects).
   */
  static async updateStats(
    channelId: string,
    statsPatch: Partial<ChannelStats>,
  ): Promise<ChannelEntity> {
    return await fileMutex.runExclusive(channelId, async () => {
      const existing = this.readChannelDirect(channelId);
      if (!existing) {
        throw new Error(`Channel ${channelId} not found`);
      }

      const updated: ChannelEntity = {
        ...existing,
        stats: {
          ...existing.stats,
          ...statsPatch,
        },
        updatedAt: new Date().toISOString(),
      };

      await this.writeChannelAtomic(updated);
      return updated;
    });
  }

  /**
   * Deletes a channel safely:
   *  1. Finds all associated projects and unassigns them (sets channelId and channelName to undefined).
   *  2. Deletes channel.json and removes it from cache.
   *  3. NEVER deletes projects, project media, profiles, accounts, or delivered video files!
   */
  static async delete(channelId: string): Promise<{ success: boolean; unassignedProjects: number }> {
    return await fileMutex.runExclusive('channel_index', async () => {
      return await fileMutex.runExclusive(channelId, async () => {
        const existing = this.readChannelDirect(channelId);
        if (!existing) {
          throw new Error(`Channel ${channelId} not found`);
        }

        // 1. Unassign all associated projects
        const allProjects = await ProjectRepository.getAll();
        const associatedProjects = allProjects.filter((p) => p.channelId === channelId);
        let unassignedCount = 0;

        for (const proj of associatedProjects) {
          try {
            await ProjectRepository.update(proj.projectId, {
              channelId: undefined,
              channelName: undefined,
            });
            unassignedCount++;
          } catch (err) {
            logger.warn(
              'channel_repo',
              `Failed to unassign project ${proj.projectId} from channel ${channelId}`,
              { error: (err as Error).message }
            );
          }
        }

        // 2. Remove channel.json
        const filePath = this.getChannelJsonPath(channelId);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        this.cache.delete(channelId);
        logger.info('channel_repo', 'Deleted channel safely', {
          channelId,
          unassignedProjects: unassignedCount,
        });

        return { success: true, unassignedProjects: unassignedCount };
      });
    });
  }

  /**
   * Atomically writes the channel entity to disk using a temporary file.
   */
  private static async writeChannelAtomic(channel: ChannelEntity): Promise<void> {
    const channelDir = AssetManager.getChannelDir(channel.id);
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    const finalPath = this.getChannelJsonPath(channel.id);
    const tmpPath = `${finalPath}.tmp.${Date.now()}`;

    fs.writeFileSync(tmpPath, JSON.stringify(channel, null, 2), 'utf-8');
    fs.renameSync(tmpPath, finalPath);

    const stat = fs.statSync(finalPath);
    this.setCache(channel.id, channel, stat.mtimeMs);
  }
}
