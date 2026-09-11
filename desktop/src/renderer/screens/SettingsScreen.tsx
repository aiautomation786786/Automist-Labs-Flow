import React, { useState, useEffect } from 'react';
import type {
  AppSettings,
  SupportedAspectRatio,
  ProcessingOrder,
  AppLogLevel,
  TtsProviderId,
} from '../../shared/types';
import { CheckIcon, SparklesIcon, AlertCircleIcon } from '../components/Icons';
import { InfinityFlowLogo } from '../components/InfinityFlowLogo';

export const SettingsScreen: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [appInfo, setAppInfo] = useState<{ appDataDir: string; version: string; platform: string } | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testKeyResult, setTestKeyResult] = useState<{ success: boolean; message: string } | null>(null);

  // Voice Engines State
  const [azureKeyInput, setAzureKeyInput] = useState('');
  const [azureRegionInput, setAzureRegionInput] = useState('');
  const [ai33KeyInput, setAi33KeyInput] = useState('');
  const [famespeakKeyInput, setFamespeakKeyInput] = useState('');
  const [testingEngine, setTestingEngine] = useState<string | null>(null);
  const [engineTestResults, setEngineTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    await handleUpdate({ scriptAiKey: apiKeyInput.trim() });
    setApiKeyInput('');
    setTestKeyResult(null);
  };

  const handleClearApiKey = async () => {
    await handleUpdate({ scriptAiKey: '' });
    setApiKeyInput('');
    setTestKeyResult(null);
  };

  const handleSaveAzure = async () => {
    const patch: Partial<AppSettings> = {};
    if (azureKeyInput.trim()) patch.azureSpeechKey = azureKeyInput.trim();
    if (azureRegionInput.trim()) patch.azureSpeechRegion = azureRegionInput.trim();
    await handleUpdate(patch);
    setAzureKeyInput('');
    setEngineTestResults((prev) => ({ ...prev, azure: { success: true, message: 'Azure Speech settings saved.' } }));
  };

  const handleClearAzure = async () => {
    await handleUpdate({ azureSpeechKey: '' });
    setAzureKeyInput('');
    setEngineTestResults((prev) => {
      const next = { ...prev };
      delete next.azure;
      return next;
    });
  };

  const handleSaveAi33 = async () => {
    if (!ai33KeyInput.trim()) return;
    await handleUpdate({ ai33Key: ai33KeyInput.trim() });
    setAi33KeyInput('');
    setEngineTestResults((prev) => ({ ...prev, ai33: { success: true, message: 'ai33 API key saved.' } }));
  };

  const handleClearAi33 = async () => {
    await handleUpdate({ ai33Key: '' });
    setAi33KeyInput('');
    setEngineTestResults((prev) => {
      const next = { ...prev };
      delete next.ai33;
      return next;
    });
  };

  const handleSaveFamespeak = async () => {
    if (!famespeakKeyInput.trim()) return;
    await handleUpdate({ famespeakKey: famespeakKeyInput.trim() });
    setFamespeakKeyInput('');
    setEngineTestResults((prev) => ({ ...prev, famespeak: { success: true, message: 'FameSpeak Bearer API key saved.' } }));
  };

  const handleClearFamespeak = async () => {
    await handleUpdate({ famespeakKey: '' });
    setFamespeakKeyInput('');
    setEngineTestResults((prev) => {
      const next = { ...prev };
      delete next.famespeak;
      return next;
    });
  };

  const handleTestTtsEngine = async (engine: TtsProviderId) => {
    if (!window.flowApi?.testTtsConnection) return;
    setTestingEngine(engine);
    try {
      const res = await window.flowApi.testTtsConnection(engine);
      setEngineTestResults((prev) => ({ ...prev, [engine]: res }));
    } catch (err: any) {
      setEngineTestResults((prev) => ({ ...prev, [engine]: { success: false, message: err.message || 'Connection failed' } }));
    } finally {
      setTestingEngine(null);
    }
  };

  const handleTestKey = async () => {
    if (!window.flowApi?.testScriptAiConnection) return;
    setIsTestingKey(true);
    setTestKeyResult(null);
    try {
      const res = await window.flowApi.testScriptAiConnection();
      if (res.success) {
        setTestKeyResult({
          success: true,
          message: `Connected to ${res.model || 'Gemini'} successfully! ${res.isMock ? '(Offline Mock)' : '(Live Gemini Cloud)'}`,
        });
      } else {
        setTestKeyResult({ success: false, message: res.error || 'Connection test failed.' });
      }
    } catch (err: any) {
      setTestKeyResult({ success: false, message: err.message || 'Connection test failed.' });
    } finally {
      setIsTestingKey(false);
    }
  };

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
        setErrorMsg('Failed to load settings from storage.');
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
      setErrorMsg(null);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (err: any) {
      console.error('Failed to update settings', err);
      setErrorMsg(err?.message || 'Failed to save settings.');
      setTimeout(() => setErrorMsg(null), 4000);
    }
  };

  const handleCopyPath = () => {
    const dir = appInfo?.appDataDir ?? settings?.appDataDir ?? '';
    if (dir && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(dir);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
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
    <div style={{ padding: '28px 36px', maxWidth: '760px', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Settings
          </h1>
          <p style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-muted)' }}>
            Configure default generation behavior, automated concurrency, and storage preferences.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {savedMsg && (
            <span
              style={{
                fontSize: '12.5px',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 600,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              <CheckIcon size={14} /> Saved
            </span>
          )}
          {errorMsg && (
            <span
              style={{
                fontSize: '12.5px',
                color: 'var(--danger, #ef4444)',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontWeight: 500,
              }}
            >
              {errorMsg}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* ============================================================ */}
        {/* SECTION: GENERAL PREFERENCES                                 */}
        {/* ============================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
            }}
          >
            General Preferences
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Storage Directory */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Application Data Directory
                </label>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="btn-secondary"
                  style={{
                    padding: '3px 10px',
                    fontSize: '11px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {copiedPath ? 'Copied!' : 'Copy Path'}
                </button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Local filesystem root where Chrome profiles, projects, and media assets are stored.
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
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  marginTop: '4px',
                  width: '100%',
                }}
              />
            </div>

            {/* Logging Level */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Application Logging Level
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Granularity of diagnostic logs written to the local rotating log files.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {(['INFO', 'WARN', 'DEBUG', 'ERROR'] as AppLogLevel[]).map((level) => {
                  const isSel = settings.logLevel === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      className={isSel ? 'btn-primary' : 'btn-secondary'}
                      onClick={() => handleUpdate({ logLevel: level })}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: isSel ? 600 : 500,
                      }}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: IMAGE GENERATION DEFAULTS                           */}
        {/* ============================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
            }}
          >
            Image Generation Defaults
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Default Aspect Ratio */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Default Image Aspect Ratio
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Preselected aspect ratio when configuring new image generation projects.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {(['16:9', '9:16'] as SupportedAspectRatio[]).map((ratio) => {
                  const isSel = settings.defaultImageRatio === ratio;
                  return (
                    <button
                      key={ratio}
                      type="button"
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

            {/* Default Image Download Quality */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Default Image Download Quality
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Resolution preference for downloaded images from supported providers.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {[
                  { id: 'original', label: 'Original Resolution' },
                  { id: '2k', label: '2K High Definition' },
                ].map((q) => {
                  const isSel = (settings.defaultImageDownloadQuality ?? 'original') === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={isSel ? 'btn-primary' : 'btn-secondary'}
                      onClick={() => handleUpdate({ defaultImageDownloadQuality: q.id as 'original' | '2k' })}
                      style={{
                        padding: '8px 16px',
                        fontSize: '12.5px',
                        fontWeight: isSel ? 600 : 500,
                      }}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: VIDEO GENERATION DEFAULTS                           */}
        {/* ============================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
            }}
          >
            Video Generation Defaults
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Mixed Processing Order */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Default Mixed Processing Order
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Queue scheduling priority when a bulk project contains both image and video prompts.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {[
                  { id: 'images_first', label: 'Images First' },
                  { id: 'videos_first', label: 'Videos First' },
                  { id: 'automatic', label: 'Automatic (FIFO)' },
                ].map((po) => {
                  const isSel = settings.defaultProcessingOrder === po.id;
                  return (
                    <button
                      key={po.id}
                      type="button"
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

            {/* Default Video Download Quality */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Default Video Download Quality
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Preferred video export format when multiple output resolutions are available.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {[
                  { id: 'original', label: 'Original Quality' },
                  { id: '1080p', label: '1080p Full HD' },
                ].map((vq) => {
                  const isSel = (settings.defaultVideoDownloadQuality ?? 'original') === vq.id;
                  return (
                    <button
                      key={vq.id}
                      type="button"
                      className={isSel ? 'btn-primary' : 'btn-secondary'}
                      onClick={() => handleUpdate({ defaultVideoDownloadQuality: vq.id as 'original' | '1080p' })}
                      style={{
                        padding: '8px 16px',
                        fontSize: '12.5px',
                        fontWeight: isSel ? 600 : 500,
                      }}
                    >
                      {vq.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: AUTOMATION & SCHEDULING                             */}
        {/* ============================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
            }}
          >
            Automation & Scheduling
          </div>

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
              Maximum Transient Retries
            </label>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Number of automatic retry attempts before marking a transient network or timeout error as failed.
            </p>
            <select
              value={settings.maxRetries}
              onChange={(e) => handleUpdate({ maxRetries: Number(e.target.value) })}
              style={{
                maxWidth: '220px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                marginTop: '4px',
              }}
            >
              <option value={1}>1 Retry</option>
              <option value={2}>2 Retries (Recommended)</option>
              <option value={3}>3 Retries</option>
              <option value={4}>4 Retries</option>
              <option value={5}>5 Retries</option>
            </select>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: SCRIPT AI & SKILLS (GOOGLE GEMINI)                  */}
        {/* ============================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Script AI & Skills (Google Gemini)</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
              }}
            >
              Phase 8
            </span>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Gemini Model Endpoint
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 6px 0' }}>
                Google Gemini model used for autonomous script generation, scene parsing, and single-scene refinement.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[
                  { id: 'gemini-flash-latest', label: 'gemini-flash-latest (Recommended)' },
                  { id: 'gemini-3.6-flash', label: 'gemini-3.6-flash' },
                ].map((m) => {
                  const isSel = (settings.scriptAiModel || 'gemini-flash-latest') === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={isSel ? 'btn-primary' : 'btn-secondary'}
                      onClick={() => handleUpdate({ scriptAiModel: m.id })}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: isSel ? 600 : 500,
                        backgroundColor: isSel ? '#10b981' : undefined,
                        borderColor: isSel ? '#10b981' : undefined,
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Gemini API Key
                </label>
                {settings.scriptAiKey && (
                  <span style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckIcon size={12} /> Key Configured & Secured (safeStorage)
                  </span>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                API key for Google Gemini OpenAI-compatible completions. Encrypted at rest via Electron safeStorage and never exposed in logs or plaintext files.
              </p>

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={settings.scriptAiKey ? '•••••••••••••••• (Key saved, enter new key to replace)' : 'Paste Gemini API key (AQ.... / AIza...)'}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    fontFamily: apiKeyInput ? 'var(--font-mono)' : 'inherit',
                  }}
                />
                <button
                  type="button"
                  disabled={!apiKeyInput.trim()}
                  onClick={handleSaveApiKey}
                  className="btn-primary"
                  style={{
                    padding: '8px 16px',
                    fontSize: '12.5px',
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                  }}
                >
                  Save Key
                </button>
                {settings.scriptAiKey && (
                  <button
                    type="button"
                    onClick={handleClearApiKey}
                    className="btn-secondary"
                    style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--danger, #ef4444)' }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  disabled={isTestingKey}
                  onClick={handleTestKey}
                  className="btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <SparklesIcon size={13} /> {isTestingKey ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              {testKeyResult && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: testKeyResult.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    border: `1px solid ${testKeyResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    color: testKeyResult.success ? '#10b981' : 'var(--danger, #ef4444)',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {testKeyResult.success ? <CheckIcon size={13} /> : <AlertCircleIcon size={13} />}
                  <span>{testKeyResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: VOICE ENGINES & TTS PROVIDERS                       */}
        {/* ============================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Voice Engines & TTS Providers</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(168, 85, 247, 0.15)',
                color: '#a855f7',
              }}
            >
              ZBot Parity
            </span>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            {/* Default TTS Engine */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Default Text-to-Speech Engine
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 8px 0' }}>
                Preselected voice engine for Video Factory narration synthesis. Automatic fallback is active for all jobs.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { id: 'edge-tts', label: 'Edge TTS (Free Neural)', badge: 'FREE' },
                  { id: 'kokoro', label: 'Kokoro (Local ONNX)', badge: 'LOCAL' },
                  { id: 'azure', label: 'Azure Speech (HD)', badge: 'API KEY' },
                  { id: 'ai33', label: 'ai33.pro (Multi-Source)', badge: 'API KEY' },
                  { id: 'famespeak', label: 'FameSpeak (Celebrity)', badge: 'API KEY' },
                ].map((e) => {
                  const isSel = (settings.defaultTtsEngine || 'edge-tts') === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={isSel ? 'btn-primary' : 'btn-secondary'}
                      onClick={() => handleUpdate({ defaultTtsEngine: e.id as any })}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: isSel ? 600 : 500,
                        backgroundColor: isSel ? '#a855f7' : undefined,
                        borderColor: isSel ? '#a855f7' : undefined,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{e.label}</span>
                      <span style={{ fontSize: '9px', opacity: 0.75, fontWeight: 700 }}>[{e.badge}]</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Azure Speech */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Azure Cognitive Speech
                </label>
                {settings.azureSpeechKey && (
                  <span style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckIcon size={12} /> Key Secured
                  </span>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                High-definition neural speech with W3C SSML support. Region defaults to <code>eastus</code>.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto auto', gap: '8px', marginTop: '4px' }}>
                <input
                  type="password"
                  value={azureKeyInput}
                  onChange={(e) => setAzureKeyInput(e.target.value)}
                  placeholder={settings.azureSpeechKey ? '•••••••••••••••• (Saved)' : 'Azure Speech Key'}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                  }}
                />
                <input
                  type="text"
                  value={azureRegionInput}
                  onChange={(e) => setAzureRegionInput(e.target.value)}
                  placeholder={(settings.azureSpeechRegion as string) || 'Region (e.g. eastus)'}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                  }}
                />
                <button
                  type="button"
                  disabled={!azureKeyInput.trim() && !azureRegionInput.trim()}
                  onClick={handleSaveAzure}
                  className="btn-primary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  Save
                </button>
                {settings.azureSpeechKey && (
                  <button
                    type="button"
                    onClick={handleClearAzure}
                    className="btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--danger, #ef4444)' }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  disabled={testingEngine === 'azure'}
                  onClick={() => handleTestTtsEngine('azure')}
                  className="btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  {testingEngine === 'azure' ? 'Testing...' : 'Test'}
                </button>
              </div>
              {engineTestResults.azure && (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: engineTestResults.azure.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    color: engineTestResults.azure.success ? '#10b981' : 'var(--danger, #ef4444)',
                    fontSize: '11.5px',
                  }}
                >
                  {engineTestResults.azure.message}
                </div>
              )}
            </div>

            {/* ai33.pro */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  ai33.pro Cloud Voice API
                </label>
                {settings.ai33Key && (
                  <span style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckIcon size={12} /> Key Secured
                  </span>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Aggregated voice library (ElevenLabs, MiniMax, Fish Audio, Vbee, Clones) with SRT word timings.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="password"
                  value={ai33KeyInput}
                  onChange={(e) => setAi33KeyInput(e.target.value)}
                  placeholder={settings.ai33Key ? '•••••••••••••••• (Saved)' : 'ai33.pro API Key'}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                  }}
                />
                <button
                  type="button"
                  disabled={!ai33KeyInput.trim()}
                  onClick={handleSaveAi33}
                  className="btn-primary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  Save
                </button>
                {settings.ai33Key && (
                  <button
                    type="button"
                    onClick={handleClearAi33}
                    className="btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--danger, #ef4444)' }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  disabled={testingEngine === 'ai33'}
                  onClick={() => handleTestTtsEngine('ai33')}
                  className="btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  {testingEngine === 'ai33' ? 'Testing...' : 'Test'}
                </button>
              </div>
              {engineTestResults.ai33 && (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: engineTestResults.ai33.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    color: engineTestResults.ai33.success ? '#10b981' : 'var(--danger, #ef4444)',
                    fontSize: '11.5px',
                  }}
                >
                  {engineTestResults.ai33.message}
                </div>
              )}
            </div>

            {/* FameSpeak */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  FameSpeak Voice Engine
                </label>
                {settings.famespeakKey && (
                  <span style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckIcon size={12} /> Key Secured
                  </span>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Celebrity and character voices with 7-day disk caching and 700ms paced query walking.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="password"
                  value={famespeakKeyInput}
                  onChange={(e) => setFamespeakKeyInput(e.target.value)}
                  placeholder={settings.famespeakKey ? '•••••••••••••••• (Saved)' : 'FameSpeak Bearer API Key'}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                  }}
                />
                <button
                  type="button"
                  disabled={!famespeakKeyInput.trim()}
                  onClick={handleSaveFamespeak}
                  className="btn-primary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  Save
                </button>
                {settings.famespeakKey && (
                  <button
                    type="button"
                    onClick={handleClearFamespeak}
                    className="btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--danger, #ef4444)' }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  disabled={testingEngine === 'famespeak'}
                  onClick={() => handleTestTtsEngine('famespeak')}
                  className="btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  {testingEngine === 'famespeak' ? 'Testing...' : 'Test'}
                </button>
              </div>
              {engineTestResults.famespeak && (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: engineTestResults.famespeak.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    color: engineTestResults.famespeak.success ? '#10b981' : 'var(--danger, #ef4444)',
                    fontSize: '11.5px',
                  }}
                >
                  {engineTestResults.famespeak.message}
                </div>
              )}
            </div>

            {/* Offline & Free Engines Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '11.5px' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>Edge TTS (Always Free)</div>
                <div style={{ color: 'var(--text-secondary)' }}>Full Microsoft Neural WebSocket synthesis with exact word boundary timings. No API key needed.</div>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '11.5px' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>Kokoro Local (ONNX)</div>
                <div style={{ color: 'var(--text-secondary)' }}>Ultra-realistic offline synthesis via ONNX runtime. Requires model weights in models/kokoro/.</div>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: ABOUT & SYSTEM DIAGNOSTICS                          */}
        {/* ============================================================ */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <InfinityFlowLogo height={24} showSubtitle={false} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Release Build</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
            <div>Version: {appInfo?.version ?? '1.0.0'}</div>
            <div>Platform: {appInfo?.platform === 'win32' ? 'Windows 10 / 11 (x64)' : appInfo?.platform ?? 'Windows'}</div>
            <div>Application Identifier: com.automistlabs.googleflow</div>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.45, marginTop: '2px' }}>
            Infinity Flow is a high-throughput AI Video Generation Automation Platform orchestrating parallel multi-profile generation pipelines across Google Flow and Gemini.
          </div>
        </div>
      </div>
    </div>
  );
};
