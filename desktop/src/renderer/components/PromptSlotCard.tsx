import React from 'react';
import type { PromptSlotEntity } from '../../shared/types';
import { PromptParser } from '../../shared/PromptParser';
import { EyeIcon, PlayIcon, RefreshIcon } from './Icons';

interface PromptSlotCardProps {
  slot: PromptSlotEntity;
  onViewPrompt: (slot: PromptSlotEntity) => void;
  onPreviewMedia: (slot: PromptSlotEntity) => void;
  onRetry?: (slot: PromptSlotEntity) => void;
}

export function formatMediaUrl(mediaPath?: string, projectId?: string): string {
  if (!mediaPath) return '';
  const normalized = mediaPath.replace(/\\/g, '/');
  if (projectId) {
    const pIdx = normalized.indexOf(projectId);
    if (pIdx !== -1) {
      const rel = normalized.substring(pIdx);
      return `flow-asset://${rel}`;
    }
  }
  return `file:///${normalized}`;
}

export const PromptSlotCard: React.FC<PromptSlotCardProps> = ({
  slot,
  onViewPrompt,
  onPreviewMedia,
  onRetry,
}) => {
  const slotNumber = `#${String(slot.slotIndex + 1).padStart(2, '0')}`;
  const promptPreview = PromptParser.getPreview(slot.promptText, 65);
  const mediaUrl = formatMediaUrl(slot.result?.mediaPath, slot.projectId);
  const isVideo = slot.type === 'video';

  // Human-readable status mapping
  const getStatusBadge = () => {
    switch (slot.status) {
      case 'completed':
        return <span className="badge badge-completed">Completed</span>;
      case 'running':
        return <span className="badge badge-running">Generating</span>;
      case 'queued':
        return <span className="badge badge-queued">Queued</span>;
      case 'draft':
        return <span className="badge badge-draft">Draft</span>;
      case 'failed':
        return <span className="badge badge-failed">Failed</span>;
      case 'cancelled':
        return <span className="badge badge-draft">Cancelled</span>;
      default:
        return <span className="badge badge-draft">{slot.status}</span>;
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: 'var(--shadow-sm)',
        minHeight: '190px',
      }}
    >
      {/* Top row: slot number, type badge, status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
            {slotNumber}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: isVideo ? '#f5f3ff' : '#eff6ff',
              color: isVideo ? '#7c3aed' : '#2563eb',
              border: `1px solid ${isVideo ? '#ddd6fe' : '#bfdbfe'}`,
            }}
          >
            {isVideo ? 'Video' : 'Image'}
          </span>
        </div>
        {getStatusBadge()}
      </div>

      {/* Media Preview or Progress Area */}
      <div
        style={{
          height: '110px',
          backgroundColor: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          cursor: slot.status === 'completed' ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (slot.status === 'completed') {
            onPreviewMedia(slot);
          }
        }}
        title={slot.status === 'completed' ? 'Click to open full preview' : undefined}
      >
        {slot.status === 'completed' && mediaUrl ? (
          <>
            {isVideo ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <video
                  src={mediaUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  muted
                  preload="metadata"
                />
                <div
                  style={{
                    position: 'absolute',
                    backgroundColor: 'rgba(15, 23, 42, 0.65)',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                  }}
                >
                  <PlayIcon size={16} />
                </div>
              </div>
            ) : (
              <img
                src={mediaUrl}
                alt={slotNumber}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
            )}
          </>
        ) : slot.status === 'running' ? (
          <div style={{ textAlign: 'center', padding: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 500 }}>
              Generating...
            </span>
          </div>
        ) : slot.status === 'failed' ? (
          <div style={{ textAlign: 'center', padding: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--danger)', display: 'block', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {slot.error?.message ?? 'Generation failed'}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Waiting in queue</span>
        )}
      </div>

      {/* Prompt preview snippet */}
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4', minHeight: '34px' }}>
        {promptPreview}
      </div>

      {/* Bottom row: Worker profile and Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '8px',
          marginTop: 'auto',
        }}
      >
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {slot.assignedProfileId ? `Profile: ${slot.assignedProfileId}` : 'Unassigned'}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {slot.status === 'failed' && onRetry && (
            <button className="btn-secondary btn-sm" onClick={() => onRetry(slot)} title="Retry generation">
              <RefreshIcon size={12} />
              Retry
            </button>
          )}

          <button className="btn-secondary btn-sm" onClick={() => onViewPrompt(slot)}>
            <EyeIcon size={12} />
            View
          </button>
        </div>
      </div>
    </div>
  );
};
