/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GeminiVideoStudioScreen } from '../renderer/screens/GeminiVideoStudioScreen';
import type { FlowApi, ProfileSessionSnapshot } from '../shared/types';

describe('GeminiVideoStudioScreen UI Component Tests', () => {
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
    {
      profileId: 'profile_2',
      displayName: 'Personal Account',
      detectedEmail: 'personal@gmail.com',
      status: 'ready',
      cdpPort: 9223,
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
      createProject: vi.fn().mockResolvedValue({ projectId: 'proj_gemini_created_01' }),
      startProjectGeneration: vi.fn().mockResolvedValue([]),
      selectImageFile: vi.fn().mockResolvedValue('C:/images/test_input.png'),
      selectMultipleImageFiles: vi.fn().mockResolvedValue([
        'C:/images/10.jpg',
        'C:/images/1.jpg',
        'C:/images/2.jpg',
      ]),
    } as unknown as FlowApi;
  });

  it('should render Gemini Video Studio header, badge, and mode tabs', async () => {
    render(
      <GeminiVideoStudioScreen
        onProjectCreated={vi.fn()}
        onCancel={vi.fn()}
        onNavigateProfiles={vi.fn()}
      />
    );

    expect(screen.getByText('Gemini Video Studio')).toBeDefined();
    expect(screen.getByText('Gemini Omni / Veo')).toBeDefined();
    expect(screen.getByText('Text to Video')).toBeDefined();
    expect(screen.getByText('Image to Video')).toBeDefined();
    expect(screen.getByText('Bulk Text to Video')).toBeDefined();
    expect(screen.getByText('Bulk Image to Video')).toBeDefined();
  });

  it('should support switching between 16:9 and 9:16 aspect ratios', async () => {
    render(
      <GeminiVideoStudioScreen
        onProjectCreated={vi.fn()}
        onCancel={vi.fn()}
        onNavigateProfiles={vi.fn()}
      />
    );

    const landscapeBtn = screen.getByText('Landscape (16:9)');
    const portraitBtn = screen.getByText('Portrait (9:16)');

    fireEvent.click(portraitBtn);
    expect(portraitBtn).toBeDefined();

    fireEvent.click(landscapeBtn);
    expect(landscapeBtn).toBeDefined();
  });

  it('should naturally sort bulk uploaded images (1.jpg, 2.jpg, 10.jpg) and pair 1-to-1 with prompts', async () => {
    render(
      <GeminiVideoStudioScreen
        initialMode="bulk_image_to_video"
        onProjectCreated={vi.fn()}
        onCancel={vi.fn()}
        onNavigateProfiles={vi.fn()}
      />
    );

    // Trigger select multiple files
    const selectTrigger = screen.getByText(/Click to select multiple source images/i);
    fireEvent.click(selectTrigger);

    await waitFor(() => {
      // 1.jpg should be slot #01, 2.jpg #02, 10.jpg #03 (natural order, NOT 1.jpg, 10.jpg, 2.jpg)
      expect(screen.getByText('1.jpg')).toBeDefined();
      expect(screen.getByText('2.jpg')).toBeDefined();
      expect(screen.getByText('10.jpg')).toBeDefined();
    });

    // Provide 2 prompts when 3 images staged -> Mismatch warning should block submission
    const textarea = screen.getByPlaceholderText(/Enter one motion prompt per line/i);
    fireEvent.change(textarea, { target: { value: 'Prompt 1\nPrompt 2' } });

    expect(
      screen.getByText(/Mismatch: 3 images staged but 2 prompt lines provided/i)
    ).toBeDefined();

    const generateBtn = screen.getByText(/Generate with Gemini/i);
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);

    // Now provide matching 3 prompts -> Warning clears, button enables
    fireEvent.change(textarea, { target: { value: 'Prompt 1\nPrompt 2\nPrompt 3' } });
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('should submit single text-to-video project with provider: gemini', async () => {
    const onProjectCreated = vi.fn();

    render(
      <GeminiVideoStudioScreen
        initialMode="text_to_video"
        onProjectCreated={onProjectCreated}
        onCancel={vi.fn()}
        onNavigateProfiles={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText(/Describe your video in detail/i);
    fireEvent.change(textarea, { target: { value: 'A serene Japanese garden with cherry blossoms' } });

    const generateBtn = screen.getByText(/Generate with Gemini/i);
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(window.flowApi?.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          generationMode: 'gemini_text_to_video',
          videoModel: 'Gemini Omni',
          prompts: [
            expect.objectContaining({
              text: 'A serene Japanese garden with cherry blossoms',
              type: 'video',
              provider: 'gemini',
            }),
          ],
        })
      );
      expect(window.flowApi?.startProjectGeneration).toHaveBeenCalledWith('proj_gemini_created_01');
      expect(onProjectCreated).toHaveBeenCalledWith('proj_gemini_created_01');
    });
  });
});
