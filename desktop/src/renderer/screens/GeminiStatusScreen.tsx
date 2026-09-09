import React, { useState, useEffect } from 'react';
import type { ProfileSessionSnapshot } from '../../shared/types';
import { SparklesIcon, UsersIcon, VideoIcon, ClapperboardIcon } from '../components/Icons';

interface GeminiStatusScreenProps {
  onNavigateMode: (mode: 'single_video' | 'bulk_video' | 'image_to_video' | 'profiles') => void;
}

export const GeminiStatusScreen: React.FC<GeminiStatusScreenProps> = ({ onNavigateMode }) => {
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!window.flowApi) return;
    window.flowApi
      .listProfiles()
      .then((profs) => {
        setProfiles(profs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const readyProfiles = profiles.filter((p) => p.status === 'ready');

  return (
    <div style={{ padding: '28px 36px', height: '100%', overflowY: 'auto', backgroundColor: 'var(--bg-app)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#60a5fa',
            }}
          >
            <SparklesIcon size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                Gemini Omni Engine Status
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: readyProfiles.length > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: readyProfiles.length > 0 ? '#10b981' : '#ef4444',
                  border: `1px solid ${readyProfiles.length > 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                {readyProfiles.length > 0 ? `${readyProfiles.length} Profiles Ready` : 'No Ready Profiles'}
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Gemini Omni Flash is unified into Infinity Flow's primary Video Generator with automatic capability routing.
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Status & Diagnostic Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '28px' }}>
        {/* Card 1: Account Health */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <UsersIcon size={18} style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Active Profile Connectivity</span>
          </div>

          {loading ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Querying profiles...</div>
          ) : profiles.length === 0 ? (
            <div>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
                No browser profiles registered. Add a profile in Accounts to use Gemini.
              </p>
              <button
                className="btn-primary"
                onClick={() => onNavigateMode('profiles')}
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                Manage Accounts
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {profiles.map((p) => (
                <div
                  key={p.profileId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-subtle)',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.displayName}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {p.detectedEmail || 'Unauthenticated'} · Port {p.cdpPort}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: p.status === 'ready' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: p.status === 'ready' ? '#10b981' : '#f59e0b',
                    }}
                  >
                    {p.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card 2: Engine Specifications */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <SparklesIcon size={18} style={{ color: '#60a5fa' }} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Gemini Omni Capabilities</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Native Duration</span>
              <strong style={{ color: 'var(--text-primary)' }}>10.0s (Fixed)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Aspect Ratios</span>
              <strong style={{ color: 'var(--text-primary)' }}>16:9 Landscape · 9:16 Portrait</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Supported Modes</span>
              <strong style={{ color: 'var(--text-primary)' }}>Text-to-Video · Image-to-Video</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Resolution</span>
              <strong style={{ color: 'var(--text-primary)' }}>720p HD MP4</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Tab Architecture</span>
              <strong style={{ color: '#10b981' }}>Dedicated isolated page per job</strong>
            </div>
          </div>
        </div>

        {/* Card 3: Watermark & Provenance */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ fontSize: '16px' }}>🛡️</span>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Provenance & Integrity</span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
            <p style={{ margin: '0 0 8px 0' }}>
              Infinity Flow generates videos directly through official Google Gemini Web endpoints with zero synthetic degradation.
            </p>
            <p style={{ margin: '0 0 8px 0' }}>
              <strong style={{ color: 'var(--text-primary)' }}>SynthID & Content Credentials:</strong> Preserved completely in all downloads. No metadata stripping or destructive modifications are performed.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Official Media Watermark Setting:</strong> Managed via official Google Gemini account settings.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Navigation to Unified Generator */}
      <div
        style={{
          padding: '20px 24px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
            Generate Videos with Gemini Omni
          </h2>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0 }}>
            Use the unified Video Generator with Gemini selected as the provider, or choose Auto for adaptive load-balancing.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className="btn-secondary"
            onClick={() => onNavigateMode('single_video')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', padding: '8px 16px' }}
          >
            <VideoIcon size={14} />
            Single Video Generator
          </button>
          <button
            className="btn-primary"
            onClick={() => onNavigateMode('bulk_video')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', padding: '8px 16px' }}
          >
            <ClapperboardIcon size={14} />
            Bulk Video Generator
          </button>
        </div>
      </div>
    </div>
  );
};
