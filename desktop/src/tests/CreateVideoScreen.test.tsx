/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { CreateVideoScreen } from '../renderer/screens/CreateVideoScreen';
import type { VideoFactoryDraft } from '../shared/types';

describe('CreateVideoScreen', () => {
  let onProjectCreated: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  const mockDraft: VideoFactoryDraft = {
    activeMode: 'full_video',
    step: 1,
    title: '',
    rawScript: '',
    scenes: [],
    aspectRatio: '16:9',
    subtitlesEnabled: true,
    subtitleStyle: 'clean_bottom',
    motionEnabled: true,
    motionStyle: 'breathe',
    transitionStyle: 'hard_cut',
    voiceEngine: 'edge-tts',
    voiceId: 'narrator_1',
    lastSaved: new Date().toISOString(),
  };

  beforeEach(() => {
    onProjectCreated = vi.fn();
    onCancel = vi.fn();

    window.flowApi = {
      getFactoryDraft: vi.fn().mockResolvedValue(mockDraft),
      saveFactoryDraft: vi.fn().mockResolvedValue(mockDraft),
      parseScript: vi.fn().mockImplementation((text: string) => {
        return Promise.resolve({
          scenes: [
            {
              sceneNumber: 1,
              narration: 'Deep in the dark ocean depths.',
              imagePrompt: 'Bioluminescent jellyfish in underwater trench',
              mood: 'mysterious',
            },
            {
              sceneNumber: 2,
              narration: 'Thermal vents support impossible life.',
              imagePrompt: 'Thermal vent spewing black mineral smoke',
              mood: 'dramatic',
            },
          ],
          totalScenes: 2,
          warnings: [],
        });
      }),
      createFactoryProject: vi.fn().mockResolvedValue({
        projectId: 'factory_proj_123',
        name: 'Ocean Deep Documentary',
      }),
      createProject: vi.fn().mockResolvedValue({
        projectId: 'img_proj_456',
        name: 'Cyberpunk Asset Batch',
      }),
      getProjectStory: vi.fn().mockResolvedValue(null),
      listProjects: vi.fn().mockResolvedValue([]),
      getProject: vi.fn().mockResolvedValue(null),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      startProjectGeneration: vi.fn(),
      cancelJob: vi.fn(),
      getProjectJobs: vi.fn().mockResolvedValue([]),
      listProfiles: vi.fn().mockResolvedValue([]),
      createProfile: vi.fn(),
      startProfile: vi.fn(),
      stopProfile: vi.fn(),
      deleteProfile: vi.fn(),
      openChrome: vi.fn(),
      openSignIn: vi.fn().mockResolvedValue({ success: true, message: 'Ready' }),
      verifyAccount: vi.fn().mockResolvedValue({ success: true, status: 'ready', detectedEmail: 'test@example.com' }),
      testConnection: vi.fn().mockResolvedValue({ success: true, port: 9222, responsive: true, status: 'ready' }),
      getAppInfo: vi.fn().mockResolvedValue({ version: '1.0.0' }),
      getSettings: vi.fn().mockResolvedValue({}),
      updateSettings: vi.fn(),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      launchLoginBrowser: vi.fn().mockResolvedValue({ success: true, pid: 99999, cdpPort: 9222, userDataDir: 'C:\\test', message: 'Chrome opened' }),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all 4 creation modes on the header tabs', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /Full Video/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /From Skill/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Images Only/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Audio Only/i })).toBeDefined();
  });

  it('navigates to From Skill and Audio Only and shows roadmap messages', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Switch to From Skill
    fireEvent.click(screen.getByRole('button', { name: /From Skill/i }));
    expect(screen.getByText(/From Skill Workflow/i)).toBeDefined();

    // Switch to Audio Only
    fireEvent.click(screen.getByRole('button', { name: /Audio Only/i }));
    expect(screen.getByText(/Audio Only Workflow/i)).toBeDefined();
  });

  it('navigates through the 5 steps in Full Video mode and preserves state', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Step 1: Script
    const titleInput = screen.getByLabelText('Project Title');
    fireEvent.change(titleInput, { target: { value: 'Ocean Deep Documentary' } });

    // Click sample script button
    const docSampleBtn = screen.getByRole('button', { name: /Sample: Ocean/i });
    fireEvent.click(docSampleBtn);

    // Wait for parse and rendering
    await act(async () => {
      await Promise.resolve();
    });

    // Verify scene cards rendered
    expect(screen.getAllByText(/SCENE 1/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/SCENE 2/i).length).toBeGreaterThanOrEqual(1);

    // Advance to Step 2 (Format)
    const nextBtn1 = screen.getByRole('button', { name: /Next Step/i });
    fireEvent.click(nextBtn1);

    // Verify Step 2 rendered
    expect(screen.getByText(/Aspect Ratio/i)).toBeDefined();
    expect(screen.getByText(/16:9 Landscape/i)).toBeDefined();
    expect(screen.getByText(/9:16 Portrait/i)).toBeDefined();

    // Select 9:16
    const portraitCard = screen.getByText(/9:16 Portrait/i);
    fireEvent.click(portraitCard);

    // Advance to Step 3 (Subtitles)
    const nextBtn2 = screen.getByRole('button', { name: /Next Step/i });
    fireEvent.click(nextBtn2);

    expect(screen.getByText(/Subtitles Configuration/i)).toBeDefined();

    // Advance to Step 4 (Motion)
    const nextBtn3 = screen.getByRole('button', { name: /Next Step/i });
    fireEvent.click(nextBtn3);

    expect(screen.getByText(/Camera Motion & Transitions/i)).toBeDefined();

    // Advance to Step 5 (Voice)
    const nextBtn4 = screen.getByRole('button', { name: /Next Step/i });
    fireEvent.click(nextBtn4);

    expect(screen.getByText(/Voice & TTS Narration Foundation/i)).toBeDefined();

    // Verify Back navigation: 5 -> 4 -> 3 -> 2 -> 1
    const backBtn5 = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn5);
    expect(screen.getByText(/Camera Motion & Transitions/i)).toBeDefined();

    const backBtn4 = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn4);
    expect(screen.getByText(/Subtitles Configuration/i)).toBeDefined();

    const backBtn3 = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn3);
    expect(screen.getByText(/Aspect Ratio/i)).toBeDefined();

    // Step 2 back to Step 1
    const backBtn2 = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn2);

    // Verify Step 1 title and scenes preserved
    expect((screen.getByLabelText('Project Title') as HTMLInputElement).value).toBe('The Ocean Abyss');
    expect(screen.getAllByText(/SCENE 1/i).length).toBeGreaterThanOrEqual(1);
  });

  it('completes Step 5 and calls createFactoryProject to create project', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Enter title & load sample script
    fireEvent.click(screen.getByRole('button', { name: /Sample: Ocean/i }));

    await act(async () => {
      await Promise.resolve();
    });

    // Step 1 -> 2
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    // Step 2 -> 3
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    // Step 3 -> 4
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));
    // Step 4 -> 5
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Click "Create Video Project"
    const finishBtn = screen.getByRole('button', { name: /Create Video Project/i });
    await act(async () => {
      fireEvent.click(finishBtn);
      await Promise.resolve();
    });

    expect(window.flowApi.createFactoryProject).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'full_video',
        story: expect.objectContaining({
          title: 'The Ocean Abyss',
          scenes: expect.arrayContaining([
            expect.objectContaining({ sceneNumber: 1 }),
            expect.objectContaining({ sceneNumber: 2 }),
          ]),
        }),
      })
    );

    expect(onProjectCreated).toHaveBeenCalledWith('factory_proj_123');
  });

  it('supports Images Only mode and creates standard image batch project', async () => {
    const { container } = render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Switch to Images Only
    fireEvent.click(screen.getByRole('button', { name: /Images Only/i }));

    // Fill project name & prompts
    const nameInput = screen.getByPlaceholderText(/e\.g\. Cyberpunk Concept Art Batch/i);
    fireEvent.change(nameInput, { target: { value: 'Cyberpunk Asset Batch' } });

    const textarea = container.querySelector('textarea')!;
    expect(textarea).toBeDefined();
    fireEvent.change(textarea, { target: { value: 'Cyberpunk street neon rain\nCyberpunk hacker alleyway' } });

    // Submit
    const createBtn = screen.getByRole('button', { name: /Create Batch Image Project/i });
    await act(async () => {
      fireEvent.click(createBtn);
      await Promise.resolve();
    });

    expect(window.flowApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cyberpunk Asset Batch',
        prompts: [
          { text: 'Cyberpunk street neon rain', type: 'image' },
          { text: 'Cyberpunk hacker alleyway', type: 'image' },
        ],
      })
    );

    expect(onProjectCreated).toHaveBeenCalledWith('img_proj_456');
  });

  it('blocks advancing to Step 2 when script has validation errors', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Step 1: Click Next without entering any script
    const nextBtn = screen.getByRole('button', { name: /Next Step/i });
    fireEvent.click(nextBtn);

    // Should stay on Step 1 and display validation error
    expect(screen.getAllByText(/The story must contain at least one scene/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Aspect Ratio/i)).toBeNull();
  });

  it('supports Scene Cards Editor: adding, editing, and syncing scenes', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Switch to Scene Cards tab
    const cardsTab = screen.getByRole('button', { name: /Scene Cards/i });
    fireEvent.click(cardsTab);

    // Add Scene
    const addSceneBtn = screen.getByRole('button', { name: /Add Scene/i });
    fireEvent.click(addSceneBtn);

    // Verify Scene #1 card rendered
    expect(screen.getByText(/Scene #1/i)).toBeDefined();

    // Edit Image Prompt (mandatory)
    const promptInput = screen.getByPlaceholderText(/Enter exact visual prompt for scene artwork/i);
    fireEvent.change(promptInput, { target: { value: 'Epic medieval castle on snowy mountain peak' } });

    // Edit Narration
    const narrationInput = screen.getByPlaceholderText(/Enter spoken voiceover script for this scene/i);
    fireEvent.change(narrationInput, { target: { value: 'In the frozen north stood the ancient stronghold.' } });

    // Sync to Script Text
    const syncBtn = screen.getByRole('button', { name: /Sync to Script Text/i });
    fireEvent.click(syncBtn);

    // Switch to Script Text tab
    const textTab = screen.getByRole('button', { name: /^Script Text$/i });
    fireEvent.click(textTab);

    const textarea = screen.getByPlaceholderText(/Enter or paste your script here/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('## SCENE 1');
    expect(textarea.value).toContain('IMAGE: Epic medieval castle on snowy mountain peak');
    expect(textarea.value).toContain('NARRATION: In the frozen north stood the ancient stronghold.');
  });

  it('supports Scene Cards Editor: duplicating, reordering, and deleting scenes', async () => {
    render(
      <CreateVideoScreen
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Switch to Scene Cards tab
    fireEvent.click(screen.getByRole('button', { name: /Scene Cards/i }));

    // Add Scene 1
    fireEvent.click(screen.getByRole('button', { name: /Add Scene/i }));
    const promptInput1 = screen.getByPlaceholderText(/Enter exact visual prompt for scene artwork/i);
    fireEvent.change(promptInput1, { target: { value: 'Scene One Prompt' } });

    // Add Scene 2
    fireEvent.click(screen.getByRole('button', { name: /Add Scene/i }));
    const promptInputs = screen.getAllByPlaceholderText(/Enter exact visual prompt for scene artwork/i);
    expect(promptInputs).toHaveLength(2);
    fireEvent.change(promptInputs[1]!, { target: { value: 'Scene Two Prompt' } });

    // Duplicate Scene 1
    const duplicateBtns = screen.getAllByTitle(/Duplicate scene/i);
    fireEvent.click(duplicateBtns[0]!);

    // Should now have 3 scenes
    expect(screen.getByText(/Scene #3/i)).toBeDefined();

    // Delete Scene 2 (middle scene)
    const deleteBtns = screen.getAllByTitle(/Delete scene/i);
    expect(deleteBtns).toHaveLength(3);
    fireEvent.click(deleteBtns[1]!);

    // Should now have 2 scenes, properly renumbered
    expect(screen.queryByText(/Scene #3/i)).toBeNull();
    expect(screen.getByText(/Scene #1/i)).toBeDefined();
    expect(screen.getByText(/Scene #2/i)).toBeDefined();
  });
});
