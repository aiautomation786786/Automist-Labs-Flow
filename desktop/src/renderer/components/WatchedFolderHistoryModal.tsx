import React, { useState, useEffect } from 'react';
import type {
  WatchedFolderEntity,
  WatchedFileRecord,
} from '../../shared/types';
import {
  FolderIcon,
  CloseIcon,
  RefreshIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
} from './Icons';

export interface WatchedFolderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  watcher: WatchedFolderEntity | null;
  onOpenProject?: (projectId: string) => void;
}

export const WatchedFolderHistoryModal: React.FC<WatchedFolderHistoryModalProps> = ({
  isOpen,
  onClose,
  watcher,
  onOpenProject,
}) => {
  const [history, setHistory] = useState<WatchedFileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!watcher || !window.flowApi?.getWatchedFolderHistory) return;
    setLoading(true);
    setError(null);
    try {
      const records = await window.flowApi.getWatchedFolderHistory(watcher.id, 100);
      setHistory(records || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load watched folder history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && watcher) {
      loadHistory();
    } else {
      setHistory([]);
      setError(null);
    }
  }, [isOpen, watcher]);

  if (!isOpen || !watcher) return null;

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: WatchedFileRecord['status']) => {
    switch (status) {
      case 'ingested':
        return (
          <span
            data-testid="badge-status-ingested"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            <CheckCircleIcon size={12} />
            Ingested
          </span>
        );
      case 'waiting_for_cadence':
        return (
          <span
            data-testid="badge-status-scheduled"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(139, 92, 246, 0.15)',
              color: '#a78bfa',
              border: '1px solid rgba(139, 92, 246, 0.3)',
            }}
          >
            <ClockIcon size={12} />
            Scheduled
          </span>
        );
      case 'processing':
        return (
          <span
            data-testid="badge-status-processing"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(6, 182, 212, 0.15)',
              color: '#22d3ee',
              border: '1px solid rgba(6, 182, 212, 0.3)',
            }}
          >
            Processing...
          </span>
        );
      case 'stabilizing':
        return (
          <span
            data-testid="badge-status-stabilizing"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            Stabilizing...
          </span>
        );
      case 'skipped_duplicate':
        return (
          <span
            data-testid="badge-status-duplicate"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(156, 163, 175, 0.15)',
              color: '#9ca3af',
              border: '1px solid rgba(156, 163, 175, 0.3)',
            }}
          >
            Duplicate
          </span>
        );
      case 'error':
        return (
          <span
            data-testid="badge-status-error"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <AlertCircleIcon size={12} />
            Error
          </span>
        );
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            Ready
          </span>
        );
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
          maxWidth: '820px',
          maxHeight: '85vh',
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
                Activity Ledger: {watcher.name}
              </h2>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '2px' }}>
                {watcher.folderPath}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-icon"
              data-testid="btn-refresh-history"
              onClick={loadHistory}
              title="Refresh ledger"
              disabled={loading}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '6px',
              }}
            >
              <RefreshIcon size={16} />
            </button>
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
        </div>

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
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
                marginBottom: '16px',
              }}
            >
              <AlertCircleIcon size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
              Loading activity records...
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
                <FolderIcon size={32} />
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                No files detected yet
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Media dropped into this folder will appear in this ledger as it stabilizes and processes.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>File Name</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Size</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Detected</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record) => (
                    <tr
                      key={record.id}
                      data-testid={`history-row-${record.filename}`}
                      style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}
                    >
                      <td style={{ padding: '10px', color: 'var(--text-primary)', fontWeight: 500 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{record.filename}</span>
                          {record.error && (
                            <span style={{ fontSize: '11px', color: '#f87171', marginTop: '2px' }}>
                              {record.error}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        {getStatusBadge(record.status)}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                        {formatFileSize(record.fileSizeBytes)}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                        {new Date(record.detectedAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px' }}>
                        {record.projectId ? (
                          <button
                            type="button"
                            className="btn-sm btn-secondary"
                            onClick={() => {
                              onClose();
                              onOpenProject?.(record.projectId!);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              fontSize: '11px',
                            }}
                          >
                            <span>Open</span>
                            <ExternalLinkIcon size={11} />
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            Showing {history.length} records &bull; Bounded ledger
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
