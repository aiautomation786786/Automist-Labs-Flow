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

  it('4. Step 3 (Subtitles): renders master switch, 4 presets, direct individual controls, live preview, and no dummy blocks', async () => {
    await setupScreen();

    // Step 1 -> Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/Subtitles Configuration/i)).toBeDefined();
    expect(screen.getByText(/Burn Subtitles onto Video/i)).toBeDefined();

    // 1. Verify exactly 4 presets exist
    expect(screen.getByText(/Bottom Glass/i)).toBeDefined();
    expect(screen.getByText(/Solid Bar/i)).toBeDefined();
    expect(screen.getByText(/Neon Punch/i)).toBeDefined();
    expect(screen.getByText(/Cinema Yellow/i)).toBeDefined();

    // 2. Verify all direct controls are visible WITHOUT accordion
    expect(screen.getByText(/^Animation$/i)).toBeDefined();
    expect(screen.getByText(/^What to Show$/i)).toBeDefined();
    expect(screen.getByText(/^Position$/i)).toBeDefined();
    expect(screen.getByText(/^Font$/i)).toBeDefined();
    expect(screen.getByText(/^Size$/i)).toBeDefined();
    expect(screen.getByText(/^Text Color$/i)).toBeDefined();
    expect(screen.getByText(/^Background Box$/i)).toBeDefined();
    expect(screen.getByText(/^Box Color$/i)).toBeDefined();
    expect(screen.getByText(/^Outline & Shadow$/i)).toBeDefined();

    // 3. Verify old accordion is removed
    expect(screen.queryByText(/Typography & Appearance Controls/i)).toBeNull();
    expect(screen.queryByText(/Customize Font, Colors, Position/i)).toBeNull();

    // 4. Verify old dummy pipeline text is removed
    expect(screen.queryByText(/Subtitles Pipeline:/i)).toBeNull();

    // 5. Verify live preview canvas
    expect(screen.getByText(/Live Subtitle Interactive Preview/i)).toBeDefined();
  });

  it('5. Step 4 (Motion): renders master switch, Camera Motion dropdown with optgroups, Scene Transition dropdown, and no dummy blocks', async () => {
    await setupScreen();

    // Step 1 -> Step 2 -> Step 3 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/Camera Motion & Transitions/i)).toBeDefined();

    // 1. Master Camera Motion Switch
    expect(screen.getByText(/Move the camera over each image/i)).toBeDefined();
    const motionToggleBtn = screen.getByRole('button', { name: /^ON$/i });
    expect(motionToggleBtn).toBeDefined();

    // 2. Camera Motion Dropdown
    expect(screen.getByText(/^Camera Motion$/i)).toBeDefined();
    expect(screen.getByText(/Organic subtle breathing zoom/i)).toBeDefined();

    // 3. Scene Transition Dropdown
    expect(screen.getByText(/^Scene Transition$/i)).toBeDefined();
    expect(screen.getByText(/Clean cut from one scene to the next/i)).toBeDefined();

    // Crossfade Duration should NOT be visible when Hard Cut is selected
    expect(screen.queryByText(/Crossfade Duration/i)).toBeNull();

    // Select Cross Fade -> Crossfade Duration slider appears with dynamic description
    const selects = screen.getAllByRole('combobox');
    const transitionSelect = selects.find((s) => (s as HTMLSelectElement).value === 'hard_cut');
    expect(transitionSelect).toBeDefined();
    fireEvent.change(transitionSelect!, { target: { value: 'cross_fade' } });

    expect(screen.getByText(/Smooth fade between scenes/i)).toBeDefined();
    expect(screen.getByText(/Crossfade Duration/i)).toBeDefined();

    // 4. Select another motion style (e.g. AI Director) -> dynamic description updates
    const motionSelect = selects.find((s) => (s as HTMLSelectElement).value === 'breathe');
    expect(motionSelect).toBeDefined();
    fireEvent.change(motionSelect!, { target: { value: 'ai_director' } });
    expect(screen.getByText(/Mood-adaptive camera motion selected per scene/i)).toBeDefined();

    // 5. Verify old tier filter buttons and dummy technical blocks are removed
    expect(screen.queryByRole('button', { name: /^SMART$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^PRO$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ULTRA$/i })).toBeNull();
    expect(screen.queryByText(/Camera motion filters \(zoompan\)/i)).toBeNull();

    // 6. Test toggling master switch to OFF
    fireEvent.click(motionToggleBtn);
    expect(screen.getByRole('button', { name: /^OFF$/i })).toBeDefined();
  });

  it('6. Step 5 (Voice & Music): renders 5 TTS engines, dedicated Narrator card, search, music controls and removed dummy text', async () => {
    await setupScreen();

    // Step 1 -> Step 2 -> Step 3 -> Step 4 -> Step 5
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(screen.getByText(/Voice & TTS Narration Foundation/i)).toBeDefined();
    expect(screen.getAllByText(/Background Music/i).length).toBeGreaterThanOrEqual(1);

    // 1. Five TTS Engines rendered in tab bar
    expect(screen.getByRole('button', { name: /Edge TTS/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Kokoro/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Azure Speech/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /ai33\.pro/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /FameSpeak/i })).toBeDefined();

    // 2. Dedicated active narrator voice card
    expect(screen.getByText(/Active Narrator Voice/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /▶ Preview Voice/i })).toBeDefined();

    // 3. Voice list & search input
    expect(screen.getByPlaceholderText(/Filter voices/i)).toBeDefined();

    // 4. Background Music master switch
    fireEvent.click(screen.getByRole('button', { name: /Music OFF/i }));
    expect(screen.getByRole('button', { name: /Music ON/i })).toBeDefined();
    expect(screen.getByText(/Auto Ducking:/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Select Music Track\.\.\./i })).toBeDefined();

    // 5. Pre-Render Configuration Overview
    expect(screen.getByText(/Pre-Render Configuration/i)).toBeDefined();

    // 6. Verify internal fallback and technical dummy text are completely removed
    expect(screen.queryByText(/FinalAudioMixer loops the soundtrack indefinitely/i)).toBeNull();
    expect(screen.queryByText(/ZBot Resilient Fallback Protection/i)).toBeNull();
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
    // Select Cross Fade from transition dropdown
    const selectsStep4 = screen.getAllByRole('combobox');
    const transitionSelect = selectsStep4.find((s) => (s as HTMLSelectElement).value === 'hard_cut');
    if (transitionSelect) {
      fireEvent.change(transitionSelect, { target: { value: 'cross_fade' } });
    }

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

  it('8. Step 6 (Readiness Validation): displays real checklist and validates configuration', async () => {
    await setupScreen();

    // Advance to Step 6
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 2
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 3
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 4
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i })); // to 5
    fireEvent.click(screen.getByRole('button', { name: /Next: Review & Launch/i })); // to 6

    // In a fully configured project, displays Ready to Create with all checkmarks
    expect(screen.getByText(/Ready to Create — All Configuration Parameters Validated/i)).toBeDefined();
    expect(screen.getByText(/Script loaded:/i)).toBeDefined();
    expect(screen.getByText(/Format selected:/i)).toBeDefined();
    expect(screen.getByText(/Voice selected:/i)).toBeDefined();
    expect(screen.getByText(/Subtitles configured:/i)).toBeDefined();
    expect(screen.getByText(/Motion configured:/i)).toBeDefined();
    expect(screen.getByText(/Background music:/i)).toBeDefined();

    // Launch button is enabled
    const launchBtn = screen.getByRole('button', { name: /Create Video Project/i });
    expect((launchBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
