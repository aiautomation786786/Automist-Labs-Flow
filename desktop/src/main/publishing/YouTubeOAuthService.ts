/**
 * YouTubeOAuthService – Loopback Google OAuth 2.0 desktop authentication
 * and token management for YouTube Data API v3.
 *
 * Guarantees:
 *  1. Ephemeral Loopback: Binds to 127.0.0.1 on a dynamic port, handles callback, and immediately shuts down.
 *  2. Minimum Necessary Scopes: Requests youtube.upload and youtube.readonly (for channel identity verification).
 *  3. Encrypted Credentials: All refresh and access tokens are strictly encrypted at rest via PublishingAccountRepository.
 *  4. Automated Token Refresh: Refreshes access tokens transparently before expiration.
 *  5. Authentic Channel Identity: Queries YouTube channels.list(mine=true) to retrieve real YouTube channel details.
 */

import * as http from 'http';
import * as url from 'url';
import { shell } from 'electron';
import type { PublishingAccountEntity } from '../../shared/types';
import { PublishingAccountRepository } from './PublishingAccountRepository';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export interface OAuthEndpoints {
  authUrl: string;
  tokenUrl: string;
  channelsUrl: string;
}

export const DEFAULT_ENDPOINTS: OAuthEndpoints = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  channelsUrl: 'https://www.googleapis.com/youtube/v3/channels',
};

export class YouTubeOAuthService {
  private static endpoints: OAuthEndpoints = { ...DEFAULT_ENDPOINTS };
  private static customHttpFetch?: typeof fetch;

  static setCustomEndpoints(custom: Partial<OAuthEndpoints> | null): void {
    if (!custom) {
      this.endpoints = { ...DEFAULT_ENDPOINTS };
    } else {
      this.endpoints = { ...this.endpoints, ...custom };
    }
  }

  static setCustomFetch(customFetch?: typeof fetch): void {
    this.customHttpFetch = customFetch;
  }

