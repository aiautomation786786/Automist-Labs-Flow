/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { WorkspaceScreen } from '../renderer/screens/WorkspaceScreen';
import type { ProjectEntity } from '../shared/types';

describe('WorkspaceScreen Content-Aware Assembly Panel Visibility', () => {
  afterEach(() => {
    cleanup();
  });
  function buildProject(params: {
    projectId: string;
    name: string;
    slots: Array<{ type: 'image' | 'video'; status: 'draft' | 'queued' | 'completed'; mediaPath?: string }>;
    mode?: 'full_video' | 'from_skill';
  }): ProjectEntity {
    const slots = params.slots.map((s, idx) => ({
      slotIndex: idx,
      promptId: `slot_${idx}`,
      projectId: params.projectId,
      type: s.type,
      promptText: `Prompt ${idx}`,
      status: s.status,
      result: s.mediaPath ? { assetId: `res_${idx}`, mediaPath: s.mediaPath } : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    return {
      projectId: params.projectId,
      name: params.name,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        imageRatio: '16:9',
        videoRatio: '16:9',
        mode: params.mode,
      },
      slots,
      stats: {
        totalImages: slots.filter((s) => s.type === 'image').length,
        totalVideos: slots.filter((s) => s.type === 'video').length,
        completedImages: slots.filter((s) => s.type === 'image' && s.status === 'completed').length,
        completedVideos: slots.filter((s) => s.type === 'video' && s.status === 'completed').length,
        failedCount: 0,
      },
    };
  }

  function setupFlowApi(project: ProjectEntity, finalManifest: any = null) {
    window.flowApi = {
      getProject: vi.fn().mockResolvedValue(project),
      startProjectGeneration: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([project]),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      cancelJob: vi.fn(),
      getProjectJobs: vi.fn().mockResolvedValue([]),
      listProfiles: vi.fn().mockResolvedValue([]),
      onJobProgress: vi.fn().mockReturnValue(() => {}),
      onSlotUpdated: vi.fn().mockReturnValue(() => {}),
      onJobCompleted: vi.fn().mockReturnValue(() => {}),
      onJobFailed: vi.fn().mockReturnValue(() => {}),
      onFinalRenderProgress: vi.fn().mockReturnValue(() => {}),
      getFinalRenderManifest: vi.fn().mockResolvedValue(finalManifest),
      getPipelineStatus: vi.fn().mockResolvedValue(null),
      onPipelineProgress: vi.fn().mockReturnValue(() => {}),
      listChannels: vi.fn().mockResolvedValue([]),
      assembleFinalVideo: vi.fn().mockResolvedValue(finalManifest),
    } as any;
  }

  it('1. Pure Single Image Project: HIDES the Final Video & Music Assembly panel', async () => {
    const project = buildProject({
      projectId: 'proj_single_img',
      name: 'Single Image Project',
      slots: [{ type: 'image', status: 'completed', mediaPath: 'C:\\test\\img1.png' }],
    });
    setupFlowApi(project);

    render(<WorkspaceScreen projectId={project.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('final-video-assembly-panel')).toBeNull();
    expect(screen.queryByText('Final Video & Music Assembly')).toBeNull();
  });

  it('2. Pure Bulk Image Project: HIDES the Final Video & Music Assembly panel', async () => {
    const project = buildProject({
      projectId: 'proj_bulk_img',
      name: 'Bulk Image Project',
      slots: [
        { type: 'image', status: 'completed', mediaPath: 'C:\\test\\img1.png' },
        { type: 'image', status: 'completed', mediaPath: 'C:\\test\\img2.png' },
        { type: 'image', status: 'completed', mediaPath: 'C:\\test\\img3.png' },
      ],
    });
    setupFlowApi(project);

    render(<WorkspaceScreen projectId={project.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('final-video-assembly-panel')).toBeNull();
    expect(screen.queryByText('Final Video & Music Assembly')).toBeNull();
  });

  it('3. Single Video Project (1 video slot): HIDES the Final Video & Music Assembly panel', async () => {
    const project = buildProject({
      projectId: 'proj_single_video',
      name: 'Single Video Project',
      slots: [{ type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid1.mp4' }],
    });
    setupFlowApi(project);

    render(<WorkspaceScreen projectId={project.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('final-video-assembly-panel')).toBeNull();
    expect(screen.queryByText('Final Video & Music Assembly')).toBeNull();
  });

  it('4. Multi-Video Project (2+ video slots, draft): SHOWS assembly panel with disabled button and helper text', async () => {
    const project = buildProject({
      projectId: 'proj_multi_video_draft',
      name: 'Multi Video Project Draft',
      slots: [
        { type: 'video', status: 'draft' },
        { type: 'video', status: 'draft' },
        { type: 'video', status: 'draft' },
      ],
    });
    setupFlowApi(project);

    render(<WorkspaceScreen projectId={project.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('final-video-assembly-panel')).toBeDefined();
    expect(screen.getByText('Final Video & Music Assembly')).toBeDefined();

    const btn = screen.getByTestId('assemble-final-video-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const hint = screen.getByTestId('assemble-requirement-hint');
    expect(hint.textContent).toContain('At least 2 completed video clips required for assembly (0 ready)');
  });

  it('5. Multi-Video Project (2 completed video slots): SHOWS assembly panel with ENABLED assemble button', async () => {
    const project = buildProject({
      projectId: 'proj_multi_video_completed',
      name: 'Multi Video Completed',
      slots: [
        { type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid1.mp4' },
        { type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid2.mp4' },
      ],
    });
    setupFlowApi(project);

    render(<WorkspaceScreen projectId={project.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('final-video-assembly-panel')).toBeDefined();

    const btn = screen.getByTestId('assemble-final-video-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId('assemble-requirement-hint')).toBeNull();
  });

  it('6. Image-to-Video single vs bulk: single hides, bulk shows', async () => {
    // Single image-to-video (1 video slot)
    const singleI2V = buildProject({
      projectId: 'proj_i2v_single',
      name: 'Single Image-to-Video',
      slots: [{ type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid1.mp4' }],
    });
    setupFlowApi(singleI2V);

    const { unmount } = render(<WorkspaceScreen projectId={singleI2V.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('final-video-assembly-panel')).toBeNull();
    unmount();

    // Bulk image-to-video (3 video slots)
    const bulkI2V = buildProject({
      projectId: 'proj_i2v_bulk',
      name: 'Bulk Image-to-Video',
      slots: [
        { type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid1.mp4' },
        { type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid2.mp4' },
        { type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid3.mp4' },
      ],
    });
    setupFlowApi(bulkI2V);

    render(<WorkspaceScreen projectId={bulkI2V.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('final-video-assembly-panel')).toBeDefined();
    const btn = screen.getByTestId('assemble-final-video-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('7. Video Factory mode: ALWAYS shows assembly panel regardless of slot count', async () => {
    const factoryProject = buildProject({
      projectId: 'proj_factory',
      name: 'Factory Video',
      mode: 'full_video',
      slots: [],
    });
    setupFlowApi(factoryProject);

    render(<WorkspaceScreen projectId={factoryProject.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('final-video-assembly-panel')).toBeDefined();
  });

  it('8. Project with existing completed finalManifest: SHOWS panel with Watch Video button', async () => {
    const completedManifest = {
      projectId: 'proj_with_manifest',
      status: 'completed',
      videoFile: 'final/final.mp4',
      absoluteVideoPath: 'C:\\test\\final.mp4',
      durationSeconds: 12.5,
      fileSizeBytes: 5000000,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
    };

    const project = buildProject({
      projectId: 'proj_with_manifest',
      name: 'Project with Final Video',
      slots: [{ type: 'video', status: 'completed', mediaPath: 'C:\\test\\vid1.mp4' }],
    });
    setupFlowApi(project, completedManifest);

    render(<WorkspaceScreen projectId={project.projectId} onBackToProjects={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByTestId('final-video-assembly-panel')).toBeDefined();
    expect(screen.getByText('Watch Video')).toBeDefined();
  });
});
