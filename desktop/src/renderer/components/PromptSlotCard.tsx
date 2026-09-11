import React, { useState } from 'react';
import type { PromptSlotEntity } from '../../shared/types';
import { EyeIcon, PlayIcon, RefreshIcon, FolderIcon, AlertCircleIcon } from './Icons';
import { formatAssetUrl } from '../utils/assetUrl';

interface PromptSlotCardProps {
  slot: PromptSlotEntity;
  aspectRatio?: string;
  progress?: {
    percent: number;
    stage: string;
    elapsedSeconds?: number;
    description?: string;
  };
  isSelected?: boolean;
  onToggleSelect?: (slotIndex: number) => void;
  profileMap?: Record<string, string>;
  onViewPrompt: (slot: PromptSlotEntity) => void;
  onPreviewMedia: (slot: PromptSlotEntity) => void;
  onRetry?: (slot: PromptSlotEntity) => void;
}

export function formatMediaUrl(mediaPath?: string, projectId?: string): string {
  return formatAssetUrl(mediaPath, projectId);
}

export const PromptSlotCardComponent: React.FC<PromptSlotCardProps> = ({
  slot,
  aspectRatio,
  progress,
  isSelected = false,
  onToggleSelect,
  profileMap,
  onViewPrompt,
  onPreviewMedia,
  onRetry,
}) => {
  const [imgError, setImgError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const slotNumber = `#${String(slot.slotIndex + 1).padStart(2, '0')}`;
  const thumbUrl = formatMediaUrl(slot.result?.thumbnailPath || slot.result?.mediaPath, slot.projectId);
  const isVideo = slot.type === 'video';

  // Compute strict CSS aspect ratio
  const rawRatio = slot.result?.ratioUsed || aspectRatio || '16:9';
  const cssAspectRatio = rawRatio.includes('9:16') || rawRatio.includes('9_16')
    ? '9 / 16'
    : rawRatio.includes('1:1') || rawRatio.includes('square')
    ? '1 / 1'
    : rawRatio.includes('4:3') || rawRatio.includes('landscape')
    ? '4 / 3'
    : '16 / 9';

  const getStatusBadge = () => {
    const retryState = slot.retryState;
    if (retryState?.cancelledByUser || slot.status === 'cancelled') {
      return <span className="badge badge-draft" title="Cancelled by user">Cancelled</span>;
    }
    if (retryState?.retryReason === 'IDENTICAL_ERROR_BAILOUT') {
      return (
        <span
          className="badge badge-failed"
          title={`Auto-retry halted: identical error repeated ${retryState.identicalErrorCount || 3} times.`}
          style={{ cursor: 'help' }}
        >
          Retry Halted (Identical)
        </span>
      );
    }
    if (retryState?.retryReason === 'RETRY_LIMIT_EXCEEDED') {
      return (
        <span
          className="badge badge-failed"
          title={`Retry limit reached (${retryState.attempt}/${retryState.maxAttempts})`}
          style={{ cursor: 'help' }}
        >
          Retry Limit Reached
        </span>
      );
    }
    if (slot.status === 'queued' && retryState && retryState.attempt > 0) {
      return (
        <span
          className="badge badge-retrying"
          title={`Attempt ${retryState.attempt} of ${retryState.maxAttempts}`}
        >
          Retrying ({retryState.attempt}/{retryState.maxAttempts})
        </span>
      );
    }
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
      default:
        return <span className="badge badge-draft">{slot.status}</span>;
    }
  };

  const profileName = slot.assignedProfileId
    ? profileMap?.[slot.assignedProfileId] || slot.assignedProfileId.replace(/^profile_/, 'Profile ')
    : 'Unassigned';

  const fileSizeLabel = slot.result?.fileSizeBytes
    ? `${Math.round(slot.result.fileSizeBytes / 1024)} KB`
    : null;

  return (
    <div
      className="prompt-slot-card"
      data-testid={`prompt-slot-card-${slot.slotIndex}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        backgroundColor: 'var(--bg-card)',
        border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px',
        boxShadow: isSelected
          ? '0 0 0 1px var(--primary), 0 8px 24px rgba(0,0,0,0.4)'
          : isHovered
          ? '0 8px 24px rgba(0, 0, 0, 0.45), 0 0 16px rgba(99, 102, 241, 0.15)'
          : 'var(--shadow-sm)',
        borderColor: isSelected ? 'var(--primary)' : isHovered ? 'rgba(99, 102, 241, 0.35)' : 'var(--border-color)',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Top row: checkbox + minimalist slot # + model badge + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(slot.slotIndex)}
              style={{ cursor: 'pointer', accentColor: 'var(--primary)', width: '15px', height: '15px' }}
              title="Select slot for batch download"
            />
          )}
          <span style={{ fontWeight: 700, fontSize: '12.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {slotNumber}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '4px',
              backgroundColor: isVideo ? 'var(--info-video-bg)' : 'var(--info-image-bg)',
              color: isVideo ? 'var(--info-video)' : 'var(--info-image)',
              border: `1px solid ${isVideo ? 'var(--info-video-border)' : 'var(--info-image-border)'}`,
              fontWeight: 600,
            }}
          >
            {isVideo ? 'Video' : 'Image'}
          </span>
          {(slot.sourceImagePath || slot.result?.sourceImagePath) && (
            <span
              style={{
                fontSize: '10.5px',
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(6, 182, 212, 0.12)',
                color: '#06b6d4',
                border: '1px solid rgba(6, 182, 212, 0.25)',
                fontWeight: 600,
              }}
              title="Image to Video"
            >
              I2V
            </span>
          )}
          {(slot.provider === 'gemini' || slot.result?.provider === 'gemini') && (
            <span
              style={{
                fontSize: '10.5px',
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                color: '#60a5fa',
                border: '1px solid rgba(59, 130, 246, 0.28)',
                fontWeight: 600,
              }}
              title="Generated via Google Gemini Web"
            >
              Gemini
            </span>
          )}
          {slot.result?.watermarkCleaned && (
            <span
              style={{
                fontSize: '10.5px',
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.28)',
                fontWeight: 600,
              }}
              title="Gemini watermark cleanly reconstructed locally"
            >
              Clean
            </span>
          )}
          {slot.result?.modelUsed && (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 7px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                fontWeight: 500,
              }}
            >
              {slot.result.modelUsed}
            </span>
          )}
        </div>
        {getStatusBadge()}
      </div>

      {/* Media Visual Hero Container (70-80% visual presence) */}
      <div
        style={{
          width: '100%',
          aspectRatio: cssAspectRatio,
          backgroundColor: '#070a10',
          borderRadius: 'var(--radius-md)',
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
        title={slot.status === 'completed' ? 'Click to open full media preview' : undefined}
      >
        {slot.status === 'completed' && thumbUrl && !imgError ? (
          <>
            <img
              src={thumbUrl}
              alt={`Slot ${slotNumber}: ${slot.promptText}`}
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transform: isHovered ? 'scale(1.02)' : 'scale(1)',
                transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onError={() => setImgError(true)}
            />

            {/* Source Image Corner Chip for Image-to-Video */}
            {(slot.sourceImagePath || slot.result?.sourceImagePath) && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  zIndex: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(0, 0, 0, 0.75)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  fontSize: '10.5px',
                  color: '#ffffff',
                  fontWeight: 500,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                }}
                title="Input Source Image"
              >
                <img
                  src={formatMediaUrl(slot.sourceImagePath || slot.result?.sourceImagePath, slot.projectId)}
                  alt="Source"
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '3px',
                    objectFit: 'cover',
                    border: '1px solid rgba(255,255,255,0.4)',
                  }}
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <span>Source Image</span>
              </div>
            )}

            {/* Video Play Overlay */}
            {isVideo && (
              <div
                style={{
                  position: 'absolute',
                  backgroundColor: 'rgba(10, 14, 24, 0.75)',
                  borderRadius: '50%',
                  width: '40px',
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5)',
                  backdropFilter: 'blur(4px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  pointerEvents: 'none',
                }}
              >
                <PlayIcon size={18} />
              </div>
            )}

            {/* Video Duration Badge */}
            {isVideo && slot.result?.durationFormatted && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  backdropFilter: 'blur(4px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              >
                <span>▶</span> {slot.result.durationFormatted}
              </div>
            )}

            {/* Media Hover Action Strip (Reveal in Explorer & View) */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(9, 12, 19, 0.55)',
                backdropFilter: 'blur(2px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.18s ease',
                pointerEvents: isHovered ? 'auto' : 'none',
                zIndex: 5,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {slot.result?.mediaPath && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.flowApi?.revealAsset && slot.result?.mediaPath) {
                      window.flowApi.revealAsset(slot.result.mediaPath);
                    }
                  }}
                  style={{
                    backgroundColor: 'rgba(18, 24, 38, 0.88)',
                    borderColor: 'rgba(255, 255, 255, 0.25)',
                    color: '#ffffff',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                  }}
                  title="Reveal file in Windows Explorer"
                >
                  <FolderIcon size={13} />
                  Reveal
                </button>
              )}
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewMedia(slot);
                }}
                style={{
                  boxShadow: '0 2px 10px rgba(99, 102, 241, 0.5)',
                }}
                title="Open full media viewer"
              >
                <EyeIcon size={13} />
                View
              </button>
            </div>
          </>
        ) : slot.status === 'running' ? (
          <div
            className="skeleton-pulse"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '18px 16px',
              boxSizing: 'border-box',
              background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.08) 0%, rgba(9, 12, 19, 0.95) 100%)',
            }}
          >
            <div style={{ width: '90%', maxWidth: '240px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: progress?.stage === 'downloading' ? '#38bdf8' : 'var(--primary)',
                      boxShadow: '0 0 8px currentColor',
                      animation: 'pulse 1.2s ease-in-out infinite',
                    }}
                  />
                  {progress?.stage === 'downloading' ? 'Downloading...' : 'Generating...'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)', fontSize: '12px' }}>
                  {progress?.percent !== undefined ? `${progress.percent}%` : ''}
                </span>
              </div>

              {/* Progress Bar Container */}
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress?.percent ?? 15}%`,
                    background: progress?.stage === 'downloading'
                      ? 'linear-gradient(90deg, #0284c7, #38bdf8)'
                      : 'linear-gradient(90deg, #6366f1, #a855f7)',
                    borderRadius: '999px',
                    transition: 'width 0.4s ease-out',
                    boxShadow: '0 0 10px rgba(99, 102, 241, 0.4)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>{progress?.stage === 'downloading' ? 'Verifying asset' : 'Google Flow'}</span>
                {progress?.elapsedSeconds !== undefined && (
                  <span>{progress.elapsedSeconds}s elapsed</span>
                )}
              </div>
            </div>
          </div>
        ) : slot.status === 'failed' ? (
          <div style={{ textAlign: 'center', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <AlertCircleIcon size={22} style={{ color: 'var(--danger)' }} />
            <span style={{ fontSize: '11.5px', color: '#fca5a5', maxWidth: '240px', lineHeight: 1.4 }}>
              {slot.error?.message ?? 'Generation failed'}
            </span>
            {onRetry && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(slot);
                }}
                style={{
                  marginTop: '4px',
                  backgroundColor: 'var(--danger-bg)',
                  borderColor: 'var(--danger-border)',
                  color: '#fb7185',
                }}
              >
                <RefreshIcon size={12} />
                Retry Slot
              </button>
            )}
          </div>
        ) : imgError ? (
          <div style={{ textAlign: 'center', padding: '12px', color: '#94a3b8' }}>
            <span style={{ fontSize: '11px' }}>Asset preview unavailable</span>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Waiting in queue</span>
        )}
      </div>

      {/* Prompt snippet with clean typography */}
      <div
        className="prompt-clamp"
        onClick={() => onViewPrompt(slot)}
        title="Click to view full prompt text"
        style={{
          fontSize: '12.5px',
          color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
          lineHeight: '1.45',
          cursor: 'pointer',
          minHeight: '34px',
          transition: 'color 0.15s ease',
          padding: '0 2px',
        }}
      >
        {slot.promptText}
      </div>

      {/* Footer bar: profile and metadata pills */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '8px',
          marginTop: 'auto',
          fontSize: '11.5px',
          color: 'var(--text-muted)',
          padding: '8px 2px 0 2px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profileName}
          </span>
          {slot.result?.resolution && (
            <span>· {slot.result.resolution}</span>
          )}
          {fileSizeLabel && (
            <span>· {fileSizeLabel}</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {(slot.status === 'failed' || slot.status === 'cancelled') && onRetry && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => onRetry(slot)}
              style={{ padding: '3px 8px', fontSize: '11px' }}
              title="Retry generation"
            >
              <RefreshIcon size={11} />
              Retry
            </button>
          )}

          {slot.status !== 'completed' && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => onViewPrompt(slot)}
              style={{ padding: '3px 8px', fontSize: '11px' }}
              title="View full prompt"
            >
              <EyeIcon size={11} />
              View
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const PromptSlotCard = React.memo<PromptSlotCardProps>(
  PromptSlotCardComponent,
  (prev, next) => {
    if (prev.slot !== next.slot) return false;
    if (prev.aspectRatio !== next.aspectRatio) return false;
    if (prev.isSelected !== next.isSelected) return false;
    if (prev.progress?.percent !== next.progress?.percent) return false;
    if (prev.progress?.stage !== next.progress?.stage) return false;
    if (prev.progress?.elapsedSeconds !== next.progress?.elapsedSeconds) return false;
    if (prev.progress?.description !== next.progress?.description) return false;
    if (prev.onToggleSelect !== next.onToggleSelect) return false;
    if (prev.onViewPrompt !== next.onViewPrompt) return false;
    if (prev.onPreviewMedia !== next.onPreviewMedia) return false;
    if (prev.onRetry !== next.onRetry) return false;
    if (prev.profileMap !== next.profileMap) return false;
    return true;
  }
);
