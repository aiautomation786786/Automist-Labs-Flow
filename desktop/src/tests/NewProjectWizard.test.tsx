/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { NewProjectScreen } from '../renderer/screens/NewProjectScreen';

describe('NewProjectScreen 5-Step Wizard', () => {
  let mockCreatedProject: any;
  let onProjectCreated: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    mockCreatedProject = { projectId: 'proj_new_123', name: 'Cyberpunk Episode' };
    onProjectCreated = vi.fn();

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([
        { profileId: 'prof_1', displayName: 'Profile 1', status: 'ready' },
        { profileId: 'prof_2', displayName: 'Profile 2', status: 'auth_required' },
      ]),
      createProject: vi.fn().mockResolvedValue(mockCreatedProject),
      startProjectGeneration: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([]),
      getProject: vi.fn().mockResolvedValue(null),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      cancelJob: vi.fn(),
      getProjectJobs: vi.fn().mockResolvedValue([]),
      createProfile: vi.fn(),
      startProfile: vi.fn(),
      stopProfile: vi.fn(),
      deleteProfile: vi.fn(),
      openChrome: vi.fn(),
      openSignIn: vi.fn().mockResolvedValue({ success: true, message: 'Ready' }),
      verifyAccount: vi.fn().mockResolvedValue({ success: true, status: 'ready', detectedEmail: 'test@example.com' }),
      testConnection: vi.fn().mockResolvedValue({ success: true, port: 9222, responsive: true, status: 'ready' }),
      getAppInfo: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      launchLoginBrowser: vi.fn().mockResolvedValue({ success: true, pid: 99999, cdpPort: 9222, userDataDir: 'C:\\test', message: 'Chrome opened' }),
      onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('completes the full 5-step wizard flow and triggers project creation & start', async () => {
    render(
      <NewProjectScreen
        onProjectCreated={onProjectCreated}
        onCancel={() => {}}
        onNavigateProfiles={() => {}}
      />
    );

    // Initial load of profiles
    await act(async () => {
      await Promise.resolve();
    });

    // STEP 1: Project Details
    expect(screen.getByText('Step 1 — Project Details')).toBeDefined();
    const continueBtn1 = screen.getByText(/Continue to Content/i);
    expect((continueBtn1 as HTMLButtonElement).disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText(/e\.g\. Cyberpunk Episode 01/i);
    fireEvent.change(nameInput, { target: { value: 'Cyberpunk Campaign' } });
    expect((continueBtn1 as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(continueBtn1);

    // STEP 2: Content Selection
    expect(screen.getByText('Step 2 — Content Type')).toBeDefined();
    // Select "Images + Videos"
    fireEvent.click(screen.getByText('Images + Videos'));
    fireEvent.click(screen.getByText(/Continue to Settings/i));

    // STEP 3: Generation Settings
    expect(screen.getByText('Step 3 — Generation Settings')).toBeDefined();
    // Select 9:16 ratio
    fireEvent.click(screen.getByText(/9:16/i));
    // Select Videos First
    fireEvent.click(screen.getByText('Videos First'));
    fireEvent.click(screen.getByText(/Continue to Prompts/i));

    // STEP 4: Prompt Input
    expect(screen.getByText('Step 4 — Prompt Input')).toBeDefined();
    const imageTextarea = screen.getByPlaceholderText(/A futuristic city in the rain/i);
    const videoTextarea = screen.getByPlaceholderText(/Drone flying low over neon city alley/i);

    // Enter 2 image prompts and 1 video prompt
    fireEvent.change(imageTextarea, {
      target: { value: 'First image prompt\nSecond image prompt' },
    });
    fireEvent.change(videoTextarea, {
      target: { value: 'First video prompt' },
    });

    // Verify live prompt counters
    expect(screen.getByText((_, el) => el?.textContent === 'Images: 2 prompts')).toBeDefined();
    expect(screen.getByText((_, el) => el?.textContent === 'Videos: 1 prompts')).toBeDefined();

    // Click Continue to Step 5
    fireEvent.click(screen.getByRole('button', { name: /Review & Start/i }));

    // STEP 5: Review & Start
    expect(screen.getByText('Step 5 — Review & Start')).toBeDefined();
    expect(screen.getByText('Cyberpunk Campaign')).toBeDefined();

    // Verify Profile Readiness UX
    expect(screen.getByText((_, el) => el?.textContent === 'Ready: 1')).toBeDefined();
    expect(screen.getByText((_, el) => el?.textContent === 'Auth Required: 1')).toBeDefined();

    // Verify Dynamic Button text
    const startButton = screen.getByText('Start Generation — 3 Prompts');
    expect(startButton).toBeDefined();

    // Click Start Generation
    await act(async () => {
      fireEvent.click(startButton);
    });

    // Verify window.flowApi calls
    expect(window.flowApi?.createProject).toHaveBeenCalledWith({
      name: 'Cyberpunk Campaign',
      campaignTag: undefined,
      imageRatio: '9:16',
      processingOrder: 'videos_first',
      prompts: [
        { text: 'First image prompt', type: 'image' },
        { text: 'Second image prompt', type: 'image' },
        { text: 'First video prompt', type: 'video' },
      ],
    });

    expect(window.flowApi?.startProjectGeneration).toHaveBeenCalledWith('proj_new_123');
    expect(onProjectCreated).toHaveBeenCalledWith('proj_new_123');
  });
});
