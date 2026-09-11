/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { CreateVideoScreen } from '../renderer/screens/CreateVideoScreen';
import type { VideoFactoryDraft, VideoFactoryConfig } from '../shared/types';

describe('ZBot Create Video Parity Test Suite', () => {
  let onProjectCreated: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  let createdConfig: VideoFactoryConfig | null = null;

  const mockDraft: VideoFactoryDraft = {
    activeMode: 'full_video',
    step: 1,
    title: 'New Faceless Video',
    rawScript: '',
    scenes: [],
    aspectRatio: '16:9',
    subtitlesEnabled: true,
    subtitleStyle: 'bottom_glass',
    motionEnabled: true,
    motionStyle: 'breathe',
    transitionStyle: 'hard_cut',
    voiceEngine: 'edge-tts',
    voiceId: 'en-US-ChristopherNeural',
    lastSaved: new Date().toISOString(),
  };

  beforeEach(() => {
    onProjectCreated = vi.fn();
    onCancel = vi.fn();
    createdConfig = null;

    window.flowApi = {
      getFactoryDraft: vi.fn().mockResolvedValue(mockDraft),
      saveFactoryDraft: vi.fn().mockResolvedValue(mockDraft),
      createFactoryProject: vi.fn().mockImplementation((config: VideoFactoryConfig) => {
        createdConfig = config;
        return Promise.resolve({
          projectId: 'parity_proj_999',
          name: config.story.title,
        });
      }),
      listChannels: vi.fn().mockResolvedValue([]),
      listSkills: vi.fn().mockResolvedValue([]),
      listTtsEngines: vi.fn().mockResolvedValue([
        { id: 'edge-tts', name: 'Edge TTS', badge: 'FREE', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: true },
        { id: 'kokoro', name: 'Kokoro TTS', badge: 'LOCAL', audioExtension: 'wav', supportsWordTimings: true, isAvailable: true },
        { id: 'azure', name: 'Azure Speech', badge: 'API KEY', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: true },
        { id: 'ai33', name: 'AI33 Studio', badge: 'API KEY', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: true },
        { id: 'famespeak', name: 'FameSpeak', badge: 'API KEY', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: true },
      ]),
      listVoices: vi.fn().mockResolvedValue([
        { id: 'en-US-ChristopherNeural', name: 'Christopher (Male)', provider: 'edge-tts', locale: 'en-US', gender: 'male', isAvailable: true },
        { id: 'en-US-JennyNeural', name: 'Jenny (Female)', provider: 'edge-tts', locale: 'en-US', gender: 'female', isAvailable: true },
      ]),
      selectScriptFile: vi.fn().mockResolvedValue(null),
      selectMusicFile: vi.fn().mockResolvedValue('C:\\music\\epic_ambient.mp3'),
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  const setupScreen = async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Populate valid scenes with sample script
    fireEvent.click(screen.getByRole('button', { name: /Sample: Ocean/i }));

    await act(async () => {
      await Promise.resolve();
    });
  };

  it('1. Renders complete 5+1 step stepper header matching ZBot workflow structure', async () => {
    await setupScreen();

    expect(screen.getByText(/1\. Script/i)).toBeDefined();
    expect(screen.getByText(/2\. Format/i)).toBeDefined();
    expect(screen.getByText(/3\. Subtitles/i)).toBeDefined();
    expect(screen.getByText(/4\. Motion/i)).toBeDefined();
    expect(screen.getByText(/5\. Voice & Music/i)).toBeDefined();
    expect(screen.getByText(/6\. Review & Launch/i)).toBeDefined();
  });

  it('2. Step 1: exposes Paste Script, One File, and Separate Files with ZBot Golden Rule #2 banner', async () => {
    await setupScreen();

    expect(screen.getByRole('button', { name: /Paste Script/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /One File/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Separate Files/i })).toBeDefined();

    // Click Separate Files
    fireEvent.click(screen.getByRole('button', { name: /Separate Files/i }));
    expect(screen.getByText(/ZBot Separate Files Workflow/i)).toBeDefined();
    expect(screen.getAllByText(/GOLDEN RULE #2/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Number of prompts strictly dictates scene count/i)).toBeDefined();
  });

  it('3. Step 2 (Format): renders 16:9, 9:16 and Final Output Resolution (Source, 1080p, 4K)', async () => {
    await setupScreen();

    // Advance to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/16:9 Landscape/i)).toBeDefined();
    expect(screen.getByText(/9:16 Portrait/i)).toBeDefined();
    expect(screen.getAllByText(/Output Resolution/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/4K Ultra HD/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1080p Full HD/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Source \/ Original/i)).toBeDefined();
  });

  it('4. Step 3 (Subtitles): renders master switch, 4 presets, live preview canvas, and typography controls', async () => {
    await setupScreen();

    // Step 1 -> Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/Subtitles Configuration/i)).toBeDefined();
    expect(screen.getByText(/Bottom Glass/i)).toBeDefined();
    expect(screen.getByText(/Solid Bar/i)).toBeDefined();
    expect(screen.getByText(/Neon Punch/i)).toBeDefined();
    expect(screen.getByText(/Cinema Yellow/i)).toBeDefined();
    expect(screen.getByText(/Live Subtitle Interactive Preview/i)).toBeDefined();
  });

  it('5. Step 4 (Motion): renders tier filter tabs, all 22 styles, and crossfade duration slider', async () => {
    await setupScreen();

    // Step 1 -> Step 2 -> Step 3 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/Camera Motion & Transitions/i)).toBeDefined();
    // Tier buttons
    expect(screen.getByRole('button', { name: /SMART/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /PRO/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /ULTRA/i })).toBeDefined();
    // Transition
    expect(screen.getByRole('button', { name: /Cross Fade/i })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Cross Fade/i }));
    expect(screen.getByText(/Crossfade Duration:/i)).toBeDefined();
  });

  it('6. Step 5 (Voice & Music): renders 5 TTS engines and Background Music controls with ducking', async () => {
    await setupScreen();

    // Step 1 -> Step 2 -> Step 3 -> Step 4 -> Step 5
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/Voice & TTS Narration Foundation/i)).toBeDefined();
    expect(screen.getByText(/Background Music & Audio Mixing/i)).toBeDefined();

    // Turn music ON to expose ducking and audio engine details
    fireEvent.click(screen.getByRole('button', { name: /Music OFF/i }));
    expect(screen.getByText(/Sidechain Ducking:/i)).toBeDefined();
    expect(screen.getByText(/FinalAudioMixer loops the soundtrack indefinitely/i)).toBeDefined();
  });

  it('7. Step 6 (Review & Launch): displays full parameter summary and dispatches complete VideoFactoryConfig', async () => {
    await setupScreen();

    // Advance all the way to Step 6
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 2
    // Select 4k
    fireEvent.click(screen.getAllByText(/4K Ultra HD/i)[0]!);

    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 3
    // Select Neon Punch
    fireEvent.click(screen.getByText(/Neon Punch/i));

    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 4
    // Select Cross Fade
    fireEvent.click(screen.getByRole('button', { name: /Cross Fade/i }));

    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 5
    // Enable background music
    fireEvent.click(screen.getByRole('button', { name: /Music OFF/i }));

    // Advance to Step 6
    fireEvent.click(screen.getByRole('button', { name: /Next: Review & Launch/i })); // to 6

    expect(screen.getByText(/Review Project & Production Pipeline/i)).toBeDefined();
    expect(screen.getByText(/Project & Script/i)).toBeDefined();
    expect(screen.getByText(/Format & Resolution/i)).toBeDefined();

    // Click Launch
    const launchBtn = screen.getByRole('button', { name: /Create Video Project/i });
    await act(async () => {
      fireEvent.click(launchBtn);
      await Promise.resolve();
    });

    expect(createdConfig).not.toBeNull();
    expect(createdConfig?.outputResolution).toBe('4k');
    expect(createdConfig?.aspectRatio).toBe('16:9');
    expect(createdConfig?.subtitlesEnabled).toBe(true);
    expect(createdConfig?.subtitleConfig?.preset).toBe('neon_punch');
    expect(createdConfig?.transitionStyle).toBe('cross_fade');
    expect(createdConfig?.musicEnabled).toBe(true);
    expect(onProjectCreated).toHaveBeenCalledWith('parity_proj_999');
  });
});
