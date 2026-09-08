import React, { useState } from 'react';
import type { PromptSlotEntity } from '../../shared/types';
import { EyeIcon, PlayIcon, RefreshIcon, FolderIcon } from './Icons';
import { formatAssetUrl } from '../utils/assetUrl';

interface PromptSlotCardProps {
  slot: PromptSlotEntity;
  aspectRatio?: string;
  onViewPrompt: (slot: PromptSlotEntity) => void;
  onPreviewMedia: (slot: PromptSlotEntity) => void;
  onRetry?: (slot: PromptSlotEntity) => void;
}

// Re-export for compatibility across components and unit tests
export function formatMediaUrl(mediaPath?: string, projectId?: string): string {
  return formatAssetUrl(mediaPath, projectId);
}

// Friendly profile name map
const KNOWN_PROFILES: Record<string, string> = {
  profile_71b66ea2: 'AI Automation',
  profile_b75159bb: 'Heidi Mason',
};

export const PromptSlotCard: React.FC<PromptSlotCardProps> = ({
  slot,
  aspectRatio,
  onViewPrompt,
  onPreviewMedia,
  onRetry,
}) => {
  const [imgError, setImgError] = useState(false);
  const slotNumber = `#${String(slot.slotIndex + 1).padStart(2, '0')}`;
  const thumbUrl = formatMediaUrl(slot.result?.thumbnailPath || slot.result?.mediaPath, slot.projectId);
  const isVideo = slot.type === 'video';

  // Compute CSS aspect ratio from slot result or project settings
  const rawRatio = slot.result?.ratioUsed || aspectRatio || '16:9';
  const cssAspectRatio = rawRatio.includes('9:16') || rawRatio.includes('9_16')
    ? '9 / 16'
    : rawRatio.includes('1:1') || rawRatio.includes('square')
    ? '1 / 1'
    : rawRatio.includes('4:3') || rawRatio.includes('landscape')
    ? '4 / 3'
    : '16 / 9';

  // Human-readable status mapping
  const getStatusBadge = () => {
    switch (slot.status) {
      case 'completed':
        return <span className="badge badge-completed">Completed</span>;
      case 'running':
        return <span className="badge badge-running">Generating</span>;
      case 'queued':
        return <span className="badge badge-queued">Waiting</span>;
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

  const profileName = slot.assignedProfileId
    ? KNOWN_PROFILES[slot.assignedProfileId] || slot.assignedProfileId.replace(/^profile_/, 'Profile ')
    : 'Unassigned';

  const fileSizeLabel = slot.result?.fileSizeBytes
    ? `${Math.round(slot.result.fileSizeBytes / 1024)} KB`
    : null;

  return (
    <div className="prompt-slot-card" data-testid={`prompt-slot-card-${slot.slotIndex}`}>
      {/* Top row: slot number, type badge, status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
            {slotNumber}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: isVideo ? '#f5f3ff' : '#eff6ff',
              color: isVideo ? '#7c3aed' : '#2563eb',
              border: `1px solid ${isVideo ? '#ddd6fe' : '#bfdbfe'}`,
              fontWeight: 500,
            }}
          >
            {isVideo ? 'Video' : 'Image'}
          </span>
          {slot.result?.modelUsed && (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: '#f1f5f9',
                color: '#475569',
                border: '1px solid #e2e8f0',
                fontWeight: 500,
              }}
            >
              {slot.result.modelUsed}
            </span>
          )}
        </div>
        {getStatusBadge()}
      </div>

      {/* Media Thumbnail Container with strict project aspect-ratio */}
      <div
        style={{
          width: '100%',
          aspectRatio: cssAspectRatio,
          backgroundColor: '#0b0f19',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          cursor: slot.status === 'completed' && !imgError ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (slot.status === 'completed' && !imgError) {
            onPreviewMedia(slot);
          }
        }}
        title={slot.status === 'completed' ? 'Click to open full preview' : undefined}
      >
        {slot.status === 'completed' && thumbUrl && !imgError ? (
          <>
            {isVideo ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img
                  src={thumbUrl}
                  alt={`Slot ${slotNumber}: ${slot.promptText}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  onError={() => setImgError(true)}
                />
                <div
                  style={{
                    position: 'absolute',
                    backgroundColor: 'rgba(15, 23, 42, 0.7)',
                    borderRadius: '50%',
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    pointerEvents: 'none',
                  }}
                >
                  <PlayIcon size={18} />
                </div>
                {slot.result?.durationFormatted && (
                  <div
                    className="duration-badge"
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      right: '8px',
                      backgroundColor: 'rgba(0, 0, 0, 0.75)',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      zIndex: 2,
                      pointerEvents: 'none',
                    }}
                  >
                    <span>▶</span> {slot.result.durationFormatted}
                  </div>
                )}
              </div>
            ) : (
              <img
                src={thumbUrl}
                alt={`Slot ${slotNumber}: ${slot.promptText}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  transition: 'transform 0.2s ease',
                }}
                loading="lazy"
                onError={() => setImgError(true)}
              />
            )}
          </>
        ) : slot.status === 'running' ? (
          <div
            className="skeleton-pulse"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--primary)',
            }}
          >
            <div
              style={{
                width: '22px',
                height: '22px',
                border: '2.5px solid var(--primary-border)',
                borderTopColor: 'var(--primary)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-inverse)' }}>
              Generating...
            </span>
          </div>
        ) : slot.status === 'failed' ? (
          <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-inverse)' }}>
            <span style={{ fontSize: '11px', color: '#fca5a5', display: 'block', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {slot.error?.message ?? 'Generation failed'}
            </span>
          </div>
        ) : imgError ? (
          <div style={{ textAlign: 'center', padding: '12px', color: '#94a3b8' }}>
            <span style={{ fontSize: '11px' }}>Asset preview unavailable</span>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: '#64748b' }}>Waiting in queue</span>
        )}
      </div>

      {/* Prompt preview snippet with clamp and click-to-view */}
      <div
        className="prompt-clamp"
        onClick={() => onViewPrompt(slot)}
        title="Click to view full prompt"
        style={{
          fontSize: '12.5px',
          color: 'var(--text-primary)',
          lineHeight: '1.45',
          cursor: 'pointer',
          minHeight: '36px',
        }}
      >
        {slot.promptText}
      </div>

      {/* Bottom row: Worker profile and Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '10px',
          marginTop: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            {profileName}
          </span>
          {slot.result?.resolution && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              · {slot.result.resolution}
            </span>
          )}
          {fileSizeLabel && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              · {fileSizeLabel}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {slot.status === 'completed' && slot.result?.mediaPath && (
            <button
              className="btn-secondary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                if (window.flowApi?.revealAsset && slot.result?.mediaPath) {
                  window.flowApi.revealAsset(slot.result.mediaPath);
                }
              }}
              title="Reveal file in Windows Explorer"
            >
              <FolderIcon size={12} />
              Reveal
            </button>
          )}

          {slot.status === 'failed' && onRetry && (
            <button className="btn-secondary btn-sm" onClick={() => onRetry(slot)} title="Retry generation">
              <RefreshIcon size={12} />
              Retry
            </button>
          )}

          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              if (slot.status === 'completed') {
                onPreviewMedia(slot);
              } else {
                onViewPrompt(slot);
              }
            }}
            title={slot.status === 'completed' ? 'Open media preview' : 'View full prompt'}
          >
            <EyeIcon size={12} />
            View
          </button>
        </div>
      </div>
    </div>
  );
};
