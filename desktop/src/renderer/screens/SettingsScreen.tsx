import React, { useState, useEffect } from 'react';
import type { AppSettings, SupportedAspectRatio, ProcessingOrder } from '../../shared/types';
import { CheckIcon } from '../components/Icons';

export const SettingsScreen: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [appInfo, setAppInfo] = useState<{ appDataDir: string; version: string; platform: string } | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      if (!window.flowApi) return;
      try {
        setLoading(true);
        const [s, info] = await Promise.all([
          window.flowApi.getSettings(),
          window.flowApi.getAppInfo(),
        ]);
        setSettings(s);
        setAppInfo(info);
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleUpdate = async (patch: Partial<AppSettings>) => {
    if (!window.flowApi || !settings) return;
    try {
      const updated = await window.flowApi.updateSettings(patch);
      setSettings(updated);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (err) {
      console.error('Failed to update settings', err);
    }
  };

  if (loading || !settings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading settings...
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 36px', maxWidth: '720px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>Settings</h1>
          <p style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-muted)' }}>
            Configure default generation behavior and storage preferences.
          </p>
        </div>
        {savedMsg && (
          <span style={{ fontSize: '12.5px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
            <CheckIcon size={14} /> Saved
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
        {/* Storage Location */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Application Data Directory
          </label>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Local filesystem path where Chrome profiles, project state, and generated media assets are stored.
          </p>
          <input
            type="text"
            readOnly
            value={appInfo?.appDataDir ?? settings.appDataDir}
            style={{
              backgroundColor: 'var(--bg-subtle)',
              cursor: 'default',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              marginTop: '4px',
            }}
          />
        </div>

        {/* Default Aspect Ratio */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Default Image Aspect Ratio
          </label>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Preselected ratio for newly initialized image generation projects.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            {(['16:9', '9:16'] as SupportedAspectRatio[]).map((ratio) => {
              const isSel = settings.defaultImageRatio === ratio;
              return (
                <button
                  key={ratio}
                  className={isSel ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => handleUpdate({ defaultImageRatio: ratio })}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12.5px',
                    fontWeight: isSel ? 600 : 500,
                  }}
                >
                  {ratio} {ratio === '16:9' ? '(Landscape)' : '(Portrait)'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Default Processing Order */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Default Mixed Processing Order
          </label>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Queue scheduling priority when a bulk project contains both image and video prompts.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            {[
              { id: 'images_first', label: 'Images First' },
              { id: 'videos_first', label: 'Videos First' },
              { id: 'automatic', label: 'Automatic (FIFO)' },
            ].map((po) => {
              const isSel = settings.defaultProcessingOrder === po.id;
              return (
                <button
                  key={po.id}
                  className={isSel ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => handleUpdate({ defaultProcessingOrder: po.id as ProcessingOrder })}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12.5px',
                    fontWeight: isSel ? 600 : 500,
                  }}
                >
                  {po.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Retry Limits */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Maximum Transient Retries
          </label>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Number of automatic retry attempts before marking a transient error as failed.
          </p>
          <select
            value={settings.maxRetries}
            onChange={(e) => handleUpdate({ maxRetries: Number(e.target.value) })}
            style={{
              maxWidth: '200px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              marginTop: '4px',
            }}
          >
            <option value={1}>1 Retry</option>
            <option value={2}>2 Retries (Default)</option>
            <option value={3}>3 Retries</option>
          </select>
        </div>

        {/* About App */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
            About Google Flow Desktop
          </div>
          <div>Version: {appInfo?.version ?? '1.0.0'}</div>
          <div>Platform: {appInfo?.platform === 'win32' ? 'Windows 10 / 11 (x64)' : appInfo?.platform ?? 'Windows'}</div>
          <div style={{ color: 'var(--text-muted)', marginTop: '4px', fontSize: '11px' }}>
            Built for professional creative automation with dedicated isolated browser sessions.
          </div>
        </div>
      </div>
    </div>
  );
};
