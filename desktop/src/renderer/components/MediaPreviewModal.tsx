import React, { useEffect, useRef } from 'react';
import { CloseIcon, FolderIcon } from './Icons';

interface MediaPreviewModalProps {
  isOpen: boolean;
  type: 'image' | 'video';
  mediaUrl: string;
  mediaPath?: string;
  title: string;
  promptText?: string;
  slotIndex?: number;
  thumbnailUrl?: string;
  metadata?: {
    model?: string;
    ratio?: string;
    resolution?: string;
    duration?: string;
    fileSize?: number;
    profile?: string;
  };
  onClose: () => void;
}

const KNOWN_PROFILES: Record<string, string> = {
  profile_71b66ea2: 'AI Automation',
  profile_b75159bb: 'Heidi Mason',
};

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  isOpen,
  type,
  mediaUrl,
  mediaPath,
  title,
  promptText,
  slotIndex,
  thumbnailUrl,
  metadata,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Pause video on close
  useEffect(() => {
    if (!isOpen && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const slotLabel = slotIndex !== undefined ? `Slot #${String(slotIndex + 1).padStart(2, '0')}` : title;
  const profileLabel = metadata?.profile
    ? KNOWN_PROFILES[metadata.profile] || metadata.profile.replace(/^profile_/, 'Profile ')
    : null;
  const fileSizeLabel = metadata?.fileSize
    ? `${Math.round(metadata.fileSize / 1024)} KB`
    : null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content"
        style={{ maxWidth: '920px', width: '92vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ padding: '12px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600 }}>{slotLabel}</h2>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: type === 'video' ? 'var(--info-video-bg)' : 'var(--info-image-bg)',
                color: type === 'video' ? 'var(--info-video)' : 'var(--info-image)',
                border: `1px solid ${type === 'video' ? 'var(--info-video-border)' : 'var(--info-image-border)'}`,
                fontWeight: 600,
              }}
            >
              {type === 'video' ? 'Video' : 'Image'}
            </span>
            {metadata?.model && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                · {metadata.model}
              </span>
            )}
            {metadata?.resolution && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                · {metadata.resolution}
              </span>
            )}
            {metadata?.duration && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                · {metadata.duration}
              </span>
            )}
            {metadata?.ratio && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                · {metadata.ratio}
              </span>
            )}
          </div>
          <button className="btn-secondary btn-sm" onClick={onClose} aria-label="Close preview">
            <CloseIcon size={14} />
          </button>
        </div>

        <div
          className="modal-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: '#090d16',
            padding: '16px',
            gap: '14px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              maxHeight: '62vh',
            }}
          >
            {type === 'image' ? (
              <img
                src={mediaUrl}
                alt={title}
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                }}
              />
            ) : (
              <video
                ref={videoRef}
                src={mediaUrl}
                poster={thumbnailUrl}
                controls
                autoPlay
                playsInline
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                }}
              />
            )}
          </div>

          {/* Full Prompt Description Box */}
          {promptText && (
            <div
              style={{
                width: '100%',
                backgroundColor: '#131b2e',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                border: '1px solid #1e293b',
              }}
            >
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', fontWeight: 600 }}>
                Prompt
              </div>
              <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
                {promptText}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {profileLabel && <span>Account: {profileLabel}</span>}
            {profileLabel && fileSizeLabel && <span> · </span>}
            {fileSizeLabel && <span>File Size: {fileSizeLabel}</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {mediaPath && (
              <button
                className="btn-secondary btn-sm"
                onClick={() => {
                  if (window.flowApi?.revealAsset && mediaPath) {
                    window.flowApi.revealAsset(mediaPath);
                  }
                }}
                title="Show file in Windows Explorer"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <FolderIcon size={13} />
                Reveal in Explorer
              </button>
            )}
            <button className="btn-secondary btn-sm" onClick={onClose}>
              Close Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
