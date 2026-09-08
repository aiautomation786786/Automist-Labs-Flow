/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { GenerationStudioScreen } from '../renderer/screens/GenerationStudioScreen';

describe('GenerationStudioScreen', () => {
  let mockCreatedProject: any;
  let onProjectCreated: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  let onNavigateProfiles: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    mockCreatedProject = { projectId: 'proj_studio_123', name: 'Studio Test Project' };
    onProjectCreated = vi.fn();
    onCancel = vi.fn();
    onNavigateProfiles = vi.fn();

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([
        { profileId: 'prof_1', displayName: 'Account Alpha', email: 'alpha@flow.com', status: 'ready' },
        { profileId: 'prof_2', displayName: 'Account Beta', email: 'beta@flow.com', status: 'ready' },
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

  it('renders all 4 generation mode tabs and starts with initial mode', async () => {
    render(
      <GenerationStudioScreen
        initialMode="single_image"
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
        onNavigateProfiles={onNavigateProfiles}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Single Image')).toBeDefined();
    expect(screen.getByText('Single Video')).toBeDefined();
    expect(screen.getByText('Bulk Images')).toBeDefined();
    expect(screen.getByText('Bulk Videos')).toBeDefined();
    expect(screen.getByText('Generate Image (x1)')).toBeDefined();
  });

  it('switches to single video mode and renders contextual Veo native duration by default', async () => {
    render(
      <GenerationStudioScreen
        initialMode="single_video"
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
        onNavigateProfiles={onNavigateProfiles}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue(/Veo 3.1 - Quality/i)).toBeDefined();
    expect(screen.getByText('Native Flow Duration')).toBeDefined();
    // 4K must not exist
    expect(screen.queryByText(/4k/i)).toBeNull();
  });

  it('shows live duration buttons and resolution when Omni 1.1 Flash is selected', async () => {
    render(
      <GenerationStudioScreen
        initialMode="single_video"
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
        onNavigateProfiles={onNavigateProfiles}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'Omni 1.1 Flash' } });

    expect(screen.getByText('Omni 1.1 Flash live duration controls')).toBeDefined();
    expect(screen.getByText('6s')).toBeDefined();
    expect(screen.getByText('360p')).toBeDefined();
    expect(screen.getByText('720p')).toBeDefined();
  });

  it('handles bulk video mode, multiline parsing and multi-account assignment', async () => {
    render(
      <GenerationStudioScreen
        initialMode="bulk_video"
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
        onNavigateProfiles={onNavigateProfiles}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Enter project name
    const nameInput = screen.getByPlaceholderText('Enter project name...');
    fireEvent.change(nameInput, { target: { value: 'Bulk Video Test' } });

    // Enter 2 multiline prompts
    const textarea = screen.getByPlaceholderText(/Enter one prompt per line/i);
    fireEvent.change(textarea, {
      target: { value: 'First video scene\n\nSecond video scene with steam\n' },
    });

    // Verify slot badges
    expect(screen.getByText('2 Slots Assigned')).toBeDefined();
    expect(screen.getByText('#01')).toBeDefined();
    expect(screen.getByText('#02')).toBeDefined();

    // Verify both profiles are checked by default
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    expect(checkboxes[0]!.checked).toBe(true);
    expect(checkboxes[1]!.checked).toBe(true);

    // Submit form
    const submitBtn = screen.getByText('Generate 2 Videos');
    fireEvent.click(submitBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bulk Video Test',
        generationMode: 'bulk_video',
        prompts: [
          { text: 'First video scene', type: 'video' },
          { text: 'Second video scene with steam', type: 'video' },
        ],
        selectedProfileIds: expect.arrayContaining(['prof_1', 'prof_2']),
      })
    );

    expect(window.flowApi?.startProjectGeneration).toHaveBeenCalledWith('proj_studio_123');
    expect(onProjectCreated).toHaveBeenCalledWith('proj_studio_123');
  });

  it('submits single image generation with original or 2k export and no 4k option', async () => {
    render(
      <GenerationStudioScreen
        initialMode="single_image"
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
        onNavigateProfiles={onNavigateProfiles}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Enter single prompt
    const promptInput = screen.getByPlaceholderText(/e.g. A small red apple/i);
    fireEvent.change(promptInput, { target: { value: 'A golden retriever in a field of sunflowers' } });

    // Click 2K Upscaled export
    const upscale2kBtn = screen.getByText('2K Upscaled');
    fireEvent.click(upscale2kBtn);

    // Submit
    const submitBtn = screen.getByText('Generate Image (x1)');
    fireEvent.click(submitBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        generationMode: 'single_image',
        imageRatio: '16:9',
        imageDownloadQuality: '2k',
        prompts: [{ text: 'A golden retriever in a field of sunflowers', type: 'image' }],
      })
    );
    expect(onProjectCreated).toHaveBeenCalledWith('proj_studio_123');
  });
});
