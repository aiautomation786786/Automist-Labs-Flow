/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ChannelsScreen } from '../renderer/screens/ChannelsScreen';
import type { ChannelEntity, ProjectEntity, DeliveryHistoryRecord } from '../shared/types';

describe('ChannelsScreen React UI Component Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mockChannels: ChannelEntity[] = [
    {
      id: 'chan_01',
      name: 'Cosmic Wonders',
      description: 'Documentaries on astronomy and celestial events',
      enabled: true,
      defaultAspectRatio: '16:9',
      defaultMotionStyle: 'slow_push_in',
      defaultTransitionStyle: 'cross_fade',
      rulebook: {
        narrationStyle: 'Epic and thoughtful',
        tone: 'Awe-inspiring',
      },
      createdAt: '2026-09-10T10:00:00.000Z',
      updatedAt: '2026-09-10T10:00:00.000Z',
      stats: {
        totalProjects: 2,
        deliveredVideos: 1,
        lastDeliveredAt: '2026-09-10T12:00:00.000Z',
      },
    },
    {
      id: 'chan_02',
      name: 'Ocean Odyssey',
      description: 'Underwater exploration and marine ecosystems',
      enabled: true,
      defaultAspectRatio: '9:16',
      defaultMotionStyle: 'breathe',
      defaultTransitionStyle: 'hard_cut',
      createdAt: '2026-09-10T11:00:00.000Z',
      updatedAt: '2026-09-10T11:00:00.000Z',
      stats: {
        totalProjects: 1,
        deliveredVideos: 0,
      },
    },
  ];

  const mockProjects: ProjectEntity[] = [
    {
      projectId: 'proj_1',
      name: 'Journey to the Rings',
      channelId: 'chan_01',
      channelName: 'Cosmic Wonders',
      status: 'completed',
      createdAt: '2026-09-10T10:00:00.000Z',
      updatedAt: '2026-09-10T10:00:00.000Z',
      settings: {
        imageRatio: '16:9',
        videoRatio: '16:9',
        processingOrder: 'images_first',
        autoRetry: true,
        maxRetries: 2,
      },
      stats: { totalImages: 1, totalVideos: 1, completedImages: 1, completedVideos: 1, failedCount: 0 },
      slots: [],
    },
    {
      projectId: 'proj_2',
      name: 'Abyssal Creatures',
      channelId: undefined,
      channelName: undefined,
      status: 'draft',
      createdAt: '2026-09-10T11:00:00.000Z',
      updatedAt: '2026-09-10T11:00:00.000Z',
      settings: {
        imageRatio: '9:16',
        videoRatio: '9:16',
        processingOrder: 'images_first',
        autoRetry: true,
        maxRetries: 2,
      },
      stats: { totalImages: 1, totalVideos: 0, completedImages: 0, completedVideos: 0, failedCount: 0 },
      slots: [],
    },
  ];

  const mockHistory: DeliveryHistoryRecord[] = [
    {
      id: 'deliv_01',
      projectId: 'proj_1',
      projectName: 'Journey to the Rings',
      channelId: 'chan_01',
      channelName: 'Cosmic Wonders',
      sourceVideoPath: '/src/final.mp4',
      deliveredVideoPath: '/delivered/journey_to_the_rings.mp4',
      aspectRatio: '16:9',
      durationSeconds: 15.0,
      fileSizeBytes: 8000000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      status: 'delivered',
      deliveredAt: '2026-09-10T12:00:00.000Z',
    },
  ];

  beforeEach(() => {
    (window as any).flowApi = {
      listChannels: vi.fn().mockResolvedValue(mockChannels),
      listProjects: vi.fn().mockResolvedValue(mockProjects),
      getChannelHistory: vi.fn().mockResolvedValue({ records: mockHistory, total: 1, limit: 100, offset: 0 }),
      deleteChannel: vi.fn().mockResolvedValue({ success: true, unassignedProjects: 1 }),
      assignProjectToChannel: vi.fn().mockResolvedValue({ ...mockProjects[1], channelId: 'chan_01', channelName: 'Cosmic Wonders' }),
      deliverProjectToChannel: vi.fn().mockResolvedValue(mockHistory[0]),
      revealAsset: vi.fn().mockResolvedValue(true),
    };
  });

  it('1. Renders ChannelsScreen header, metrics, and channel cards', async () => {
    await act(async () => {
      render(<ChannelsScreen />);
    });

    expect(screen.getByText('Channels & Automation')).toBeDefined();
    expect(screen.getByText('Cosmic Wonders')).toBeDefined();
    expect(screen.getByText('Ocean Odyssey')).toBeDefined();
    expect(screen.getByText('Active Channels')).toBeDefined();
    expect(screen.getByText('Total Delivered Videos')).toBeDefined();
  });

  it('2. Filters channels by search query', async () => {
    await act(async () => {
      render(<ChannelsScreen />);
    });

    const searchInput = screen.getByPlaceholderText('Search channels, titles...');
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Cosmic' } });
    });

    expect(screen.getByText('Cosmic Wonders')).toBeDefined();
    expect(screen.queryByText('Ocean Odyssey')).toBeNull();
  });

  it('3. Opens New Channel modal when button clicked', async () => {
    await act(async () => {
      render(<ChannelsScreen />);
    });

    const newBtn = screen.getByText('New Channel');
    act(() => {
      fireEvent.click(newBtn);
    });

    expect(screen.getByText('New Channel Setup')).toBeDefined();
    expect(screen.getByText('Rulebook Guidelines')).toBeDefined();
  });

  it('4. Switches to Projects tab and shows assignment dropdowns', async () => {
    await act(async () => {
      render(<ChannelsScreen />);
    });

    const projectsTab = screen.getByText(/Projects \(2\)/);
    act(() => {
      fireEvent.click(projectsTab);
    });

    expect(screen.getByText('Journey to the Rings')).toBeDefined();
    expect(screen.getByText('Abyssal Creatures')).toBeDefined();
  });

  it('5. Switches to Delivery History tab and shows delivery record', async () => {
    await act(async () => {
      render(<ChannelsScreen />);
    });

    const historyTab = screen.getByText(/Delivery History \(1\)/);
    act(() => {
      fireEvent.click(historyTab);
    });

    expect(screen.getByText('DELIVERED')).toBeDefined();
    expect(screen.getByText('/delivered/journey_to_the_rings.mp4')).toBeDefined();
  });

  it('6. Triggers safe channel deletion with confirmation modal', async () => {
    await act(async () => {
      render(<ChannelsScreen />);
    });

    // Find delete button
    const deleteButtons = screen.getAllByTitle('Delete Channel');
    act(() => {
      fireEvent.click(deleteButtons[0]);
    });

    // Verify confirmation modal appears explaining projects are not deleted
    expect(screen.getByText(/Are you sure you want to delete/)).toBeDefined();
    expect(screen.getByText(/will NOT be deleted; they will simply become unassigned/)).toBeDefined();
  });
});
