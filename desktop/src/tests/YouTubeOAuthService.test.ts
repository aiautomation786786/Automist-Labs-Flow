import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { YouTubeOAuthService } from '../main/publishing/YouTubeOAuthService';
import { PublishingAccountRepository } from '../main/publishing/PublishingAccountRepository';

describe('YouTubeOAuthService Unit Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;
  const originalFetch = global.fetch;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-yt-oauth-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    PublishingAccountRepository.clearCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    PublishingAccountRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    global.fetch = originalFetch;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('1. Constructs compliant YouTube OAuth URL with minimum required scopes', () => {
    const authUrl = YouTubeOAuthService.buildAuthUrl(
      'mock-client-id.apps.googleusercontent.com',
      'http://127.0.0.1:8989/oauth2callback',
      'state-12345'
    );

    const parsed = new URL(authUrl);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('accounts.google.com');
    expect(parsed.pathname).toBe('/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('mock-client-id.apps.googleusercontent.com');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8989/oauth2callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe('state-12345');

    const scopes = parsed.searchParams.get('scope') || '';
    expect(scopes).toContain('https://www.googleapis.com/auth/youtube.upload');
    expect(scopes).toContain('https://www.googleapis.com/auth/youtube.readonly');
  });

  it('2. Exchanges authorization code for tokens', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'ya29.new-access-token',
        refresh_token: '1//refresh-token-new',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    } as any);

    const tokens = await YouTubeOAuthService.exchangeCodeForTokens(
      'auth-code-xyz',
      'client-id-123',
      'secret-123',
      'http://127.0.0.1:8989/oauth2callback'
    );

    expect(tokens.accessToken).toBe('ya29.new-access-token');
    expect(tokens.refreshToken).toBe('1//refresh-token-new');
    expect(tokens.tokenExpiryMs).toBeGreaterThan(Date.now());
  });

  it('3. Refreshes expired access token using refresh token', async () => {
    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Refresh Test',
      externalChannelId: 'UC_REFRESH',
      externalChannelTitle: 'Refresh Title',
      secrets: {
        clientId: 'client-id-123',
        clientSecret: 'secret-123',
        refreshToken: '1//existing-refresh',
        accessToken: 'expired-access-token',
      },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'ya29.refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    } as any);

    const newAccessToken = await YouTubeOAuthService.refreshAccessToken(account.id);

    expect(newAccessToken).toBe('ya29.refreshed-token');

    // Verify stored access token was updated
    const decrypted = await PublishingAccountRepository.getDecryptedSecrets(account.id);
    expect(decrypted?.accessToken).toBe('ya29.refreshed-token');
  });

  it('4. Retrieves authenticated YouTube channel identity', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'UC_REAL_CHANNEL_ID',
            snippet: {
              title: 'Automist Labs Studio',
              customUrl: '@automistlabs',
              thumbnails: {
                default: { url: 'https://example.com/avatar.jpg' },
              },
            },
          },
        ],
      }),
    } as any);

    const channelInfo = await YouTubeOAuthService.fetchChannelIdentity('ya29.valid-token');
    expect(channelInfo.id).toBe('UC_REAL_CHANNEL_ID');
    expect(channelInfo.title).toBe('Automist Labs Studio');
    expect(channelInfo.avatarUrl).toBe('https://example.com/avatar.jpg');
  });

  it('5. Handles loopback auth timeout cleanly without leaks', async () => {
    await expect(
      YouTubeOAuthService.startLoopbackAuth(
        'mock-client-id',
        'mock-client-secret',
        { openBrowser: false, timeoutMs: 150 }
      )
    ).rejects.toThrow(/timed out/i);
  });
});
