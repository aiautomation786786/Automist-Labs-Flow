import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PublishingAccountRepository } from '../main/publishing/PublishingAccountRepository';
import { ChannelRepository } from '../main/storage/ChannelRepository';

describe('PublishingAccountRepository Unit & Encryption Tests', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pub-repo-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;
    PublishingAccountRepository.clearCache();
    ChannelRepository.clearCache();
  });

  afterEach(() => {
    PublishingAccountRepository.clearCache();
    ChannelRepository.clearCache();
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('1. Creates account with secure token encryption and sanitized getters', async () => {
    const created = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Test Creator',
      externalChannelId: 'UC1234567890',
      externalChannelTitle: 'My Test Channel',
      secrets: {
        clientId: 'google-client-id-123.apps.googleusercontent.com',
        clientSecret: 'super-secret-client-secret',
        refreshToken: '1//refresh-token-xyz',
        accessToken: 'ya29.access-token-abc',
        tokenExpiryMs: Date.now() + 3600000,
      },
    });

    expect(created.id).toBeDefined();
    expect(created.displayName).toBe('Test Creator');
    expect(created.externalChannelId).toBe('UC1234567890');
    expect(created.externalChannelTitle).toBe('My Test Channel');
    expect(created.hasClientSecret).toBe(true);

    // Sanitization invariant: returned object MUST NOT have secrets
    expect((created as any).secrets).toBeUndefined();
    expect((created as any).clientSecret).toBeUndefined();
    expect((created as any).refreshToken).toBeUndefined();
    expect((created as any).accessToken).toBeUndefined();

    // Verify sanitized get()
    const fetched = await PublishingAccountRepository.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect((fetched as any).secrets).toBeUndefined();

    // Verify sanitized getAll()
    const all = await PublishingAccountRepository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
    expect((all[0] as any).secrets).toBeUndefined();

    // Verify main-process only getDecryptedSecrets()
    const decrypted = await PublishingAccountRepository.getDecryptedSecrets(created.id);
    expect(decrypted).not.toBeNull();
    expect(decrypted?.clientId).toBe('google-client-id-123.apps.googleusercontent.com');
    expect(decrypted?.clientSecret).toBe('super-secret-client-secret');
    expect(decrypted?.refreshToken).toBe('1//refresh-token-xyz');
    expect(decrypted?.accessToken).toBe('ya29.access-token-abc');
  });

  it('2. Persists encrypted secrets at rest on disk', async () => {
    const created = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Persistence Test',
      externalChannelId: 'UC_PERSIST',
      externalChannelTitle: 'Persistence Channel',
      secrets: {
        clientId: 'client-id-persist',
        clientSecret: 'secret-plain',
        refreshToken: 'refresh-plain',
      },
    });

    // Inspect the raw files on disk
    const accountsPath = path.join(tmpBaseDir, 'GoogleFlowApp', 'publishing', 'accounts.json');
    const secretsPath = path.join(tmpBaseDir, 'GoogleFlowApp', 'publishing', 'secrets.json');
    expect(fs.existsSync(accountsPath)).toBe(true);
    expect(fs.existsSync(secretsPath)).toBe(true);

    const rawAccountsContent = fs.readFileSync(accountsPath, 'utf8');
    const rawSecretsContent = fs.readFileSync(secretsPath, 'utf8');

    // Neither file must contain plaintext secrets
    expect(rawAccountsContent).not.toContain('secret-plain');
    expect(rawAccountsContent).not.toContain('refresh-plain');
    expect(rawSecretsContent).not.toContain('secret-plain');
    expect(rawSecretsContent).not.toContain('refresh-plain');

    // secrets.json must contain encrypted ciphertext
    const parsedSecrets = JSON.parse(rawSecretsContent);
    expect(parsedSecrets[created.id].clientSecretEnc).toBeDefined();
    expect(parsedSecrets[created.id].refreshTokenEnc).toBeDefined();
  });

  it('3. Updates account metadata and tokens safely', async () => {
    const created = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Initial Name',
      externalChannelId: 'UC_UPDATE',
      externalChannelTitle: 'Initial Title',
      secrets: {
        clientId: 'client-update',
        refreshToken: 'initial-refresh',
        accessToken: 'initial-access',
      },
    });

    // Update tokens & metadata
    const updated = await PublishingAccountRepository.update(created.id, {
      displayName: 'Updated Name',
      totalPublishedCount: 5,
      lastPublishedAt: new Date().toISOString(),
      tokens: {
        accessToken: 'refreshed-access-token',
        tokenExpiryMs: Date.now() + 7200000,
      },
    });

    expect(updated?.displayName).toBe('Updated Name');
    expect(updated?.totalPublishedCount).toBe(5);

    const decrypted = await PublishingAccountRepository.getDecryptedSecrets(created.id);
    expect(decrypted?.accessToken).toBe('refreshed-access-token');
    expect(decrypted?.refreshToken).toBe('initial-refresh'); // Preserved
  });

  it('4. Cascade unlinks linked Channels when an account is deleted', async () => {
    const account = await PublishingAccountRepository.create({
      platform: 'youtube',
      displayName: 'Cascade Test',
      externalChannelId: 'UC_CASCADE',
      externalChannelTitle: 'Cascade Channel',
      secrets: { clientId: 'cid' },
    });

    // Create a Flow Content Channel linked to this account
    const channel1 = await ChannelRepository.create({
      name: 'Flow Channel 1',
      linkedPublishingAccountId: account.id,
    });
    const channel2 = await ChannelRepository.create({
      name: 'Flow Channel 2',
      linkedPublishingAccountId: account.id,
    });

    expect(channel1.linkedPublishingAccountId).toBe(account.id);
    expect(channel2.linkedPublishingAccountId).toBe(account.id);

    // Delete the publishing account
    const deleteRes = await PublishingAccountRepository.delete(account.id);
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.unlinkedChannels).toBe(2);

    // Verify account is removed
    const fetched = await PublishingAccountRepository.get(account.id);
    expect(fetched).toBeNull();

    // Verify both channels were cascade unlinked
    const updatedCh1 = await ChannelRepository.get(channel1.id);
    const updatedCh2 = await ChannelRepository.get(channel2.id);
    expect(updatedCh1?.linkedPublishingAccountId).toBeUndefined();
    expect(updatedCh2?.linkedPublishingAccountId).toBeUndefined();
  });
});
