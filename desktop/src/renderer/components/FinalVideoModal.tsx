import React from 'react';
import type { FinalRenderManifest } from '../../shared/types';
import { formatAssetUrl } from '../utils/assetUrl';
import { FolderIcon } from './Icons';

interface FinalVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: FinalRenderManifest | null;
  onReveal?: (path: string) => void;
}

export const FinalVideoModal: React.FC<FinalVideoModalProps> = ({
  isOpen,
  onClose,
  manifest,
  onReveal,
}) => {
  if (!isOpen || !manifest) return null;

  const videoUrl = manifest.absoluteVideoPath ? formatAssetUrl(manifest.absoluteVideoPath) : '';
  const sizeMb = (manifest.fileSizeBytes / (1024 * 1024)).toFixed(2);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg, 12px)',
          width: '100%',
          maxWidth: '850px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
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
            <span style={{ fontSize: '18px', fontWeight: 700 }}>Final Finished Video</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '999px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              Ready
            </span>
          </div>
          <button
            onClick={onClose}
            className="btn-secondary btn-sm"
            style={{ padding: '4px 10px', fontSize: '12px' }}
          >
            &times;
          </button>
        </div>

        {/* Video Player */}
        <div
          style={{
            backgroundColor: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxHeight: '480px',
            minHeight: '260px',
            position: 'relative',
          }}
        >
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              style={{
                width: '100%',
                maxHeight: '480px',
                objectFit: 'contain',
              }}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>Video file unavailable</div>
          )}
        </div>

        {/* Metadata Details */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
              fontSize: '12px',
            }}
          >
            <div style={{ background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Duration</div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{manifest.durationSeconds.toFixed(1)}s</div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>File Size</div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{sizeMb} MB</div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Resolution</div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                {manifest.width} &times; {manifest.height}
              </div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Framerate</div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{manifest.fps} FPS</div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Codecs</div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                {manifest.videoCodec} / {manifest.audioCodec}
              </div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Transition</div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                {manifest.transitionStyle === 'cross_fade' ? 'Cross Fade' : 'Hard Cut'}
              </div>
            </div>
          </div>

          {manifest.musicTrack && (
            <div
              style={{
                fontSize: '12px',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <strong>Background Music:</strong> {manifest.musicTrack.originalFilename}
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                Vol: {Math.round(manifest.musicTrack.volume * 100)}% &middot; Ducking:{' '}
                {manifest.musicTrack.duckingEnabled ? 'Active' : 'Off'}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '8px',
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => onReveal?.(manifest.absoluteVideoPath)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}
            >
              <FolderIcon size={15} />
              Reveal in Folder
            </button>
            <button className="btn-primary" onClick={onClose} style={{ fontSize: '13px' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
