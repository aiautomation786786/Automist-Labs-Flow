/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { GenerationStudioScreen } from '../renderer/screens/GenerationStudioScreen';
import { AppShell } from '../renderer/components/AppShell';

describe('ModeIsolation & Model Constraints', () => {
  let mockCreatedProject: any;
  let onProjectCreated: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  let onNavigateProfiles: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    mockCreatedProject = { projectId: 'proj_isolation_123', name: 'Isolation Test' };
    onProjectCreated = vi.fn();
    onCancel = vi.fn();
    onNavigateProfiles = vi.fn();

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([
        { profileId: 'prof_alpha', displayName: 'Account Alpha', email: 'alpha@flow.com', status: 'ready' },
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

  it('Single Image Studio contains all 3 Nano Banana models and ZERO video controls', async () => {
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

    // Verify Title
    expect(screen.getByText('Single Image Studio')).toBeDefined();

    // Verify all 3 image models are available in the dropdown
    const select = screen.getByLabelText('AI Image Engine') as HTMLSelectElement;
    expect(select).toBeDefined();
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('Nano Banana Pro');
    expect(options).toContain('Nano Banana 2');
    expect(options).toContain('Nano Banana 2 Lite');

    // Video models & controls MUST NOT exist
    expect(screen.queryByLabelText('AI Video Model')).toBeNull();
    expect(screen.queryByText(/Omni Duration/i)).toBeNull();
    expect(screen.queryByText(/Veo Duration/i)).toBeNull();
    expect(screen.queryByText(/Native Flow Duration/i)).toBeNull();
    expect(screen.queryByText(/1080p/i)).toBeNull();
    expect(screen.queryByText(/4k/i)).toBeNull();
  });

  it('Bulk Image Studio contains batch prompt controls and no video settings', async () => {
    render(
      <GenerationStudioScreen
        initialMode="bulk_image"
        onProjectCreated={onProjectCreated}
        onCancel={onCancel}
        onNavigateProfiles={onNavigateProfiles}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Bulk Image Studio')).toBeDefined();
    expect(screen.getByText('Batch Prompt Composer')).toBeDefined();
    expect(screen.getByLabelText('AI Image Engine')).toBeDefined();
    expect(screen.queryByLabelText('AI Video Model')).toBeNull();
    expect(screen.queryByText(/Veo Duration/i)).toBeNull();
  });

  it('Veo 3.1 - Quality displays 10s Cinema Default and NO duration buttons', async () => {
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

    expect(screen.getByText('Single Video Studio')).toBeDefined();
    const qualityCard = screen.getByLabelText('Veo 3.1 - Quality');
    fireEvent.click(qualityCard);

    // Quality has fixed 10s output profile
    expect(screen.getByText('Cinema Output')).toBeDefined();
    expect(screen.getByText('10s Fixed')).toBeDefined();
    expect(screen.getAllByText(/10s/i).length).toBeGreaterThan(0);

    // Duration buttons (4s, 6s) must NOT be shown for Quality
    expect(screen.queryByRole('button', { name: '4s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '6s' })).toBeNull();
  });

  it('Veo 3.1 - Fast displays fixed 8s High-Speed Default and NO duration buttons', async () => {
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

    const fastCard = screen.getByLabelText('Veo 3.1 - Fast');
    fireEvent.click(fastCard);

    expect(screen.getByText('Fast Output')).toBeDefined();
    expect(screen.getByText('8s Fixed')).toBeDefined();
    expect(screen.getAllByText(/8s/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '4s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '6s' })).toBeNull();
  });

  it('Omni 1.1 Flash provides 4s / 6s / 8s / 10s and 360p / 720p selectors', async () => {
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

    const omniCard = screen.getByLabelText('Omni 1.1 Flash');
    fireEvent.click(omniCard);

    expect(screen.getByText('10s')).toBeDefined();
    expect(screen.getByText('360p')).toBeDefined();
    expect(screen.getByText('720p')).toBeDefined();
  });

  it('AppShell remounts GenerationStudioScreen with isolated state on navigation', async () => {
    render(<AppShell />);

    await act(async () => {
      await Promise.resolve();
    });

    // AppShell opens on 'projects' view by default. Click 'Single Image' to navigate
    const singleImageNav = screen.getByText('Single Image');
    fireEvent.click(singleImageNav);

    await act(async () => {
      await Promise.resolve();
    });

    // Now in Single Image Studio
    expect(screen.getByText('Single Image Studio')).toBeDefined();

    // Type a prompt in image studio
    const promptArea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(promptArea, { target: { value: 'Test image prompt' } });
    expect((promptArea as HTMLTextAreaElement).value).toBe('Test image prompt');

    // Navigate to Single Video via sidebar
    const videoNavBtn = screen.getByText('Single Video');
    fireEvent.click(videoNavBtn);

    await act(async () => {
      await Promise.resolve();
    });

    // Should now be in Single Video Studio
    expect(screen.getByText('Single Video Studio')).toBeDefined();
    const videoPromptArea = screen.getByPlaceholderText(/Describe your scene, camera movement, and lighting/i);
    // State must be cleanly isolated: empty prompt, not leaked from image mode
    expect((videoPromptArea as HTMLTextAreaElement).value).toBe('');
  });
});
