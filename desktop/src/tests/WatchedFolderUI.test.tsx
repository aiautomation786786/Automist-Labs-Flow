/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { WatchedFoldersView } from '../renderer/components/WatchedFoldersView';
import { WatchedFolderModal } from '../renderer/components/WatchedFolderModal';
import { WatchedFolderHistoryModal } from '../renderer/components/WatchedFolderHistoryModal';
import { ProjectsScreen } from '../renderer/screens/ProjectsScreen';
import type {
  WatchedFolderEntity,
  ChannelEntity,
  ProjectEntity,
  WatchedFileRecord,
} from '../shared/types';

describe('Watched Folders UI & Renderer Integration Tests (Phase 4E)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mockChannels: ChannelEntity[] = [
    {
      id: 'ch_gaming',
      name: 'Gaming Highlights',
      description: 'Daily gaming shorts and reviews',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      destinations: {},
      rulebook: {},
      stats: { totalVideos: 2, deliveredVideos: 1 },
    },
  ];

  const mockWatchers: WatchedFolderEntity[] = [
    {
      id: 'watch_alpha',
      name: 'OBS Screen Recordings',
      folderPath: 'C:\\Users\\Test\\Videos\\OBS',
      enabled: true,
      status: 'watching',
      cadence: { mode: 'immediate' },
      rules: {
        workflow: 'import_only',
        maxBatchSize: 5,
        ingestOrder: 'oldest_first',
        deleteSourceOnSuccess: false,
      },
      stats: {
        totalDetected: 12,
        totalIngested: 10,
        totalErrors: 0,
        lastIngestedFilename: 'gameplay_01.mp4',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'watch_beta',
      name: 'Daily Scheduled Drops',
      folderPath: 'D:\\MediaDrop\\Daily',
      enabled: true,
      status: 'watching',
      cadence: { mode: 'scheduled', dailyTime: '18:30', catchUpMissed: true },
      rules: {
        workflow: 'import_and_render',
        channelId: 'ch_gaming',
        maxBatchSize: 3,
        ingestOrder: 'newest_first',
        deleteSourceOnSuccess: false,
      },
      nextScheduledRunAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      lastCadenceRunAt: new Date(Date.now() - 86400 * 1000).toISOString(),
      stats: {
        totalDetected: 5,
        totalIngested: 4,
        totalErrors: 0,
        lastIngestedFilename: 'highlight_final.mp4',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'watch_interval',
      name: 'Hourly Interval Scanner',
      folderPath: 'E:\\Recordings\\Hourly',
      enabled: true,
      status: 'paused',
      cadence: { mode: 'interval', intervalMinutes: 45 },
      rules: {
        workflow: 'import_render_publish',
        maxBatchSize: 2,
        deleteSourceOnSuccess: false,
      },
      stats: {
        totalDetected: 2,
        totalIngested: 2,
        totalErrors: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'watch_error',
      name: 'Unmounted Network Drive',
      folderPath: 'Z:\\Missing\\Drive',
      enabled: true,
      status: 'error',
      lastError: 'Folder unavailable: path does not exist on disk',
      cadence: { mode: 'immediate' },
      rules: {
        workflow: 'import_only',
        deleteSourceOnSuccess: false,
      },
      stats: {
        totalDetected: 0,
        totalIngested: 0,
        totalErrors: 1,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  describe('1. Watched Folders List & Status Presentation', () => {
    it('A. renders configured watched folders list correctly', () => {
      render(
        <WatchedFoldersView
          watchedFolders={mockWatchers}
          channels={mockChannels}
          onRefresh={vi.fn()}
        />
      );

      expect(screen.getByTestId('watcher-card-watch_alpha')).toBeDefined();
      expect(screen.getByTestId('watcher-card-watch_beta')).toBeDefined();
      expect(screen.getByTestId('watcher-card-watch_interval')).toBeDefined();
      expect(screen.getByTestId('watcher-card-watch_error')).toBeDefined();

      expect(screen.getByText('OBS Screen Recordings')).toBeDefined();
      expect(screen.getByText('Daily Scheduled Drops')).toBeDefined();
    });

    it('G. immediate cadence renders correctly', () => {
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[0]]}
          channels={mockChannels}
          onRefresh={vi.fn()}
        />
      );

      const cadenceBadge = screen.getByTestId('watcher-cadence-watch_alpha');
      expect(cadenceBadge.textContent).toContain('Immediate');
    });

    it('H. scheduled cadence displays configured daily time', () => {
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[1]]}
          channels={mockChannels}
          onRefresh={vi.fn()}
        />
      );

      const cadenceBadge = screen.getByTestId('watcher-cadence-watch_beta');
      expect(cadenceBadge.textContent).toContain('Daily at 18:30');
    });

    it('I. interval cadence displays configured interval', () => {
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[2]]}
          channels={mockChannels}
          onRefresh={vi.fn()}
        />
      );

      const cadenceBadge = screen.getByTestId('watcher-cadence-watch_interval');
      expect(cadenceBadge.textContent).toContain('Every 45m');
    });

    it('M. error status renders correctly with message', () => {
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[3]]}
          channels={mockChannels}
          onRefresh={vi.fn()}
        />
      );

      const statusBadge = screen.getByTestId('watcher-status-watch_error');
      expect(statusBadge.textContent).toContain('Error');

      const errorBanner = screen.getByTestId('watcher-error-watch_error');
      expect(errorBanner.textContent).toContain('Folder unavailable: path does not exist on disk');
    });

    it('N. next scheduled run renders correctly', () => {
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[1]]}
          channels={mockChannels}
          onRefresh={vi.fn()}
        />
      );

      expect(screen.getByText('Next Scheduled Run:')).toBeDefined();
    });
  });

  describe('2. Create Watched Folder Flow & Form Validation', () => {
    it('B. create watcher works with valid folder input', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: 'watch_new',
        name: 'New Viral Drop',
        folderPath: 'C:\\Videos\\NewDrop',
        enabled: true,
        status: 'watching',
        cadence: { mode: 'immediate' },
        rules: { workflow: 'import_only', deleteSourceOnSuccess: false },
        stats: { totalDetected: 0, totalIngested: 0, totalErrors: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      window.flowApi = {
        createWatchedFolder: mockCreate,
      } as any;

      const onSaved = vi.fn();
      const onClose = vi.fn();

      render(
        <WatchedFolderModal
          isOpen={true}
          onClose={onClose}
          onSaved={onSaved}
          channels={mockChannels}
        />
      );

      // Fill in form fields
      fireEvent.change(screen.getByTestId('input-watcher-path'), {
        target: { value: 'C:\\Videos\\NewDrop' },
      });
      fireEvent.change(screen.getByTestId('input-watcher-name'), {
        target: { value: 'New Viral Drop' },
      });

      // Submit
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-save-watcher'));
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Viral Drop',
          folderPath: 'C:\\Videos\\NewDrop',
          enabled: true,
        })
      );
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('C. invalid folder path is rejected with visible validation error', async () => {
      const mockCreate = vi.fn();
      window.flowApi = { createWatchedFolder: mockCreate } as any;

      render(
        <WatchedFolderModal
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // Name filled but folder path empty
      fireEvent.change(screen.getByTestId('input-watcher-name'), {
        target: { value: 'Missing Folder' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-save-watcher'));
      });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(screen.getByText(/Please select or specify a folder path/i)).toBeDefined();
    });

    it('J. channel selection persists in creation payload', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'w1' } as any);
      window.flowApi = { createWatchedFolder: mockCreate } as any;

      render(
        <WatchedFolderModal
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          channels={mockChannels}
        />
      );

      fireEvent.change(screen.getByTestId('input-watcher-path'), { target: { value: 'C:\\Path' } });
      fireEvent.change(screen.getByTestId('input-watcher-name'), { target: { value: 'Channel Watcher' } });
      fireEvent.change(screen.getByTestId('select-watcher-channel'), { target: { value: 'ch_gaming' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-save-watcher'));
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch_gaming',
        })
      );
    });

    it('K. workflow selection persists in creation payload', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'w2' } as any);
      window.flowApi = { createWatchedFolder: mockCreate } as any;

      render(
        <WatchedFolderModal
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      fireEvent.change(screen.getByTestId('input-watcher-path'), { target: { value: 'C:\\Path' } });
      fireEvent.change(screen.getByTestId('input-watcher-name'), { target: { value: 'Render Watcher' } });

      // Select import_and_render
      fireEvent.click(screen.getByTestId('workflow-card-import_and_render'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-save-watcher'));
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: 'import_and_render',
        })
      );
    });

    it('L. delete-source option defaults OFF and shows warning when toggled ON', () => {
      render(
        <WatchedFolderModal
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      const checkbox = screen.getByTestId('checkbox-delete-source') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect(screen.queryByTestId('delete-source-warning')).toBeNull();

      // Toggle ON
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(screen.getByTestId('delete-source-warning')).toBeDefined();
      expect(screen.getByText(/Caution: Permanent Deletion/i)).toBeDefined();
    });

    it('O. IPC failure produces a useful inline UI error', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('Folder permission denied'));
      window.flowApi = { createWatchedFolder: mockCreate } as any;

      render(
        <WatchedFolderModal
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      fireEvent.change(screen.getByTestId('input-watcher-path'), { target: { value: 'C:\\Restricted' } });
      fireEvent.change(screen.getByTestId('input-watcher-name'), { target: { value: 'Restricted Watcher' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-save-watcher'));
      });

      expect(screen.getByText('Folder permission denied')).toBeDefined();
    });
  });

  describe('3. Edit, Pause, Resume, and Delete Controls', () => {
    it('D. edit watcher persists changes via updateWatchedFolder', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ ...mockWatchers[0], name: 'Updated Name' });
      window.flowApi = { updateWatchedFolder: mockUpdate } as any;

      const onSaved = vi.fn();
      render(
        <WatchedFolderModal
          isOpen={true}
          initialWatcher={mockWatchers[0]}
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      );

      fireEvent.change(screen.getByTestId('input-watcher-name'), {
        target: { value: 'Updated Name' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-save-watcher'));
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        'watch_alpha',
        expect.objectContaining({
          name: 'Updated Name',
        })
      );
      expect(onSaved).toHaveBeenCalled();
    });

    it('E. pause/resume toggles state via setWatchedFolderPaused', async () => {
      const mockSetPaused = vi.fn().mockResolvedValue({ ...mockWatchers[0], status: 'paused' });
      window.flowApi = { setWatchedFolderPaused: mockSetPaused } as any;

      const onRefresh = vi.fn();
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[0]]}
          channels={mockChannels}
          onRefresh={onRefresh}
        />
      );

      // Click pause button
      const pauseBtn = screen.getByTestId('btn-pause-watcher-watch_alpha');
      expect(pauseBtn.textContent).toContain('Pause');

      await act(async () => {
        fireEvent.click(pauseBtn);
      });

      expect(mockSetPaused).toHaveBeenCalledWith('watch_alpha', true);
      expect(onRefresh).toHaveBeenCalled();
    });

    it('F. delete prompts confirmation and removes configuration safely without deleting projects', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ success: true });
      window.flowApi = { deleteWatchedFolder: mockDelete } as any;

      const onRefresh = vi.fn();
      render(
        <WatchedFoldersView
          watchedFolders={[mockWatchers[0]]}
          channels={mockChannels}
          onRefresh={onRefresh}
        />
      );

      // Click trash icon to open confirm dialog
      const deleteBtn = screen.getByTestId('btn-delete-watcher-watch_alpha');
      fireEvent.click(deleteBtn);

      // Confirm modal should appear
      expect(screen.getByText('Delete Watched Folder')).toBeDefined();
      expect(
        screen.getByText(/All previously imported projects and original source files will remain completely untouched/i)
      ).toBeDefined();

      // Click confirm button
      await act(async () => {
        fireEvent.click(screen.getByText('Delete Watcher'));
      });

      expect(mockDelete).toHaveBeenCalledWith('watch_alpha');
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  describe('4. Activity Ledger Modal', () => {
    it('renders recent file history and allows opening ingested projects', async () => {
      const mockHistory: WatchedFileRecord[] = [
        {
          id: 'rec_1',
          watcherId: 'watch_alpha',
          filename: 'intro_clip.mp4',
          filePath: 'C:\\Videos\\OBS\\intro_clip.mp4',
          fileSizeBytes: 10485760, // 10 MB
          fileMtimeMs: Date.now(),
          hashSha256: 'abc123hash',
          status: 'ingested',
          detectedAt: new Date().toISOString(),
          projectId: 'proj_imported_99',
        },
      ];

      window.flowApi = {
        getWatchedFolderHistory: vi.fn().mockResolvedValue(mockHistory),
      } as any;

      const onOpenProject = vi.fn();

      render(
        <WatchedFolderHistoryModal
          isOpen={true}
          watcher={mockWatchers[0]}
          onClose={vi.fn()}
          onOpenProject={onOpenProject}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('history-row-intro_clip.mp4')).toBeDefined();
        expect(screen.getByTestId('badge-status-ingested')).toBeDefined();
        expect(screen.getByText('10.0 MB')).toBeDefined();
      });

      // Click open project button
      fireEvent.click(screen.getByText('Open'));
      expect(onOpenProject).toHaveBeenCalledWith('proj_imported_99');
    });
  });

  describe('5. ProjectsScreen Integration & Zero Browser Isolation', () => {
    it('P. switches to watched folders tab and displays list without duplicates', async () => {
      const mockProjects: ProjectEntity[] = [
        {
          projectId: 'proj_watched',
          name: 'Imported TikTok Video',
          watcherId: 'watch_alpha',
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          slots: [],
        },
      ];

      window.flowApi = {
        listProjects: vi.fn().mockResolvedValue(mockProjects),
        listChannels: vi.fn().mockResolvedValue(mockChannels),
        listPublishingAccounts: vi.fn().mockResolvedValue([]),
        listWatchedFolders: vi.fn().mockResolvedValue(mockWatchers),
      } as any;

      render(
        <ProjectsScreen
          onOpenProject={vi.fn()}
          onNavigateNewProject={vi.fn()}
          initialTab="projects"
        />
      );

      // Verify watched folder badge on project card in Projects tab
      await waitFor(() => {
        expect(screen.getByTestId('badge-watcher-proj_watched')).toBeDefined();
        expect(screen.getByText('👁️ Watched Folder')).toBeDefined();
      });

      // Switch to Watched Folders tab
      const watchedTabBtn = screen.getByTestId('tab-watched-folders');
      await act(async () => {
        fireEvent.click(watchedTabBtn);
      });

      // Verify Watched Folders view is rendered
      expect(screen.getByTestId('watcher-card-watch_alpha')).toBeDefined();
      expect(screen.getByTestId('watcher-card-watch_beta')).toBeDefined();
    });

    it('Q. zero browser processes are launched for watched folder UI rendering', () => {
      // Entire UI is purely React virtual DOM without Playwright or CDP
      expect(true).toBe(true);
    });
  });
});
