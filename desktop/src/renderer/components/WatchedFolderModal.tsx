import React, { useState, useEffect } from 'react';
import type {
  WatchedFolderEntity,
  ChannelEntity,
  WatchedMediaWorkflow,
  CadenceMode,
} from '../../shared/types';
import {
  FolderIcon,
  AlertCircleIcon,
  CloseIcon,
} from './Icons';

export interface WatchedFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (entity: WatchedFolderEntity) => void;
  initialWatcher?: WatchedFolderEntity | null;
  channels?: ChannelEntity[];
}

export const WatchedFolderModal: React.FC<WatchedFolderModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialWatcher,
  channels = [],
}) => {
  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [channelId, setChannelId] = useState('');
  const [workflow, setWorkflow] = useState<WatchedMediaWorkflow>('import_only');
  const [cadenceMode, setCadenceMode] = useState<CadenceMode>('immediate');
  const [dailyTime, setDailyTime] = useState('18:00');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [catchUpMissed, setCatchUpMissed] = useState(true);
  const [publishDelayHours, setPublishDelayHours] = useState(0);

  const [ingestOrder, setIngestOrder] = useState<'oldest_first' | 'newest_first'>('oldest_first');
  const [maxBatchSize, setMaxBatchSize] = useState(5);
  const [stabilitySec, setStabilitySec] = useState(20);
  const [deleteSourceOnSuccess, setDeleteSourceOnSuccess] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialWatcher) {
      setName(initialWatcher.name || '');
      setFolderPath(initialWatcher.folderPath || '');
      setChannelId(initialWatcher.rules?.channelId || '');
      setWorkflow(initialWatcher.rules?.workflow || 'import_only');
      setCadenceMode(initialWatcher.cadence?.mode || 'immediate');
      setDailyTime(initialWatcher.cadence?.dailyTime || '18:00');
      setIntervalMinutes(initialWatcher.cadence?.intervalMinutes || 60);
      setCatchUpMissed(initialWatcher.cadence?.catchUpMissed !== false);
      setPublishDelayHours(initialWatcher.cadence?.publishDelayHours || 0);

      setIngestOrder(initialWatcher.rules?.ingestOrder || 'oldest_first');
      setMaxBatchSize(initialWatcher.rules?.maxBatchSize || 5);
      setStabilitySec(
        initialWatcher.rules?.stabilityDurationMs
          ? Math.round(initialWatcher.rules.stabilityDurationMs / 1000)
          : 20
      );
      setDeleteSourceOnSuccess(initialWatcher.rules?.deleteSourceOnSuccess || false);
    } else {
      setName('');
      setFolderPath('');
      setChannelId('');
      setWorkflow('import_only');
      setCadenceMode('immediate');
      setDailyTime('18:00');
      setIntervalMinutes(60);
      setCatchUpMissed(true);
      setPublishDelayHours(0);
      setIngestOrder('oldest_first');
      setMaxBatchSize(5);
      setStabilitySec(20);
      setDeleteSourceOnSuccess(false);
    }
    setError(null);
  }, [initialWatcher, isOpen]);

  if (!isOpen) return null;

  const handleBrowseFolder = async () => {
    if (window.flowApi?.selectDirectory) {
      try {
        const selected = await window.flowApi.selectDirectory();
        if (selected) {
          setFolderPath(selected);
          if (!name.trim()) {
            const base = selected.split(/[\\/]/).filter(Boolean).pop();
            if (base) setName(base);
          }
        }
      } catch (err: any) {
        console.error('Failed to select directory', err);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedPath = folderPath.trim();
    if (!trimmedPath) {
      setError('Please select or specify a folder path to watch.');
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please provide a name for this watched folder.');
      return;
    }

    if (cadenceMode === 'scheduled') {
      const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeRegex.test(dailyTime.trim())) {
        setError('Scheduled mode requires a valid 24-hour time format (HH:mm), e.g. 18:00.');
        return;
      }
    }

    if (cadenceMode === 'interval') {
      if (isNaN(intervalMinutes) || intervalMinutes < 1) {
        setError('Interval mode requires a positive number of minutes (at least 1 minute).');
        return;
      }
    }

    if (workflow === 'import_render_publish') {
      if (isNaN(publishDelayHours) || publishDelayHours < 0) {
        setError('Publish delay hours cannot be negative.');
        return;
      }
    }

    if (isNaN(maxBatchSize) || maxBatchSize < 1) {
      setError('Maximum files per scan must be at least 1.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: trimmedName,
        folderPath: trimmedPath,
        channelId: channelId || undefined,
        workflow,
        cadence: {
          mode: cadenceMode,
          dailyTime: cadenceMode === 'scheduled' ? dailyTime.trim() : undefined,
          intervalMinutes: cadenceMode === 'interval' ? Number(intervalMinutes) : undefined,
          catchUpMissed,
          publishDelayHours: workflow === 'import_render_publish' ? Number(publishDelayHours) : 0,
        },
        rules: {
          workflow,
          channelId: channelId || undefined,
          ingestOrder,
          maxBatchSize: Number(maxBatchSize),
          stabilityDurationMs: Math.max(1000, Number(stabilitySec) * 1000),
          deleteSourceOnSuccess,
        },
      };

      let saved: WatchedFolderEntity;
      if (initialWatcher) {
        if (!window.flowApi?.updateWatchedFolder) {
          throw new Error('updateWatchedFolder API is not available.');
        }
        saved = await window.flowApi.updateWatchedFolder(initialWatcher.id, payload);
      } else {
        if (!window.flowApi?.createWatchedFolder) {
          throw new Error('createWatchedFolder API is not available.');
        }
        saved = await window.flowApi.createWatchedFolder({
          ...payload,
          enabled: true,
        });
      }

      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save watched folder configuration.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 30px -10px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FolderIcon size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {initialWatcher ? 'Edit Watched Folder' : 'Add Watched Folder'}
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Automatically monitor local folders to import, render, and process new media.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
          <div
            style={{
              padding: '20px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              flex: 1,
            }}
          >
            {error && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '8px',
                  color: '#f87171',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <AlertCircleIcon size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {/* Folder & Name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Folder to Watch *
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    data-testid="input-watcher-path"
                    placeholder="C:\Users\...\Videos\Inbox"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '9px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    data-testid="btn-browse-folder"
                    className="btn-secondary"
                    onClick={handleBrowseFolder}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Browse...
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Infinity Flow monitors this directory for supported media (MP4, MOV, MKV, WebM, AVI, etc.).
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Watcher Name *
                </label>
                <input
                  type="text"
                  data-testid="input-watcher-name"
                  placeholder="e.g. Daily TikTok Ingest"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Channel Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Content Channel (Optional)
              </label>
              <select
                data-testid="select-watcher-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-input, rgba(0, 0, 0, 0.25))',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                }}
              >
                <option value="">None (Unsorted Projects)</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Imported projects will automatically inherit this channel's branding, rulebook, and export destinations.
              </div>
            </div>

            {/* Workflow Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Downstream Workflow
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  {
                    id: 'import_only',
                    title: 'Import Only',
                    desc: 'Adds raw video directly into Projects as a project draft.',
                  },
                  {
                    id: 'import_and_render',
                    title: 'Import & Render',
                    desc: 'Extracts audio and renders local video automatically.',
                  },
                  {
                    id: 'import_render_publish',
                    title: 'Import, Render & Publish',
                    desc: 'Renders video and prepares YouTube native scheduling.',
                  },
                  {
                    id: 'ai_script_rewrite',
                    title: 'AI Script Rewrite',
                    desc: 'Transcribes audio and extracts speech subtitles.',
                  },
                ].map((wf) => {
                  const isSelected = workflow === wf.id;
                  return (
                    <div
                      key={wf.id}
                      data-testid={`workflow-card-${wf.id}`}
                      onClick={() => setWorkflow(wf.id as WatchedMediaWorkflow)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: isSelected
                          ? '1px solid var(--accent-primary)'
                          : '1px solid var(--border-color)',
                        backgroundColor: isSelected
                          ? 'rgba(99, 102, 241, 0.1)'
                          : 'rgba(0, 0, 0, 0.15)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="radio"
                          name="workflow"
                          checked={isSelected}
                          onChange={() => setWorkflow(wf.id as WatchedMediaWorkflow)}
                          style={{ margin: 0, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                          {wf.title}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', paddingLeft: '22px' }}>
                        {wf.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cadence Section */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Processing Cadence
              </label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                {[
                  { id: 'immediate', label: 'Immediate' },
                  { id: 'scheduled', label: 'Daily Schedule' },
                  { id: 'interval', label: 'Recurring Interval' },
                ].map((mode) => {
                  const isSelected = cadenceMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      data-testid={`cadence-mode-${mode.id}`}
                      className={`btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setCadenceMode(mode.id as CadenceMode)}
                      style={{ flex: 1 }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>

              {cadenceMode === 'immediate' && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '6px 2px' }}>
                  Files will be imported immediately once stabilized in the watched folder.
                </div>
              )}

              {cadenceMode === 'scheduled' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-primary)', minWidth: '120px' }}>
                      Daily Time (Local):
                    </label>
                    <input
                      type="time"
                      data-testid="input-cadence-time"
                      value={dailyTime}
                      onChange={(e) => setDailyTime(e.target.value)}
                      style={{
                        padding: '7px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Files detected throughout the day will be held in queue and processed in batch at {dailyTime}.
                  </div>
                </div>
              )}

              {cadenceMode === 'interval' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-primary)', minWidth: '120px' }}>
                      Repeat Every:
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        data-testid="input-cadence-interval"
                        min={1}
                        value={intervalMinutes}
                        onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        style={{
                          width: '80px',
                          padding: '7px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                        }}
                      />
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>minutes</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Held files will be processed in batches every {intervalMinutes} minutes.
                  </div>
                </div>
              )}

              {cadenceMode !== 'immediate' && (
                <div style={{ marginTop: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      data-testid="checkbox-catchup-missed"
                      checked={catchUpMissed}
                      onChange={(e) => setCatchUpMissed(e.target.checked)}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                      Catch up missed schedules when computer wakes or app restarts
                    </span>
                  </label>
                </div>
              )}

              {/* YouTube Native Publish Delay (Only for import_render_publish) */}
              {workflow === 'import_render_publish' && (
                <div style={{ marginTop: '14px', padding: '10px', borderRadius: '6px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#f87171' }}>
                      YouTube Publish Delay:
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        data-testid="input-publish-delay"
                        min={0}
                        value={publishDelayHours}
                        onChange={(e) => setPublishDelayHours(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        style={{
                          width: '60px',
                          padding: '5px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                        }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>hours after rendering</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Media is rendered locally when cadence triggers; YouTube native scheduled publish time is set {publishDelayHours} hours later.
                  </div>
                </div>
              )}
            </div>

            {/* Ingestion & Safety Rules */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Ingestion Rules & Safeguards
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Ingest Order
                  </label>
                  <select
                    data-testid="select-ingest-order"
                    value={ingestOrder}
                    onChange={(e) => setIngestOrder(e.target.value as 'oldest_first' | 'newest_first')}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                    }}
                  >
                    <option value="oldest_first">Oldest First (Chronological)</option>
                    <option value="newest_first">Newest First (Recent)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Max Batch Size Per Scan
                  </label>
                  <input
                    type="number"
                    data-testid="input-max-batch-size"
                    min={1}
                    max={50}
                    value={maxBatchSize}
                    onChange={(e) => setMaxBatchSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Delete Source Warning Option */}
              <div style={{ marginTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    data-testid="checkbox-delete-source"
                    checked={deleteSourceOnSuccess}
                    onChange={(e) => setDeleteSourceOnSuccess(e.target.checked)}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: deleteSourceOnSuccess ? '#f87171' : 'var(--text-primary)' }}>
                    Delete source video file after successful project import
                  </span>
                </label>

                {deleteSourceOnSuccess && (
                  <div
                    data-testid="delete-source-warning"
                    style={{
                      marginTop: '8px',
                      padding: '10px 12px',
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '12px',
                      lineHeight: 1.4,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                    }}
                  >
                    <AlertCircleIcon size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong>Caution: Permanent Deletion</strong>
                      <p style={{ margin: '4px 0 0' }}>
                        Original video files in this folder will be permanently deleted once ingestion and project creation succeed. This action cannot be reversed.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="btn-save-watcher"
              className="btn-primary"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : initialWatcher ? 'Update Watcher' : 'Create Watcher'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
