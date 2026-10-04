/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SingleVideoStudio } from '../renderer/screens/SingleVideoStudio';

describe('SingleVideoStudio UI & Flow Component Tests', () => {
  let onProjectCreated: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onProjectCreated = vi.fn();
    onCancel = vi.fn();

    window.flowApi = {
      listProfiles: vi.fn().mockResolvedValue([
        { profileId: 'prof_1', displayName: 'Account 1', email: 'one@flow.com', status: 'ready' },
        { profileId: 'prof_2', displayName: 'Account 2', email: 'two@flow.com', status: 'ready' },
        { profileId: 'prof_3', displayName: 'Account 3', email: 'three@flow.com', status: 'ready' },
        { profileId: 'prof_4', displayName: 'Account 4', email: 'four@flow.com', status: 'ready' },
        { profileId: 'prof_5', displayName: 'Account 5', email: 'five@flow.com', status: 'ready' },
        { profileId: 'prof_6', displayName: 'Account 6', email: 'six@flow.com', status: 'ready' },
      ]),
      createProject: vi.fn().mockResolvedValue({ projectId: 'proj_vid_123', name: 'Single Video' }),
      startProjectGeneration: vi.fn().mockResolvedValue([{ jobId: 'job_vid_123', slotIndex: 0 }]),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      cancelJob: vi.fn().mockResolvedValue(true),
      revealAsset: vi.fn().mockResolvedValue(true),
    } as any;
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('1. Renders Studio Header, Back button, and 6 Accounts Ready status badge', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Single Video Studio')).toBeDefined();
    expect(screen.getByText('Pro Motion')).toBeDefined();
    expect(screen.getByText(/6 Flow Accounts Ready/i)).toBeDefined();
    expect(screen.getByText('Video Prompt')).toBeDefined();

    // Clicking back triggers onCancel
    const backBtn = screen.getByLabelText('Back');
    fireEvent.click(backBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it('2. Renders all 4 AI Video Models in 2x2 grid and allows switching', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Veo 3.1 - Quality')).toBeDefined();
    expect(screen.getByLabelText('Veo 3.1 - Fast')).toBeDefined();
    expect(screen.getByLabelText('Veo 3.1 - Lite')).toBeDefined();
    expect(screen.getByLabelText('Omni 1.1 Flash')).toBeDefined();

    // Verify concise descriptions
    expect(screen.getByText('Cinema-grade realism with rich motion, physics & lighting.')).toBeDefined();
    expect(screen.getByText('Fast 8s generation for dynamic motion and rapid iteration.')).toBeDefined();
    expect(screen.getByText('Efficient 8s generation for quick, lightweight creation.')).toBeDefined();
    expect(screen.getByText('Flexible duration and resolution with Flow or Gemini.')).toBeDefined();

    // Default selected model is Veo 3.1 - Fast
    const activeHeader = screen.getAllByText(/Active:/i)[0];
    expect(activeHeader.textContent).toContain('Veo 3.1 - Fast');

    // Select Quality
    fireEvent.click(screen.getByLabelText('Veo 3.1 - Quality'));
    const updatedHeader = screen.getAllByText(/Active:/i)[0];
    expect(updatedHeader.textContent).toContain('Veo 3.1 - Quality');
  });

  it('3. Veo 3.1 Quality enforces fixed 10s Cinema duration without duration buttons', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByLabelText('Veo 3.1 - Quality'));

    expect(screen.getByText('Cinema Output')).toBeDefined();
    expect(screen.getByText('10s Fixed')).toBeDefined();
    expect(screen.getByText('Maximum fidelity for cinematic motion & detail.')).toBeDefined();
    expect(screen.getAllByText(/10s/i).length).toBeGreaterThan(0);

    // Duration buttons (4s, 6s) must not be present
    expect(screen.queryByRole('button', { name: '4s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '6s' })).toBeNull();
  });

  it('4. Veo 3.1 Fast and Lite enforce fixed 8s duration without duration selector buttons', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    // Fast
    fireEvent.click(screen.getByLabelText('Veo 3.1 - Fast'));
    expect(screen.getByText('Fast Output')).toBeDefined();
    expect(screen.getByText('8s Fixed')).toBeDefined();
    expect(screen.getByText('Optimized for dynamic motion and rapid iteration.')).toBeDefined();
    expect(screen.getAllByText(/8s/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '4s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '6s' })).toBeNull();

    // Lite
    fireEvent.click(screen.getByLabelText('Veo 3.1 - Lite'));
    expect(screen.getByText('Efficient Output')).toBeDefined();
    expect(screen.getByText('8s Fixed')).toBeDefined();
    expect(screen.getByText('Lightweight generation with faster turnaround.')).toBeDefined();
    expect(screen.getAllByText(/8s/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '4s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '6s' })).toBeNull();
  });

  it('5. Omni 1.1 Flash allows toggling Google Flow vs Gemini Clean with distinct controls', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByLabelText('Omni 1.1 Flash'));

    // Flow controls
    expect(screen.getAllByText('Google Flow').length).toBeGreaterThan(0);
    expect(screen.getByText('Gemini (Clean)')).toBeDefined();
    expect(screen.getAllByText('10s').length).toBeGreaterThan(0);
    expect(screen.getByText('360p')).toBeDefined();
    expect(screen.getByText('720p')).toBeDefined();

    // Toggle to Gemini
    fireEvent.click(screen.getByText('Gemini (Clean)'));
    expect(screen.getByText(/✨ Watermark Removed Automatically/i)).toBeDefined();
    expect(screen.getByText(/10s Duration/i)).toBeDefined();
  });

  it('6. Strict UI absence: generic Export Resolution and Account Dispatch are completely absent', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/Export Resolution/i)).toBeNull();
    expect(screen.queryByText(/1080p Upscaled/i)).toBeNull();
    expect(screen.queryByText(/2K/i)).toBeNull();
    expect(screen.queryByText(/4K/i)).toBeNull();
    expect(screen.queryByText(/Select Profile/i)).toBeNull();
    expect(screen.queryByText(/Worker Dispatch/i)).toBeNull();
  });

  it('7. Submits single video generation with locked native original resolution', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    // Enter prompt
    const textarea = screen.getByLabelText('Scene prompt');
    fireEvent.change(textarea, { target: { value: 'A cinematic drone shot through an emerald valley' } });

    // Click Generate Video (x1)
    const generateBtn = screen.getByText('Generate Video (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        generationMode: 'single_video',
        videoModel: 'Veo 3.1 - Fast',
        videoRatio: '16:9',
        videoDuration: '8s',
        videoDownloadQuality: 'original',
        prompts: [
          expect.objectContaining({
            text: 'A cinematic drone shot through an emerald valley',
            type: 'video',
            provider: 'flow',
          }),
        ],
      })
    );

    expect(window.flowApi?.startProjectGeneration).toHaveBeenCalledWith('proj_vid_123');

    // Floating progress modal must appear
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Generating Single Video')).toBeDefined();
  });

  it('8. Supports switching to 9:16 portrait aspect ratio', async () => {
    render(<SingleVideoStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    await act(async () => {
      await Promise.resolve();
    });

    const portraitCard = screen.getByLabelText('9:16 Portrait');
    fireEvent.click(portraitCard);

    const ratioHeader = screen.getAllByText(/Active:/i)[1];
    expect(ratioHeader.textContent).toContain('9:16 Portrait');

    const textarea = screen.getByLabelText('Scene prompt');
    fireEvent.change(textarea, { target: { value: 'Vertical reel of urban architecture' } });

    const generateBtn = screen.getByText('Generate Video (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        videoRatio: '9:16',
      })
    );
  });
});
