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
    <div style={{ padding: '24px', maxWidth: '680px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1>Settings</h1>
          <p style={{ marginTop: '4px' }}>Configure default generation behavior and storage preferences.</p>
        </div>
        {savedMsg && (
          <span style={{ fontSize: '13px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckIcon size={14} /> Saved
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Storage Location */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Application Data Directory</label>
          <p style={{ fontSize: '12px' }}>
            Local path where Chrome profiles, project files, and generated media are stored.
          </p>
          <input
            type="text"
            readOnly
            value={appInfo?.appDataDir ?? settings.appDataDir}
            style={{ backgroundColor: 'var(--bg-subtle)', cursor: 'default', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
          />
        </div>

        {/* Default Aspect Ratio */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Default Image Aspect Ratio</label>
          <p style={{ fontSize: '12px' }}>Preselected ratio for newly created image generation projects.</p>
          <div style={{ display: 'flex', gap: '12px' }}>
            {(['16:9', '9:16'] as SupportedAspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                className={settings.defaultImageRatio === ratio ? 'btn-primary' : 'btn-secondary'}
                onClick={() => handleUpdate({ defaultImageRatio: ratio })}
              >
                {ratio} {ratio === '16:9' ? '(Landscape)' : '(Portrait)'}
              </button>
            ))}
          </div>
        </div>

        {/* Default Processing Order */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Default Mixed Processing Order</label>
          <p style={{ fontSize: '12px' }}>Queue priority when a project contains both image and video prompts.</p>
          <div style={{ display: 'flex', gap: '12px' }}>
            {[
              { id: 'images_first', label: 'Images First' },
              { id: 'videos_first', label: 'Videos First' },
              { id: 'automatic', label: 'Automatic (FIFO)' },
            ].map((po) => (
              <button
                key={po.id}
                className={settings.defaultProcessingOrder === po.id ? 'btn-primary' : 'btn-secondary'}
                onClick={() => handleUpdate({ defaultProcessingOrder: po.id as ProcessingOrder })}
              >
                {po.label}
              </button>
            ))}
          </div>
        </div>

        {/* Retry Limits */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Maximum Transient Retries</label>
          <p style={{ fontSize: '12px' }}>Number of automatic retry attempts before marking a transient error as failed.</p>
          <select
            value={settings.maxRetries}
            onChange={(e) => handleUpdate({ maxRetries: Number(e.target.value) })}
            style={{ maxWidth: '160px' }}
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
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>About Google Flow Desktop</div>
          <div>Version: {appInfo?.version ?? '1.0.0'}</div>
          <div>Platform: {appInfo?.platform === 'win32' ? 'Windows 10 / 11 (x64)' : appInfo?.platform ?? 'Windows'}</div>
        </div>
      </div>
    </div>
  );
};
