/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { GeminiStatusScreen } from '../renderer/screens/GeminiStatusScreen';
import type { FlowApi, ProfileSessionSnapshot } from '../shared/types';

describe('GeminiStatusScreen', () => {
  const mockProfiles: ProfileSessionSnapshot[] = [
    {
      profileId: 'profile_1',
      displayName: 'Marketing Account',
      detectedEmail: 'marketing@gmail.com',
      status: 'ready',
      cdpPort: 9222,
      chromePath: 'chrome.exe',
      flowUrl: null,
      errorMessage: null,
      lastStatusChange: new Date().toISOString(),
      uptimeMs: 10000,
    },
  ];

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).flowApi = {
      listProfiles: vi.fn().mockResolvedValue(mockProfiles),
    } as unknown as FlowApi;
  });

  it('renders Gemini Omni status header, profile connectivity, and capability cards', async () => {
    const onNavigate = vi.fn();
    render(<GeminiStatusScreen onNavigateMode={onNavigate} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Gemini Omni Engine Status')).toBeDefined();
    expect(screen.getByText('1 Profiles Ready')).toBeDefined();
    expect(screen.getByText('Gemini Omni Capabilities')).toBeDefined();
    expect(screen.getByText('10.0s (Fixed)')).toBeDefined();
    expect(screen.getByText('Provenance & Integrity')).toBeDefined();
    expect(screen.getByText('Single Video Generator')).toBeDefined();
    expect(screen.getByText('Bulk Video Generator')).toBeDefined();
  });

  it('triggers navigation buttons cleanly', async () => {
    const onNavigate = vi.fn();
    render(<GeminiStatusScreen onNavigateMode={onNavigate} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText('Single Video Generator'));
    expect(onNavigate).toHaveBeenCalledWith('single_video');

    fireEvent.click(screen.getByText('Bulk Video Generator'));
    expect(onNavigate).toHaveBeenCalledWith('bulk_video');
  });
});
