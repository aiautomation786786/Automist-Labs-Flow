/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SingleImageStudio } from '../renderer/screens/SingleImageStudio';

describe('SingleImageStudio Component & UX Suite', () => {
  const onProjectCreated = vi.fn();
  const onCancel = vi.fn();

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).flowApi = {
      listProfiles: vi.fn().mockResolvedValue([
        { profileId: 'prof_1', status: 'ready' },
        { profileId: 'prof_2', status: 'ready' },
      ]),
      createProject: vi.fn().mockResolvedValue({ projectId: 'proj_si_test_1' }),
      startProjectGeneration: vi.fn().mockResolvedValue([{ jobId: 'job_si_test_1' }]),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      revealAsset: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('1. Single Image uses full studio layout without permanent right generation pane', () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // Title and container
    expect(screen.getByText('Single Image Studio')).toBeDefined();
    expect(screen.getByText(/Generate production-ready imagery with Flow & Gemini/i)).toBeDefined();

    // Permanent right split panel text/elements MUST NOT exist
    expect(screen.queryByText('Single Image Canvas')).toBeNull();
    expect(screen.queryByText(/Select an AI model and aspect ratio, write your creative vision/i)).toBeNull();
  });

  it('2. renders all 4 supported models and 2 aspect ratios without video or upscale controls', () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // Model cards
    expect(screen.getByRole('button', { name: 'Nano Banana 2' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Nano Banana Pro' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Nano Banana 2 Lite' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Gemini Clean' })).toBeDefined();

    // Aspect ratios
    expect(screen.getByRole('button', { name: '16:9 Landscape' })).toBeDefined();
    expect(screen.getByRole('button', { name: '9:16 Portrait' })).toBeDefined();

    // Resolution controls are completely absent from Single Image Studio
    expect(screen.queryByText(/Export Resolution/i)).toBeNull();
    expect(screen.queryByText(/Original \(Native\)/i)).toBeNull();
    expect(screen.queryByText('Resolution: Original')).toBeNull();
    expect(screen.queryByText('Original')).toBeNull();
    expect(screen.queryByText(/2K/i)).toBeNull();
    expect(screen.queryByText(/4K/i)).toBeNull();

    // Zero video controls or account dispatch dropdowns
    expect(screen.queryByText('Veo 3.1')).toBeNull();
    expect(screen.queryByText('Omni 1.1 Flash')).toBeNull();
    expect(screen.queryByText('Account Dispatch')).toBeNull();
  });

  it('3. strictly excludes all resolution and upscale UI controls while persisting imageDownloadQuality: original', async () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    expect(screen.queryByText(/2K/i)).toBeNull();
    expect(screen.queryByText(/Export Resolution/i)).toBeNull();
    expect(screen.queryByText(/Original \(Native\)/i)).toBeNull();

    const textarea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(textarea, { target: { value: 'Verification prompt for resolution absence' } });

    const generateBtn = screen.getByText('Generate Image (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        generationMode: 'single_image',
        imageDownloadQuality: 'original',
      })
    );
  });

  it('4. populates prompt when clicking a sample inspiration chip', () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    const chip = screen.getByRole('button', { name: /Cinematic Product/i });
    fireEvent.click(chip);

    const textarea = screen.getByPlaceholderText(/Describe your desired image/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('A small red apple resting on a clean white table');
  });

  it('5. submits generation with Flow Nano Banana Pro in 9:16 aspect ratio', async () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    const proCard = screen.getByRole('button', { name: /Nano Banana Pro/i });
    fireEvent.click(proCard);

    const portraitBtn = screen.getByRole('button', { name: /9:16 Portrait/i });
    fireEvent.click(portraitBtn);

    const textarea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(textarea, { target: { value: 'Cinematic portrait of a cyberpunk detective' } });

    const generateBtn = screen.getByText('Generate Image (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        generationMode: 'single_image',
        provider: 'flow',
        imageModel: 'Nano Banana Pro',
        imageRatio: '9:16',
        imageDownloadQuality: 'original',
        prompts: [
          expect.objectContaining({
            text: 'Cinematic portrait of a cyberpunk detective',
            type: 'image',
            provider: 'flow',
          }),
        ],
      })
    );
    expect(window.flowApi?.startProjectGeneration).toHaveBeenCalledWith('proj_si_test_1');
  });

  it('6. submits generation with Gemini Without Watermark (Gemini Clean) via Cmd+Enter', async () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    const geminiCard = screen.getByRole('button', { name: /Gemini Clean/i });
    fireEvent.click(geminiCard);

    const textarea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(textarea, { target: { value: 'Clean unwatermarked crystal sculpture' } });

    // Submit via Cmd+Enter keyboard shortcut
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.flowApi?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        generationMode: 'gemini_single_image',
        provider: 'gemini',
        imageModel: 'Gemini Without Watermark',
        imageRatio: '16:9',
        geminiAspectRatio: '16:9',
        imageDownloadQuality: 'original',
        prompts: [
          expect.objectContaining({
            text: 'Clean unwatermarked crystal sculpture',
            type: 'image',
            provider: 'gemini',
          }),
        ],
      })
    );
    expect(window.flowApi?.startProjectGeneration).toHaveBeenCalledWith('proj_si_test_1');
  });

  it('7. Generate opens centered progress modal showing real stages and elapsed timer', async () => {
    let progressCallback: any = null;
    (window as any).flowApi.onJobProgress = vi.fn().mockImplementation((cb) => {
      progressCallback = cb;
      return () => {};
    });

    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    const textarea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(textarea, { target: { value: 'Test generation modal experience' } });

    const generateBtn = screen.getByText('Generate Image (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Modal dialog is mounted
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(screen.getByText('Generating your image')).toBeDefined();
    expect(screen.getByText(/Elapsed/i)).toBeDefined();

    // Stages checklist
    expect(screen.getByText('Preparing automation session')).toBeDefined();
    expect(screen.getByText('Configuring model & prompt')).toBeDefined();
    expect(screen.getByText('Generating image')).toBeDefined();
    expect(screen.getByText('Fetching media asset')).toBeDefined();
    expect(screen.getByText('Finalizing & saving image')).toBeDefined();

    // Simulate backend progress update
    expect(progressCallback).toBeTypeOf('function');
    await act(async () => {
      progressCallback({
        projectId: 'proj_si_test_1',
        jobId: 'job_si_test_1',
        stepDescription: 'Injecting prompt into Google Flow canvas...',
      });
    });

    expect(screen.getByText('Injecting prompt into Google Flow canvas...')).toBeDefined();
  });

  it('8. Modal transitions cleanly to success and renders generated result in studio', async () => {
    let slotCallback: any = null;
    (window as any).flowApi.onSlotUpdated = vi.fn().mockImplementation((cb) => {
      slotCallback = cb;
      return () => {};
    });

    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    const textarea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(textarea, { target: { value: 'A golden sunset over calm ocean waters' } });

    const generateBtn = screen.getByText('Generate Image (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate completion event
    expect(slotCallback).toBeTypeOf('function');
    await act(async () => {
      slotCallback({
        projectId: 'proj_si_test_1',
        slotIndex: 0,
        status: 'completed',
        result: {
          mediaPath: '/Users/mac/test/output.png',
          thumbnailPath: '/Users/mac/test/thumb.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          totalElapsedTimeMs: 12450,
        },
      });
    });

    // Modal shows success state
    expect(screen.getByText('Image Generated Successfully')).toBeDefined();

    // Studio result is rendered
    expect(screen.getByText('Generated Result')).toBeDefined();
    const openBtn = screen.getByRole('button', { name: /Open in Workspace/i });
    expect(openBtn).toBeDefined();

    // Reveal in Finder
    const revealBtn = screen.getByRole('button', { name: /Reveal in Finder/i });
    fireEvent.click(revealBtn);
    expect(window.flowApi?.revealAsset).toHaveBeenCalledWith('/Users/mac/test/output.png');

    // Open in Workspace button
    fireEvent.click(openBtn);
    expect(onProjectCreated).toHaveBeenCalledWith('proj_si_test_1');
  });

  it('9. renders model cards in a stable balanced 2x2 grid layout without collision', () => {
    const { container } = render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // AI Model Section exists and has 4 interactive cards
    const modelSectionTitle = screen.getByText('AI Model');
    expect(modelSectionTitle).toBeDefined();

    const modelCards = screen.getAllByRole('button').filter(
      (btn) =>
        btn.getAttribute('aria-label') === 'Nano Banana 2' ||
        btn.getAttribute('aria-label') === 'Nano Banana Pro' ||
        btn.getAttribute('aria-label') === 'Nano Banana 2 Lite' ||
        btn.getAttribute('aria-label') === 'Gemini Clean'
    );
    expect(modelCards.length).toBe(4);

    // Verify grid parent uses 2 columns
    const gridParent = modelCards[0].parentElement;
    expect(gridParent).toBeDefined();
    expect(gridParent?.style.display).toBe('grid');
    expect(gridParent?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');

    // Verify descriptions and tags are cleanly present inside each card
    expect(screen.getByText('Balanced speed & artistic quality for versatile imagery.')).toBeDefined();
    expect(screen.getByText('Ultra-high detail & complex spatial prompt fidelity.')).toBeDefined();
    expect(screen.getByText('Rapid iterations & lightweight preview generation.')).toBeDefined();
    expect(screen.getByText('Watermark-free direct imagery with crisp typography.')).toBeDefined();

    expect(screen.getByText('Popular')).toBeDefined();
    expect(screen.getByText('Pro Fidelity')).toBeDefined();
    expect(screen.getByText('Fastest')).toBeDefined();
    expect(screen.getByText('Unwatermarked')).toBeDefined();
  });

  it('10. initial studio layout fits without vertical scroll (overflowY: hidden) until results exist', async () => {
    let slotCallback: any = null;
    (window as any).flowApi.onSlotUpdated = vi.fn().mockImplementation((cb) => {
      slotCallback = cb;
      return () => {};
    });

    const { container } = render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // Root studio container has overflowY: hidden in initial view
    const studioContainer = container.querySelector('.if-studio-container') as HTMLElement;
    expect(studioContainer).toBeDefined();
    expect(studioContainer.style.overflowY).toBe('hidden');

    // Generate image and simulate completion
    const textarea = screen.getByPlaceholderText(/Describe your desired image/i);
    fireEvent.change(textarea, { target: { value: 'Zero scroll verification prompt' } });

    const generateBtn = screen.getByText('Generate Image (x1)');
    fireEvent.click(generateBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      slotCallback({
        projectId: 'proj_si_test_1',
        slotIndex: 0,
        status: 'completed',
        result: {
          mediaPath: '/Users/mac/test/scroll_output.png',
          modelUsed: 'Nano Banana 2',
          ratioUsed: '16:9',
          totalElapsedTimeMs: 8500,
        },
      });
    });

    // When generated result appears, overflowY transitions to auto to allow full inspection
    expect(studioContainer.style.overflowY).toBe('auto');
  });

  it('11. strictly removes technical dispatch and locked export notes from footer', () => {
    render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // Technical footer notes MUST be absent
    expect(screen.queryByText(/Dispatches automatically/i)).toBeNull();
    expect(screen.queryByText(/highest-capacity Flow profile/i)).toBeNull();
    expect(screen.queryByText(/Locked to native original export/i)).toBeNull();
    expect(screen.queryByText(/native original export/i)).toBeNull();

    // CTA button remains cleanly visible and operable
    const generateBtn = screen.getByRole('button', { name: /Generate Image \(x1\)/i });
    expect(generateBtn).toBeDefined();
  });

  it('12. incorporates vertical balance architecture with responsive studio classes', () => {
    const { container } = render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // Inner studio has responsive class and flex-1 full height layout
    const innerStudio = container.querySelector('.if-studio-inner') as HTMLElement;
    expect(innerStudio).toBeDefined();
    expect(innerStudio.style.flex).toContain('1');
    expect(innerStudio.style.gap).toBe('16px');

    // Textarea has responsive composer class and comfortable sizing
    const textarea = container.querySelector('.if-composer-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.style.minHeight).toBe('74px');

    // Model cards use responsive class and enlarged 118px minimum height (proper selectable blocks)
    const modelCards = container.querySelectorAll('.if-model-card');
    expect(modelCards.length).toBe(4);
    expect((modelCards[0] as HTMLElement).style.minHeight).toBe('118px');

    // Ratio cards use responsive class and enlarged 86px minimum height (matching model blocks)
    const ratioCards = container.querySelectorAll('.if-ratio-card');
    expect(ratioCards.length).toBe(2);
    expect((ratioCards[0] as HTMLElement).style.minHeight).toBe('86px');

    // CTA container uses marginTop: auto to sit naturally lower in workspace
    const ctaContainer = container.querySelector('.if-cta-container') as HTMLElement;
    expect(ctaContainer).toBeDefined();
    expect(ctaContainer.style.marginTop).toBe('auto');

    // CTA button uses responsive class and 50px height
    const ctaBtn = container.querySelector('.if-cta-button') as HTMLElement;
    expect(ctaBtn).toBeDefined();
    expect(ctaBtn.style.height).toBe('50px');
  });

  it('13. provides well-defined model selection blocks with controlled width and enhanced block proportion', () => {
    const { container } = render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    // Inner studio has controlled 820px width to prevent horizontally over-stretched cards
    const innerStudio = container.querySelector('.if-studio-inner') as HTMLElement;
    expect(innerStudio.style.maxWidth).toBe('820px');

    // 2x2 grid layout is verified
    const modelCards = container.querySelectorAll('.if-model-card');
    expect(modelCards.length).toBe(4);
    const gridParent = modelCards[0].parentElement as HTMLElement;
    expect(gridParent.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');

    // Each model card is a substantial 118px block
    modelCards.forEach((card) => {
      const el = card as HTMLElement;
      expect(el.style.minHeight).toBe('118px');
      expect(el.style.display).toBe('flex');
      expect(el.style.flexDirection).toBe('column');
    });

    // Ratio cards are visually consistent 86px blocks with 48px wireframe frame
    const ratioCards = container.querySelectorAll('.if-ratio-card');
    expect(ratioCards.length).toBe(2);
    ratioCards.forEach((card) => {
      const el = card as HTMLElement;
      expect(el.style.minHeight).toBe('86px');
    });
  });

  it('14. prompt focus owns state via outer composer without inner textarea double-border or glow', () => {
    const { container } = render(<SingleImageStudio onProjectCreated={onProjectCreated} onCancel={onCancel} />);

    const outerComposer = container.querySelector('.if-hero-composer') as HTMLElement;
    expect(outerComposer).toBeDefined();

    const textarea = container.querySelector('#single-image-prompt') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();

    // Inner textarea is visually transparent with no border, outline, or box shadow
    expect(textarea.style.borderStyle).toBe('none');
    expect(textarea.style.outline).toBe('none');
    expect(textarea.style.boxShadow).toBe('none');
    expect(textarea.style.background).toBe('transparent');

    // Focus textarea
    textarea.focus();
    fireEvent.focus(textarea);
    expect(document.activeElement).toBe(textarea);

    // Inner textarea maintains neutral styling upon focus (no double-ring/glow)
    expect(textarea.style.borderStyle).toBe('none');
    expect(textarea.style.outline).toBe('none');
    expect(textarea.style.boxShadow).toBe('none');

    // Prompt typing continues to work cleanly
    fireEvent.change(textarea, { target: { value: 'A solitary astronaut walking on violet sand dunes' } });
    expect(textarea.value).toBe('A solitary astronaut walking on violet sand dunes');

    // Blurring textarea works properly
    textarea.blur();
    fireEvent.blur(textarea);

    // Other controls (models, ratio, CTA) remain intact and operable
    const generateBtn = screen.getByRole('button', { name: /Generate Image \(x1\)/i }) as HTMLButtonElement;
    expect(generateBtn).toBeDefined();
    expect(generateBtn.disabled).toBe(false);
  });
});


