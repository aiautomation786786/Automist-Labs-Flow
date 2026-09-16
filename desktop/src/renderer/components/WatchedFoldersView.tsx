import React, { useState } from 'react';
import type {
  WatchedFolderEntity,
  ChannelEntity,
  WatchedMediaWorkflow,
  WatchedFolderCadenceConfig,
} from '../../shared/types';
import {
  FolderIcon,
  PlusIcon,
  PlayIcon,
  PauseIcon,
  TrashIcon,
  SettingsIcon,
  ClockIcon,
  AlertCircleIcon,
} from './Icons';
import { ConfirmModal } from './ConfirmModal';
import { WatchedFolderModal } from './WatchedFolderModal';
import { WatchedFolderHistoryModal } from './WatchedFolderHistoryModal';

export interface WatchedFoldersViewProps {
  watchedFolders: WatchedFolderEntity[];
  channels: ChannelEntity[];
  onRefresh: () => void;
  onOpenProject?: (projectId: string) => void;
  setNotification?: (notif: { message: string; isError?: boolean }) => void;
}

export const WatchedFoldersView: React.FC<WatchedFoldersViewProps> = ({
  watchedFolders,
  channels,
  onRefresh,
  onOpenProject,
  setNotification,
}) => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingWatcher, setEditingWatcher] = useState<WatchedFolderEntity | null>(null);
  const [historyWatcher, setHistoryWatcher] = useState<WatchedFolderEntity | null>(null);
  const [watcherToDelete, setWatcherToDelete] = useState<WatchedFolderEntity | null>(null);

  const getStatusBadge = (watcher: WatchedFolderEntity) => {
    if (!watcher.enabled) {
      return {
        label: 'Disabled',
        color: '#9ca3af',
        bg: 'rgba(156, 163, 175, 0.15)',
        border: 'rgba(156, 163, 175, 0.3)',
        dot: '#9ca3af',
      };
    }
    switch (watcher.status) {
      case 'watching':
        return {
          label: 'Watching',
          color: '#34d399',
          bg: 'rgba(16, 185, 129, 0.15)',
          border: 'rgba(16, 185, 129, 0.3)',
          dot: '#10b981',
        };
      case 'paused':
        return {
          label: 'Paused',
          color: '#fbbf24',
          bg: 'rgba(245, 158, 11, 0.15)',
          border: 'rgba(245, 158, 11, 0.3)',
          dot: '#f59e0b',
        };
      case 'processing':
        return {
          label: 'Processing',
          color: '#22d3ee',
          bg: 'rgba(6, 182, 212, 0.15)',
          border: 'rgba(6, 182, 212, 0.3)',
          dot: '#06b6d4',
        };
      case 'error':
        return {
          label: 'Error',
          color: '#f87171',
          bg: 'rgba(239, 68, 68, 0.15)',
          border: 'rgba(239, 68, 68, 0.3)',
          dot: '#ef4444',
        };
      default:
        return {
          label: 'Idle',
          color: '#9ca3af',
          bg: 'rgba(156, 163, 175, 0.15)',
          border: 'rgba(156, 163, 175, 0.3)',
          dot: '#9ca3af',
        };
    }
  };

  const getWorkflowLabel = (wf: WatchedMediaWorkflow) => {
    switch (wf) {
      case 'import_only':
        return 'Import Only';
      case 'import_and_render':
        return 'Import & Render';
      case 'import_render_publish':
        return 'Import, Render & Publish';
      case 'ai_script_rewrite':
        return 'AI Script Rewrite';
      default:
        return wf;
    }
  };

  const getCadenceLabel = (cadence?: WatchedFolderCadenceConfig) => {
    if (!cadence || cadence.mode === 'immediate') return 'Immediate';
    if (cadence.mode === 'scheduled') return `Daily at ${cadence.dailyTime || '18:00'}`;
    if (cadence.mode === 'interval') return `Every ${cadence.intervalMinutes || 60}m`;
    return 'Immediate';
  };

  const handleTogglePause = async (watcher: WatchedFolderEntity) => {
    if (!window.flowApi?.setWatchedFolderPaused) return;
    const isPaused = watcher.status === 'paused';
    try {
      await window.flowApi.setWatchedFolderPaused(watcher.id, !isPaused);
      setNotification?.({
        message: `Watched folder "${watcher.name}" ${isPaused ? 'resumed' : 'paused'}.`,
      });
      onRefresh();
    } catch (err: any) {
      setNotification?.({
        message: `Failed to ${isPaused ? 'resume' : 'pause'} watcher: ${err.message}`,
        isError: true,
      });
    }
  };

  const handleToggleEnable = async (watcher: WatchedFolderEntity) => {
    if (!window.flowApi?.updateWatchedFolder) return;
    const newEnabled = !watcher.enabled;
    try {
      await window.flowApi.updateWatchedFolder(watcher.id, { enabled: newEnabled });
      setNotification?.({
        message: `Watched folder "${watcher.name}" ${newEnabled ? 'enabled' : 'disabled'}.`,
      });
      onRefresh();
    } catch (err: any) {
      setNotification?.({
        message: `Failed to update watcher: ${err.message}`,
        isError: true,
      });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!watcherToDelete || !window.flowApi?.deleteWatchedFolder) return;
    try {
      await window.flowApi.deleteWatchedFolder(watcherToDelete.id);
      setNotification?.({
        message: `Watched folder "${watcherToDelete.name}" deleted. Existing projects and source files are preserved.`,
      });
      setWatcherToDelete(null);
      onRefresh();
    } catch (err: any) {
      setNotification?.({
        message: `Failed to delete watched folder: ${err.message}`,
        isError: true,
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sub-Header Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Configured Folders ({watchedFolders.length})
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Files dropped into these folders will be automatically ingested as standard Infinity Flow projects.
          </p>
        </div>

        <button
          type="button"
          data-testid="btn-add-watched-folder"
          className="btn-primary"
          onClick={() => {
            setEditingWatcher(null);
            setIsCreateModalOpen(true);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <PlusIcon size={16} />
          <span>Add Watched Folder</span>
        </button>
      </div>

      {/* Empty State */}
      {watchedFolders.length === 0 ? (
        <div
          data-testid="watched-folders-empty-state"
          style={{
            backgroundColor: 'var(--bg-surface, rgba(255, 255, 255, 0.02))',
            border: '1px dashed var(--border-color)',
            borderRadius: '12px',
            padding: '50px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FolderIcon size={24} />
          </div>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            No watched folders yet
          </h4>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: 1.4 }}>
            Add a local folder to automatically import, render, and process new media files as they are saved to your drive.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditingWatcher(null);
              setIsCreateModalOpen(true);
            }}
            style={{ marginTop: '8px' }}
          >
            <PlusIcon size={16} />
            Add Watched Folder
          </button>
        </div>
      ) : (
        /* Watcher Cards Grid */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
          {watchedFolders.map((watcher) => {
            const badge = getStatusBadge(watcher);
            const assignedChannel = channels.find((c) => c.id === watcher.rules?.channelId);
            const isPaused = watcher.status === 'paused';

            return (
              <div
                key={watcher.id}
                data-testid={`watcher-card-${watcher.id}`}
                className="card"
                style={{
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  backgroundColor: 'var(--bg-surface, rgba(255, 255, 255, 0.03))',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  transition: 'border-color 0.15s ease',
                }}
              >
                {/* Card Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(99, 102, 241, 0.12)',
                        color: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <FolderIcon size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h4
                        data-testid={`watcher-name-${watcher.id}`}
                        style={{
                          margin: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {watcher.name}
                      </h4>
                      <div
                        data-testid={`watcher-path-${watcher.id}`}
                        title={watcher.folderPath}
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '2px',
                        }}
                      >
                        {watcher.folderPath}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span
                      data-testid={`watcher-status-${watcher.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.border}`,
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: badge.dot,
                        }}
                      />
                      {badge.label}
                    </span>

                    <input
                      type="checkbox"
                      data-testid={`watcher-toggle-enable-${watcher.id}`}
                      checked={watcher.enabled}
                      onChange={() => handleToggleEnable(watcher)}
                      title={watcher.enabled ? 'Disable watcher' : 'Enable watcher'}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                    />
                  </div>
                </div>

                {/* Badges / Settings Overview */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span
                    data-testid={`watcher-workflow-${watcher.id}`}
                    style={{
                      fontSize: '11px',
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(99, 102, 241, 0.1)',
                      color: 'var(--accent-primary)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      fontWeight: 500,
                    }}
                  >
                    {getWorkflowLabel(watcher.rules?.workflow || 'import_only')}
                  </span>

                  <span
                    data-testid={`watcher-cadence-${watcher.id}`}
                    style={{
                      fontSize: '11px',
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(139, 92, 246, 0.1)',
                      color: '#a78bfa',
                      border: '1px solid rgba(139, 92, 246, 0.25)',
                      fontWeight: 500,
                    }}
                  >
                    {getCadenceLabel(watcher.cadence)}
                  </span>

                  {assignedChannel ? (
                    <span
                      data-testid={`watcher-channel-${watcher.id}`}
                      style={{
                        fontSize: '11px',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        color: '#60a5fa',
                        border: '1px solid rgba(59, 130, 246, 0.25)',
                        fontWeight: 500,
                      }}
                    >
                      📺 {assignedChannel.name}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(156, 163, 175, 0.08)',
                        color: 'var(--text-muted)',
                        border: '1px solid rgba(156, 163, 175, 0.15)',
                      }}
                    >
                      Unsorted
                    </span>
                  )}
                </div>

                {/* Stats & Activity */}
                <div
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                    <span>
                      Detected: <strong style={{ color: 'var(--text-primary)' }}>{watcher.stats?.totalDetected || 0}</strong>
                    </span>
                    <span>
                      Ingested: <strong style={{ color: '#34d399' }}>{watcher.stats?.totalIngested || 0}</strong>
                    </span>
                    <span>
                      Errors: <strong style={{ color: watcher.stats?.totalErrors ? '#f87171' : 'var(--text-primary)' }}>{watcher.stats?.totalErrors || 0}</strong>
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <span>Last Ingested:</span>
                      <span style={{ color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {watcher.stats?.lastIngestedFilename || 'None yet'}
                      </span>
                    </div>

                    {watcher.cadence?.mode !== 'immediate' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <span>Next Scheduled Run:</span>
                        <span style={{ color: '#a78bfa' }}>
                          {watcher.nextScheduledRunAt ? new Date(watcher.nextScheduledRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Error Banner */}
                {watcher.lastError && (
                  <div
                    data-testid={`watcher-error-${watcher.id}`}
                    style={{
                      padding: '8px 10px',
                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '11.5px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <AlertCircleIcon size={14} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {watcher.lastError}
                    </span>
                  </div>
                )}

                {/* Card Actions */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: 'auto' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      data-testid={`btn-pause-watcher-${watcher.id}`}
                      className="btn-sm btn-secondary"
                      onClick={() => handleTogglePause(watcher)}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px' }}
                    >
                      {isPaused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
                      <span>{isPaused ? 'Resume' : 'Pause'}</span>
                    </button>

                    <button
                      type="button"
                      data-testid={`btn-history-watcher-${watcher.id}`}
                      className="btn-sm btn-secondary"
                      onClick={() => setHistoryWatcher(watcher)}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px' }}
                    >
                      <ClockIcon size={13} />
                      <span>Ledger</span>
                    </button>

                    <button
                      type="button"
                      data-testid={`btn-edit-watcher-${watcher.id}`}
                      className="btn-sm btn-secondary"
                      onClick={() => {
                        setEditingWatcher(watcher);
                        setIsCreateModalOpen(true);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px' }}
                    >
                      <SettingsIcon size={13} />
                      <span>Edit</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid={`btn-delete-watcher-${watcher.id}`}
                    className="btn-sm btn-danger"
                    onClick={() => setWatcherToDelete(watcher)}
                    title="Delete watched folder configuration"
                    style={{ padding: '4px 8px' }}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Watched Folder Modal (Create / Edit) */}
      <WatchedFolderModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingWatcher(null);
        }}
        initialWatcher={editingWatcher}
        channels={channels}
        onSaved={(_saved) => {
          setNotification?.({
            message: `Watched folder "${_saved.name}" successfully saved.`,
          });
          onRefresh();
        }}
      />

      {/* History Ledger Modal */}
      <WatchedFolderHistoryModal
        isOpen={Boolean(historyWatcher)}
        onClose={() => setHistoryWatcher(null)}
        watcher={historyWatcher}
        onOpenProject={onOpenProject}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(watcherToDelete)}
        title="Delete Watched Folder"
        message={`Are you sure you want to delete watched folder "${watcherToDelete?.name}"? Its monitoring configuration and activity ledger will be removed. All previously imported projects and original source files will remain completely untouched.`}
        confirmLabel="Delete Watcher"
        cancelLabel="Cancel"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setWatcherToDelete(null)}
      />
    </div>
  );
};