  private static async doFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.customHttpFetch) {
      return this.customHttpFetch(input, init);
    }
    return fetch(input, init);
  }

  /**
   * Generates authorization URL for Google OAuth consent.
   */
  static buildAuthUrl(clientId: string, redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    if (state) {
      params.set('state', state);
    }
    return `${this.endpoints.authUrl}?${params.toString()}`;
  }

  /**
   * Executes loopback OAuth 2.0 flow for desktop.
   * Starts a local loopback server, launches system browser, listens for code callback,
   * exchanges code for tokens, retrieves YouTube channel identity, and persists encrypted credentials.
   */
  static async startLoopbackAuth(
    clientId: string,
    clientSecret: string,
    options: { timeoutMs?: number; openBrowser?: boolean } = {}
  ): Promise<PublishingAccountEntity> {
    const trimmedClientId = clientId.trim();
    const trimmedClientSecret = clientSecret.trim();

    if (!trimmedClientId) {
      throw new Error('Google OAuth Client ID is required');
    }
    if (!trimmedClientSecret) {
      throw new Error('Google OAuth Client Secret is required');
    }

    const timeoutMs = options.timeoutMs ?? 180000; // 3 minutes default
    const shouldOpenBrowser = options.openBrowser ?? true;

    return new Promise((resolve, reject) => {
      let server: http.Server | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;
      let isSettled = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (server) {
          try {
            (server as any).closeAllConnections?.();
            server.close();
            server.unref();
          } catch {}
          server = null;
        }
      };

      const fail = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        logger.error('youtube_oauth', 'OAuth authorization failed', err);
        reject(err);
      };

      const succeed = (account: PublishingAccountEntity) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        logger.info('youtube_oauth', 'OAuth authorization succeeded', { accountId: account.id, title: account.externalChannelTitle });
        resolve(account);
      };

      // 1. Create loopback server on ephemeral port (127.0.0.1:0)
      server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url || '', true);
          const pathname = reqUrl.pathname || '/';

          if (pathname !== '/' && pathname !== '/oauth2callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }

          const query = reqUrl.query;
          if (query.error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f87171; text-align: center; padding-top: 60px;">
                  <h2>Authentication Cancelled or Failed</h2>
                  <p style="color: #94a3b8;">${String(query.error_description || query.error)}</p>
                  <p style="color: #64748b; font-size: 13px;">You may close this tab and return to Infinity Flow.</p>
                </body>
              </html>
            `);
            fail(new Error(`OAuth Error: ${String(query.error_description || query.error)}`));
            return;
          }

          const code = query.code as string;
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing code parameter');
            return;
          }

          // Render friendly success page
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding-top: 60px;">
                <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
                <h2 style="color: #10b981; margin-bottom: 8px;">YouTube Account Connected!</h2>
                <p style="color: #94a3b8; font-size: 15px;">Authorization completed successfully.</p>
                <p style="color: #64748b; font-size: 13px; margin-top: 24px;">You can now safely close this browser window and return to Infinity Flow.</p>
              </body>
            </html>
          `);

          // Exchange authorization code for tokens
          const address = server?.address() as { port: number };
          const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;

          const tokens = await YouTubeOAuthService.exchangeCodeForTokens(
            code,
            trimmedClientId,
            trimmedClientSecret,
            redirectUri
          );

          // Retrieve genuine YouTube channel identity
          const channelInfo = await YouTubeOAuthService.fetchChannelIdentity(tokens.accessToken);

          // Persist account and encrypted secrets
          const account = await PublishingAccountRepository.create(
            {
              id: `pub_yt_${channelInfo.id}`,
              platform: 'youtube',
              displayName: channelInfo.title,
              externalChannelId: channelInfo.id,
              externalChannelTitle: channelInfo.title,
              avatarUrl: channelInfo.avatarUrl,
              status: 'connected',
              linkedChannelIds: [],
            },
            {
              clientId: trimmedClientId,
              clientSecret: trimmedClientSecret,
              refreshToken: tokens.refreshToken,
              accessToken: tokens.accessToken,
              tokenExpiryMs: tokens.tokenExpiryMs,
            }
          );

          succeed(account);
        } catch (err: any) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server?.address() as { port: number };
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
        const authUrl = YouTubeOAuthService.buildAuthUrl(trimmedClientId, redirectUri);

        logger.info('youtube_oauth', 'Loopback server listening', { port: address.port });

        if (shouldOpenBrowser) {
          shell.openExternal(authUrl).catch((err) => {
            fail(new Error(`Failed to open system browser: ${err.message}`));
          });
        }
      });

      server.on('error', (err) => {
        fail(new Error(`Loopback server error: ${err.message}`));
      });

      timeoutHandle = setTimeout(() => {
        fail(new Error('OAuth authorization timed out. Please try again.'));
      }, timeoutMs);
    });
  }

  /**
   * Exchanges an authorization code for refresh and access tokens.
   */
  static async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenExpiryMs: number;
    tokenType: string;
  }> {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await this.doFetch(this.endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorMsg = (data.error_description || data.error || 'Failed to exchange authorization code') as string;
      throw new Error(`Google OAuth token exchange failed (${response.status}): ${errorMsg}`);
    }

    const accessToken = data.access_token as string;
    const refreshToken = (data.refresh_token as string) || '';
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    const tokenType = (data.token_type as string) || 'Bearer';

    if (!accessToken) {
      throw new Error('No access_token returned by Google token endpoint');
    }

    return {
      accessToken,
      refreshToken,
      tokenExpiryMs: Date.now() + expiresIn * 1000,
      tokenType,
    };
  }

  /**
   * Fetches genuine YouTube channel identity using the authorized access token.
   */
  static async fetchChannelIdentity(accessToken: string): Promise<{
    id: string;
    title: string;
    avatarUrl?: string;
  }> {
    const targetUrl = `${this.endpoints.channelsUrl}?part=snippet&mine=true`;
    const response = await this.doFetch(targetUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorObj = data.error as Record<string, unknown> | undefined;
      const message = errorObj?.message || 'Failed to fetch YouTube channel details';
      throw new Error(`YouTube API channels.list failed (${response.status}): ${message}`);
    }

    const items = data.items as Array<Record<string, unknown>> | undefined;
    if (!items || items.length === 0) {
      throw new Error(
        'No YouTube channel was found associated with this Google Account. Please create a YouTube channel on youtube.com first.'
      );
    }

    const first = items[0];
    const id = first.id as string;
    const snippet = (first.snippet as Record<string, unknown>) || {};
    const title = (snippet.title as string) || 'YouTube Channel';
    const thumbnails = (snippet.thumbnails as Record<string, unknown>) || {};
    const defaultThumb = (thumbnails.default as Record<string, unknown>) || {};
    const avatarUrl = defaultThumb.url as string | undefined;

    return { id, title, avatarUrl };
  }

  /**
   * Refreshes an expired access token using the stored refresh token.
   */
  static async refreshAccessToken(accountId: string): Promise<string> {
    const secrets = await PublishingAccountRepository.getDecryptedSecrets(accountId);
    if (!secrets) {
      throw new Error(`Account credentials not found for ${accountId}`);
    }

    if (!secrets.refreshToken) {
      await PublishingAccountRepository.updateStats(accountId, { status: 'expired' });
      throw new Error('No refresh token available. Please reconnect your YouTube account.');
    }

    if (!secrets.clientSecret) {
      throw new Error('OAuth Client Secret is missing for this publishing account');
    }

    const body = new URLSearchParams({
      client_id: secrets.clientId,
      client_secret: secrets.clientSecret,
      refresh_token: secrets.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await this.doFetch(this.endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorMsg = (data.error_description || data.error || 'Token refresh failed') as string;
      if (data.error === 'invalid_grant') {
        await PublishingAccountRepository.updateStats(accountId, { status: 'revoked' });
      }
      throw new Error(`Google OAuth token refresh failed (${response.status}): ${errorMsg}`);
    }

    const newAccessToken = data.access_token as string;
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    const newRefreshToken = (data.refresh_token as string) || undefined;

    await PublishingAccountRepository.updateTokens(accountId, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenExpiryMs: Date.now() + expiresIn * 1000,
    });

    return newAccessToken;
  }

  /**
   * Returns a valid access token, refreshing automatically if close to expiration.
   */
  static async getValidAccessToken(accountId: string): Promise<string> {
    const secrets = await PublishingAccountRepository.getDecryptedSecrets(accountId);
    if (!secrets) {
      throw new Error(`Account credentials not found for ${accountId}`);
    }

    const BUFFER_MS = 60000; // 60s buffer
    const now = Date.now();

    if (secrets.accessToken) {
      if (secrets.tokenExpiryMs && secrets.tokenExpiryMs - now > BUFFER_MS) {
        return secrets.accessToken;
      }
      if (!secrets.refreshToken) {
        return secrets.accessToken;
      }
    }

    return await this.refreshAccessToken(accountId);
  }
}
