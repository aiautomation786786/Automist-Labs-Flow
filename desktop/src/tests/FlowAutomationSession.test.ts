/**
 * Tests for FlowAutomationSession.
 *
 * Verifies profile binding, multi-profile isolation, and operation delegation.
 */

import { describe, it, expect, vi } from 'vitest';
import { FlowAutomationSession } from '../main/engine/FlowAutomationSession';
import { ProfileSession } from '../main/engine/ProfileSession';
import type { ProfileConfig } from '../shared/types';

function createMockProfileConfig(id: string): ProfileConfig {
  return {
    profileId: id,
    displayName: `Test Profile ${id}`,
    userDataDir: `C:\\fake\\dir\\${id}`,
    chromeProfileName: 'Default',
    chromePath: 'C:\\fake\\chrome.exe',
    cdpPort: 9222,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flowUrlLocale: null,
    detectedEmail: null,
    notes: '',
  };
}

describe('FlowAutomationSession', () => {
  it('should construct with injected ProfileSession and expose its profileId', () => {
    const mockProfile = new ProfileSession(createMockProfileConfig('profile_alpha_01'));
    const automationSession = new FlowAutomationSession(mockProfile);

    expect(automationSession.profileId).toBe('profile_alpha_01');
    expect(automationSession.status).toBe('idle');
  });

  it('should throw when getPage() is called before session is connected', () => {
    const mockProfile = new ProfileSession(createMockProfileConfig('profile_unstarted'));
    const automationSession = new FlowAutomationSession(mockProfile);

    expect(() => automationSession.getPage()).toThrow('has no active Page');
  });

  it('should retrieve Page from ProfileSession when connected', () => {
    const mockProfile = new ProfileSession(createMockProfileConfig('profile_started'));
    const fakePage = { url: () => 'https://labs.google/fx/en/tools/flow' } as unknown as import('playwright').Page;

    // Inject fake page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockProfile as any).page = fakePage;

    const automationSession = new FlowAutomationSession(mockProfile);
    expect(automationSession.getPage()).toBe(fakePage);
  });

  it('MULTI-PROFILE ISOLATION: Two sessions operate on distinct profile instances and pages', () => {
    const profileA = new ProfileSession(createMockProfileConfig('profile_worker_A'));
    const profileB = new ProfileSession(createMockProfileConfig('profile_worker_B'));

    const pageA = { url: () => 'https://labs.google/fx/en/tools/flow/project/project-A' } as unknown as import('playwright').Page;
    const pageB = { url: () => 'https://labs.google/fx/en/tools/flow/project/project-B' } as unknown as import('playwright').Page;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profileA as any).page = pageA;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profileB as any).page = pageB;

    const autoA = new FlowAutomationSession(profileA);
    const autoB = new FlowAutomationSession(profileB);

    // Profile isolation verification:
    expect(autoA.profileId).toBe('profile_worker_A');
    expect(autoB.profileId).toBe('profile_worker_B');
    expect(autoA.profileId).not.toBe(autoB.profileId);

    // Page isolation verification:
    expect(autoA.getPage()).toBe(pageA);
    expect(autoB.getPage()).toBe(pageB);
    expect(autoA.getPage()).not.toBe(autoB.getPage());
  });

  it('ProfileSession.getAutomationSession() returns lazy singleton instance for that profile', () => {
    const profile = new ProfileSession(createMockProfileConfig('profile_lazy_test'));
    const auto1 = profile.getAutomationSession();
    const auto2 = profile.getAutomationSession();

    expect(auto1).toBeDefined();
    expect(auto1.profileId).toBe('profile_lazy_test');
    expect(auto1).toBe(auto2); // Same instance per ProfileSession
  });

  it('detectCurrentModel should delegate to ModelSelector', async () => {
    const profile = new ProfileSession(createMockProfileConfig('profile_model_test'));
    const fakePage = {
      evaluate: vi.fn(async () => 'Nano Banana 2'),
    } as unknown as import('playwright').Page;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profile as any).page = fakePage;

    const autoSession = new FlowAutomationSession(profile);
    const model = await autoSession.detectCurrentModel();
    expect(model).toBe('Nano Banana 2');
  });

  it('selectNanoBanana2 should return structured ModelSelectionResult', async () => {
    const profile = new ProfileSession(createMockProfileConfig('profile_nb2_test'));
    const fakePage = {
      evaluate: vi.fn(async () => 'Nano Banana 2'),
      locator: vi.fn(),
    } as unknown as import('playwright').Page;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profile as any).page = fakePage;

    const autoSession = new FlowAutomationSession(profile);
    const result = await autoSession.selectNanoBanana2();

    expect(result.modelRequested).toBe('Nano Banana 2');
    expect(result.verified).toBe(true);
    expect(autoSession.status).toBe('idle');
  });

  it('selectRatio should return structured RatioSelectionResult', async () => {
    const profile = new ProfileSession(createMockProfileConfig('profile_ratio_test'));
    const fakePage = {
      evaluate: vi.fn(async () => '16:9'),
      locator: vi.fn(),
    } as unknown as import('playwright').Page;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profile as any).page = fakePage;

    const autoSession = new FlowAutomationSession(profile);
    const result = await autoSession.selectRatio('16:9');

    expect(result.requestedRatio).toBe('16:9');
    expect(result.verified).toBe(true);
    expect(autoSession.status).toBe('idle');
  });
});
