import React, { useState, useEffect } from 'react';
import { CloseIcon, CopyIcon, CheckIcon } from './Icons';

interface FullPromptModalProps {
  isOpen: boolean;
  promptText: string;
  slotIndex?: number;
  type?: 'image' | 'video';
  onClose: () => void;
}

export const FullPromptModal: React.FC<FullPromptModalProps> = ({
  isOpen,
  promptText,
  slotIndex,
  type = 'image',
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [promptText, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const slotLabel = slotIndex !== undefined ? `Slot #${String(slotIndex + 1).padStart(2, '0')}` : 'Prompt';
  const typeLabel = type === 'video' ? 'Video' : 'Image';

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {slotLabel} <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)' }}>({typeLabel})</span>
          </h2>
          <button className="btn-secondary btn-sm" onClick={onClose} aria-label="Close modal">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--bg-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '360px',
              overflowY: 'auto',
              userSelect: 'text',
            }}
          >
            {promptText}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckIcon size={14} style={{ color: 'var(--success)' }} />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                Copy Prompt
              </>
            )}
          </button>
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
