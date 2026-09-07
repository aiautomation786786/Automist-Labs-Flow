import React, { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';

interface MediaPreviewModalProps {
  isOpen: boolean;
  type: 'image' | 'video';
  mediaUrl: string;
  title: string;
  onClose: () => void;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  isOpen,
  type,
  mediaUrl,
  title,
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

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content"
        style={{ maxWidth: '820px', width: '90vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-secondary btn-sm" onClick={onClose} aria-label="Close preview">
            <CloseIcon size={14} />
          </button>
        </div>
        <div
          className="modal-body"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#090d16',
            minHeight: '380px',
            maxHeight: '70vh',
            padding: '12px',
          }}
        >
          {type === 'image' ? (
            <img
              src={mediaUrl}
              alt={title}
              style={{
                maxWidth: '100%',
                maxHeight: '65vh',
                objectFit: 'contain',
                borderRadius: 'var(--radius-sm)',
              }}
            />
          ) : (
            <video
              ref={videoRef}
              src={mediaUrl}
              controls
              playsInline
              style={{
                maxWidth: '100%',
                maxHeight: '65vh',
                borderRadius: 'var(--radius-sm)',
                outline: 'none',
              }}
            />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};
