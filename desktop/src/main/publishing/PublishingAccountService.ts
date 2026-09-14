/**
 * PublishingAccountService – Central coordinator for publishing accounts,
 * Content Channel linking, and video publishing dispatch.
 *
 * Guarantees:
 *  1. Clean Abstraction: Mediates between IPC, Content Channels, and platform providers.
 *  2. Zero Secret Leaks: Strictly returns sanitized account entities without tokens.
 *  3. Default Account Resolution: Automatically resolves a Content Channel's linked account
 *     if publishingAccountId is not explicitly passed by the caller.
 */

import type {
  PublishingAccountEntity,
  YouTubePublishingMetadata,
  ProjectPublishingState,
  PublishingProgressEvent,
  ChannelEntity,
} from '../../shared/types';
import { PublishingAccountRepository } from './PublishingAccountRepository';
import { YouTubeOAuthService } from './YouTubeOAuthService';
import { YouTubePublishingProvider } from './YouTubePublishingProvider';
import { ChannelRepository } from '../storage/ChannelRepository';
import { ProjectRepository } from '../storage/ProjectRepository';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export class PublishingAccountService {
  /**
   * Lists all connected publishing accounts in sanitized format.
   */
  static async listAccounts(): Promise<PublishingAccountEntity[]> {
    return await PublishingAccountRepository.getAll();
  }

  /**
   * Retrieves a single publishing account by ID in sanitized format.
   */
  static async getAccount(id: string): Promise<PublishingAccountEntity | null> {
    return await PublishingAccountRepository.get(id);
  }

  /**
   * Connects a new YouTube publishing account via loopback OAuth 2.0 flow.
   */
  static async connectYouTubeAccount(params: {
    clientId: string;
    clientSecret: string;
    timeoutMs?: number;
    openBrowser?: boolean;
  }): Promise<PublishingAccountEntity> {
    return await YouTubeOAuthService.startLoopbackAuth(
      params.clientId,
      params.clientSecret,
      {
        timeoutMs: params.timeoutMs,
        openBrowser: params.openBrowser,
      }
    );
  }

  /**
   * Disconnects a publishing account and cleans up channel links.
   */
  static async disconnectAccount(id: string): Promise<{ success: boolean; unlinkedChannels: number }> {
    return await PublishingAccountRepository.delete(id);
  }

  /**
   * Links or unlinks a Content Channel to/from a Publishing Account.
   */
  static async linkChannel(channelId: string, publishingAccountId?: string): Promise<ChannelEntity> {
    const channel = await ChannelRepository.get(channelId);
    if (!channel) {
      throw new Error(`Content channel not found: ${channelId}`);
    }

    if (publishingAccountId) {
      const account = await PublishingAccountRepository.get(publishingAccountId);
      if (!account) {
        throw new Error(`Publishing account not found: ${publishingAccountId}`);
      }

      // Update channel with link
      const updatedChannel = await ChannelRepository.update(channelId, {
        linkedPublishingAccountId: publishingAccountId,
      });

      // Update account's linked channel list
      const linked = new Set(account.linkedChannelIds || []);
      linked.add(channelId);
      await PublishingAccountRepository.setLinkedChannels(publishingAccountId, Array.from(linked));

      logger.info('publishing_service', 'Linked channel to publishing account', {
        channelId,
        channelName: channel.name,
        publishingAccountId,
      });

      return updatedChannel;
    } else {
      // Unlink
      const prevAccountId = channel.linkedPublishingAccountId;
      const updatedChannel = await ChannelRepository.update(channelId, {
        linkedPublishingAccountId: undefined,
      });

      if (prevAccountId) {
        const prevAcc = await PublishingAccountRepository.get(prevAccountId);
        if (prevAcc) {
          const linked = (prevAcc.linkedChannelIds || []).filter((id) => id !== channelId);
          await PublishingAccountRepository.setLinkedChannels(prevAccountId, linked);
        }
      }

      logger.info('publishing_service', 'Unlinked channel from publishing account', { channelId });
      return updatedChannel;
    }
  }

  /**
   * Publishes a project video to YouTube.
   */
  static async publishProject(
    params: {
      projectId: string;
      publishingAccountId?: string;
      metadata: YouTubePublishingMetadata;
      forceRetry?: boolean;
    },
    onProgress?: (event: PublishingProgressEvent) => void
  ): Promise<ProjectPublishingState> {
    const project = await ProjectRepository.get(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }

    // Resolve target account: Explicit param -> Linked Channel Account -> First Connected Account
    let accountId = params.publishingAccountId;
    if (!accountId && project.channelId) {
      const channel = await ChannelRepository.get(project.channelId);
      if (channel?.linkedPublishingAccountId) {
        accountId = channel.linkedPublishingAccountId;
      }
    }

    if (!accountId) {
      const allAccounts = await PublishingAccountRepository.getAll();
      if (allAccounts.length === 1) {
        accountId = allAccounts[0].id;
      } else if (allAccounts.length === 0) {
        throw new Error('No YouTube publishing accounts are connected. Please connect an account first.');
      } else {
        throw new Error('Multiple publishing accounts are connected. Please select which account to publish to.');
      }
    }

    return await YouTubePublishingProvider.publishVideo(
      {
        projectId: params.projectId,
        publishingAccountId: accountId,
        metadata: params.metadata,
        forceRetry: params.forceRetry,
      },
      onProgress
    );
  }

  /**
   * Cancels in-flight publishing for a project.
   */
  static async cancelPublishing(projectId: string): Promise<void> {
    YouTubePublishingProvider.cancel(projectId);
  }

  /**
   * Retrieves current publishing state for a project.
   */
  static async getProjectPublishingState(projectId: string): Promise<ProjectPublishingState | null> {
    const project = await ProjectRepository.get(projectId);
    return project?.publishing || null;
  }
}
