import React, { useState, useEffect } from 'react';
import type { ProfileSessionSnapshot, DiscoveredLocalProfile } from '../../shared/types';
import { PlusIcon, TrashIcon, ExternalLinkIcon, RefreshIcon, UsersIcon, CheckIcon } from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';

// ---------------------------------------------------------------------------
// Helper: derive a human-readable status label and colour from snapshot
// ---------------------------------------------------------------------------

type StatusInfo = {
  label: string;
  color: string;
  bg: string;
  emoji: string;
};

function getStatusInfo(p: ProfileSessionSnapshot): StatusInfo {
  const s = p.status;
  const cs = p.connectionState;

  if (s === 'ready') {
    return { label: 'Ready · Authenticated', color: '#10b981', bg: 'rgba(16,185,129,0.12)', emoji: '●' };
  }
  if (s === 'busy') {
    return { label: 'Busy (Generating)', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', emoji: '⏳' };
  }
  if (s === 'auth_required' || cs === 'login_required') {
    return { label: 'Sign-In Required', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', emoji: '🔑' };
  }
  if (s === 'chrome_launched' || s === 'connecting' || s === 'connected') {
    return { label: 'Connecting...', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', emoji: '◌' };
  }
  if (s === 'browser_open' || cs === 'browser_open') {
    return { label: 'Browser Open', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', emoji: '🌐' };
  }
  if (s === 'starting') {
    return { label: 'Starting Background…', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', emoji: '◌' };
  }
  if (s === 'stopping') {
    return { label: 'Stopping…', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', emoji: '⏹' };
  }
  if (s === 'error') {
    return { label: 'Error', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', emoji: '❌' };
  }
  // created / stopped
  return { label: 'Offline', color: '#64748b', bg: 'rgba(100,116,139,0.10)', emoji: '⚪' };
}

// ---------------------------------------------------------------------------
// ProfilesScreen component
// ---------------------------------------------------------------------------

export const ProfilesScreen: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileToDelete, setProfileToDelete] = useState<ProfileSessionSnapshot | null>(null);

  // Per-profile action state/feedback
  const [actionFeedback, setActionFeedback] = useState<Record<string, { msg: string; isError?: boolean }>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // ---- Add Flow Account wizard state ----
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [wizardStatus, setWizardStatus] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isWizardBusy, setIsWizardBusy] = useState(false);

  // ---- Connect Existing Profile Modal (advanced, de-emphasised) ----
  const [isExistingModalOpen, setIsExistingModalOpen] = useState(false);
  const [detectedLocalProfiles, setDetectedLocalProfiles] = useState<
    Array<DiscoveredLocalProfile & { isOpen: boolean; isAttachable: boolean; cdpPort?: number }>
  >([]);
  const [loadingLocalProfiles, setLoadingLocalProfiles] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('Default');
  const [existingDisplayName, setExistingDisplayName] = useState('');
  const [existingEmail, setExistingEmail] = useState('');
  const [isConnectingExisting, setIsConnectingExisting] = useState(false);
  const [connectExistingMsg, setConnectExistingMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // ---- Data loading ----
  const loadProfiles = async () => {
    if (!window.flowApi) return;
    try {
      setLoading(true);
      const list = await window.flowApi.listProfiles();
      setProfiles(list);
    } catch (err) {
      console.error('Failed to load profiles', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
    if (window.flowApi) {
      const unsub = window.flowApi.onWorkerStatus(() => { loadProfiles(); });
      return () => unsub();
    }
  }, []);

  const setFeedback = (profileId: string, msg: string, isError = false) => {
    setActionFeedback((prev) => ({ ...prev, [profileId]: { msg, isError } }));
    setTimeout(() => {
      setActionFeedback((prev) => {
        const next = { ...prev };
        delete next[profileId];
        return next;
      });
    }, 10000);
  };

  // ---- Per-profile handlers ----

  const handleLaunchLoginBrowser = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      setFeedback(profileId, 'Launching dedicated Chrome window…');
      const res = await window.flowApi.launchLoginBrowser(profileId);
      setFeedback(profileId, `✅ ${res.message}`);
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Launch failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleVerifyAccount = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      setFeedback(profileId, 'Checking Google Flow authentication state…');
      const res = await window.flowApi.verifyAccount(profileId);
      if (res.success) {
        setFeedback(profileId, `✅ Authenticated as: ${res.detectedEmail ?? 'Google Account'}`);
      } else if (res.status === 'auth_required' || res.error) {
        setFeedback(
          profileId,
          res.error ? `Notice: ${res.error}` : 'Login required — sign in via Chrome window.',
          true,
        );
      } else {
        setFeedback(profileId, `Status: ${res.status}`);
      }
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Verification failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleOpenFlow = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      setFeedback(profileId, 'Activating Google Flow tab…');
      if (window.flowApi.openFlow) {
        const res = await window.flowApi.openFlow(profileId);
        setFeedback(profileId, res.message || 'Flow tab active.');
      } else {
        await window.flowApi.openSignIn(profileId);
        setFeedback(profileId, 'Flow tab active.');
      }
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Open Flow failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleStart = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      await window.flowApi.startProfile(profileId);
      setFeedback(profileId, 'Profile session started.');
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Start failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleStop = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      await window.flowApi.stopProfile(profileId);
      setFeedback(profileId, 'Browser closed.');
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Stop failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!profileToDelete || !window.flowApi) return;
    try {
      await window.flowApi.deleteProfile(profileToDelete.profileId);
      setProfileToDelete(null);
      await loadProfiles();
    } catch (err) {
      console.error('Failed to delete profile', err);
    }
  };

  const handleTestConnection = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      const res = await window.flowApi.testConnection(profileId);
      if (res.responsive) {
        setFeedback(profileId, `Connection OK (CDP port ${res.port}, status: ${res.status})`);
      } else {
        setFeedback(profileId, `CDP port ${res.port} not responding (status: ${res.status})`, true);
      }
    } catch (err) {
      setFeedback(profileId, `Connection test error: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  // ---- Add Flow Account wizard ----

  const resetWizard = () => {
    setWizardStep(1);
    setNewAccountName('');
    setNewAccountEmail('');
    setWizardStatus(null);
    setIsWizardBusy(false);
  };

  const handleAddModalClose = () => {
    if (isWizardBusy) return;
    setIsAddModalOpen(false);
    resetWizard();
  };

  const handleWizardNext = () => {
    if (wizardStep === 1 && !newAccountName.trim()) return;
    setWizardStep((s) => Math.min(s + 1, 3) as 1 | 2 | 3);
  };

  const handleWizardBack = () => {
    setWizardStep((s) => Math.max(s - 1, 1) as 1 | 2 | 3);
    setWizardStatus(null);
  };

  const handleWizardOpenLogin = async () => {
    if (!window.flowApi) return;
    try {
      setIsWizardBusy(true);
      setWizardStatus({ text: 'Creating dedicated profile directory…' });

      // Step 1: create profile config on disk
      const created = await window.flowApi.createProfile({
        displayName: newAccountName.trim(),
        expectedEmail: newAccountEmail.trim() || undefined,
      });
      setWizardStatus({ text: 'Profile created. Launching dedicated Chrome window…' });

      // Step 2: fast-path browser launch (returns when PID confirmed)
      const launchResult = await window.flowApi.launchLoginBrowser(created.profileId);
      setWizardStatus({
        text: `✅ ${launchResult.message}`,
      });

      await loadProfiles();

      // Close wizard after a brief success pause
      setTimeout(() => {
        setIsAddModalOpen(false);
        resetWizard();
      }, 2500);
    } catch (err) {
      setWizardStatus({ text: `Error: ${(err as Error).message}`, isError: true });
    } finally {
      setIsWizardBusy(false);
    }
  };

  // ---- Connect Existing Profile modal (advanced) ----

  const handleOpenConnectExistingModal = async () => {
    setIsExistingModalOpen(true);
    setConnectExistingMsg(null);
    if (!window.flowApi?.detectLocalChromeProfiles) return;
    try {
      setLoadingLocalProfiles(true);
      const list = await window.flowApi.detectLocalChromeProfiles();
      setDetectedLocalProfiles(list);
      if (list.length > 0) {
        const first = list[0];
        setSelectedFolder(first.profileDirectory);
        setExistingDisplayName(first.accountDisplayName || first.profileDisplayName || 'Flow Account');
        setExistingEmail(first.accountEmail || '');
      } else {
        setSelectedFolder('Default');
        setExistingDisplayName('Flow Account');
        setExistingEmail('');
      }
    } catch (err) {
      setConnectExistingMsg({ text: `Failed to detect profiles: ${(err as Error).message}`, isError: true });
    } finally {
      setLoadingLocalProfiles(false);
    }
  };

  const handleSelectFolder = (folderName: string) => {
    setSelectedFolder(folderName);
    const found = detectedLocalProfiles.find((p) => p.profileDirectory === folderName);
    if (found) {
      setExistingDisplayName(found.accountDisplayName || found.profileDisplayName || 'Flow Account');
      setExistingEmail(found.accountEmail || '');
    }
  };

  const handleConnectExistingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.flowApi?.createExistingProfile) return;
    try {
      setIsConnectingExisting(true);
      setConnectExistingMsg({ text: 'Registering existing profile…' });
      const created = await window.flowApi.createExistingProfile({
        displayName: existingDisplayName.trim() || 'Flow Account',
        localProfileDirectory: selectedFolder,
        expectedEmail: existingEmail.trim() || undefined,
      });

      setConnectExistingMsg({ text: 'Checking connection state…' });
      const detection = window.flowApi.detectProfileState
        ? await window.flowApi.detectProfileState(created.profileId)
        : null;

      if (detection?.state === 'open_and_attachable') {
        setConnectExistingMsg({ text: 'Profile is open and attachable! Opening Google Flow in a new tab…' });
        await window.flowApi.openSignIn(created.profileId);
        setIsExistingModalOpen(false);
        setFeedback(created.profileId, 'Connected to running Chrome session. Flow opened in new tab.');
      } else if (detection?.state === 'open_not_attachable') {
        setIsExistingModalOpen(false);
        setFeedback(created.profileId, detection.details, true);
      } else {
        setIsExistingModalOpen(false);
        setFeedback(created.profileId, 'Profile registered. Click "Open Login" to launch.');
      }
      await loadProfiles();
    } catch (err) {
      setConnectExistingMsg({ text: `Error: ${(err as Error).message}`, isError: true });
    } finally {
      setIsConnectingExisting(false);
    }
  };

  // ---- Render ----

  const isStopped = (p: ProfileSessionSnapshot) =>
    p.status === 'stopped' || p.status === 'created' || p.status === 'error';

  const isBrowserRunning = (p: ProfileSessionSnapshot) =>
    p.status === 'browser_open' ||
    p.status === 'chrome_launched' ||
    p.status === 'connecting' ||
    p.status === 'connected' ||
    p.status === 'auth_required' ||
    p.status === 'ready' ||
    p.status === 'busy';

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Flow Accounts</h1>
          <p style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
            Each account has its own isolated Chrome session, CDP port, and job queue.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className="btn-secondary" onClick={loadProfiles} title="Refresh">
            <RefreshIcon size={14} />
          </button>
          <button
            className="btn-primary"
            onClick={() => { setIsAddModalOpen(true); resetWizard(); }}
          >
            <PlusIcon size={16} />
            Add Flow Account
          </button>
        </div>
      </div>

      {/* Safety Banner */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          color: 'var(--text-secondary)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ fontSize: '18px', flexShrink: 0 }}>🛡️</div>
        <div>
          <strong style={{ color: 'var(--text-primary)' }}>Dedicated Flow Profiles:</strong>{' '}
          Each Flow account uses its own Chrome user-data directory under{' '}
          <code>%LOCALAPPDATA%\AutomistLabs\FlowProfiles</code>.
          Your normal Chrome profiles are never touched.{' '}
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '0 2px',
              textDecoration: 'underline',
            }}
            onClick={handleOpenConnectExistingModal}
          >
            Advanced: Connect existing Chrome profile
          </button>
        </div>
      </div>

      {/* Profile List */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading accounts…
        </div>
      ) : profiles.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '48px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <UsersIcon size={36} style={{ color: 'var(--text-muted)' }} />
          <h3>No Flow Accounts configured</h3>
          <p style={{ maxWidth: '480px', color: 'var(--text-secondary)' }}>
            Add a Flow Account to get started. Each account launches its own dedicated Chrome window
            and maintains an isolated Google session.
          </p>
          <button
            className="btn-primary"
            onClick={() => { setIsAddModalOpen(true); resetWizard(); }}
            style={{ marginTop: '8px' }}
          >
            <PlusIcon size={16} />
            Add Flow Account
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {profiles.map((p) => {
            const statusInfo = getStatusInfo(p);
            const feedback = actionFeedback[p.profileId];
            const busy = actionLoading[p.profileId];
            const browserRunning = isBrowserRunning(p);
            const stopped = isStopped(p);

            return (
              <div
                key={p.profileId}
                className="card"
                style={{
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                {/* Card header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
                  {/* Left: Avatar + Account info */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        backgroundColor: p.status === 'ready' ? 'var(--primary-subtle)' : 'var(--bg-subtle)',
                        color: p.status === 'ready' ? 'var(--primary)' : 'var(--text-muted)',
                        border: `1px solid ${p.status === 'ready' ? 'var(--primary-border)' : 'var(--border-color)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '14px',
                        flexShrink: 0,
                      }}
                    >
                      {p.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>{p.displayName}</h3>
                        {/* Status badge */}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: statusInfo.bg,
                            color: statusInfo.color,
                            letterSpacing: '0.02em',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {statusInfo.emoji} {statusInfo.label}
                        </span>
                      </div>

                    {/* Metadata row */}
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                      <span>
                        Google Account:{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {p.detectedEmail ?? p.expectedEmail ?? 'Not signed in yet'}
                        </strong>
                      </span>
                      <span>
                        Session:{' '}
                        <strong style={{ color: p.status === 'ready' ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {p.status === 'ready' || p.status === 'busy' ? 'Background (Managed)' : 'Dedicated Profile'}
                        </strong>
                      </span>
                      <span>
                        CDP Port: <code>{p.cdpPort}</code>
                      </span>
                      {p.chromePid && (
                        <span>
                          PID: <code>{p.chromePid}</code>
                        </span>
                      )}
                    </div>

                    {/* Error message */}
                    {p.status === 'error' && p.errorMessage && (
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--danger)',
                          backgroundColor: 'var(--danger-subtle)',
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          maxWidth: '500px',
                        }}
                      >
                        {p.errorMessage}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: action buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {/* Primary action: Open Login (when not authenticated or browser not running) */}
                    {(stopped || p.status === 'browser_open' || p.status === 'auth_required') && (
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => handleLaunchLoginBrowser(p.profileId)}
                        disabled={busy || p.status === 'starting'}
                        title="Open dedicated Chrome window for Google sign-in"
                      >
                        <ExternalLinkIcon size={12} />
                        Open Login
                      </button>
                    )}

                    {/* Open Flow: when authenticated (ready) */}
                    {p.status === 'ready' && (
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => handleOpenFlow(p.profileId)}
                        disabled={busy}
                        title="Open Google Flow in this account's browser"
                      >
                        <ExternalLinkIcon size={12} />
                        Open Flow
                      </button>
                    )}

                    {/* Verify Account */}
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleVerifyAccount(p.profileId)}
                      disabled={busy}
                      title="Check if signed into Google Flow"
                    >
                      <CheckIcon size={12} />
                      Verify Account
                    </button>

                    {/* Start (when fully stopped) */}
                    {stopped && (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => handleStart(p.profileId)}
                        disabled={busy}
                        title="Start full Flow session (CDP + auth check)"
                      >
                        Start
                      </button>
                    )}

                    {/* Stop (when browser is running) */}
                    {browserRunning && (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => handleStop(p.profileId)}
                        disabled={busy}
                        title="Close this account's dedicated browser"
                      >
                        Stop
                      </button>
                    )}

                    {/* Test Connection (developer detail, de-emphasised) */}
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleTestConnection(p.profileId)}
                      disabled={busy}
                      title="Test CDP port responsiveness"
                      style={{ opacity: 0.6, fontSize: '11px' }}
                    >
                      Test CDP
                    </button>

                    {/* Remove */}
                    <button
                      className="btn-danger btn-sm"
                      onClick={() => setProfileToDelete(p)}
                      disabled={busy}
                      title="Remove this Flow account"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>

                {/* Inline feedback */}
                {feedback && (
                  <div
                    style={{
                      fontSize: '12px',
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: feedback.isError ? 'var(--danger-subtle)' : 'var(--bg-subtle)',
                      color: feedback.isError ? 'var(--danger)' : 'var(--text-secondary)',
                      border: `1px solid ${feedback.isError ? 'var(--danger)' : 'var(--border-color)'}`,
                      lineHeight: '1.4',
                    }}
                  >
                    {feedback.msg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================== */}
      {/* Delete Confirmation Modal                                           */}
      {/* ================================================================== */}
      <ConfirmModal
        isOpen={profileToDelete !== null}
        title="Remove Flow Account"
        message={`Are you sure you want to remove "${profileToDelete?.displayName}"? The dedicated profile registration will be removed. The Chrome session data on disk is preserved.`}
        confirmLabel="Remove Account"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setProfileToDelete(null)}
      />

      {/* ================================================================== */}
      {/* Add Flow Account Wizard Modal                                        */}
      {/* ================================================================== */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={handleAddModalClose}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Flow Account</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleAddModalClose}
                disabled={isWizardBusy}
              >
                &times;
              </button>
            </div>

            {/* Wizard steps indicator */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                padding: '12px 20px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              {([1, 2, 3] as const).map((step) => (
                <div
                  key={step}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: wizardStep === step ? 600 : 400,
                    color: wizardStep >= step ? 'var(--primary)' : 'var(--text-muted)',
                  }}
                >
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: wizardStep > step
                        ? 'var(--primary)'
                        : wizardStep === step
                          ? 'var(--primary)'
                          : 'var(--border-color)',
                      color: wizardStep >= step ? 'white' : 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {wizardStep > step ? '✓' : step}
                  </div>
                  <span>{step === 1 ? 'Account Name' : step === 2 ? 'Email Hint' : 'Open Login'}</span>
                  {step < 3 && <span style={{ marginLeft: '4px', color: 'var(--text-muted)' }}>›</span>}
                </div>
              ))}
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Step 1: Account Name */}
              {wizardStep === 1 && (
                <>
                  <p style={{ fontSize: '13px', lineHeight: '1.5' }}>
                    Give this Flow account a name so you can identify it in the list.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>Account Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. AI Automation, Creator, Backup"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && newAccountName.trim() && handleWizardNext()}
                      autoFocus
                      required
                    />
                  </div>
                </>
              )}

              {/* Step 2: Email Hint */}
              {wizardStep === 2 && (
                <>
                  <p style={{ fontSize: '13px', lineHeight: '1.5' }}>
                    Optionally enter the Google account email you will sign in with.
                    This is a display label only — it helps you identify the account.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>Google Account Email <em>(optional)</em></label>
                    <input
                      type="email"
                      placeholder="e.g. aiautomation786786@gmail.com"
                      value={newAccountEmail}
                      onChange={(e) => setNewAccountEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleWizardNext()}
                      autoFocus
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      🔒 Password is never requested or stored. Credentials are never shared with this app.
                    </span>
                  </div>
                </>
              )}

              {/* Step 3: Open Login */}
              {wizardStep === 3 && (
                <>
                  <div
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                      fontSize: '13px',
                      lineHeight: '1.6',
                    }}
                  >
                    <strong>Ready to launch:</strong>
                    <ul style={{ paddingLeft: '20px', marginTop: '8px', marginBottom: 0 }}>
                      <li>Account: <strong>{newAccountName}</strong></li>
                      {newAccountEmail && <li>Email hint: {newAccountEmail}</li>}
                      <li>A dedicated Chrome window will open to Google Flow.</li>
                      <li>Sign into Google manually in that window.</li>
                      <li>Your existing Chrome windows stay untouched.</li>
                      <li>Click <strong>Verify Account</strong> after signing in.</li>
                    </ul>
                  </div>

                  {wizardStatus && (
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: wizardStatus.isError ? 'var(--danger-subtle)' : 'var(--bg-subtle)',
                        color: wizardStatus.isError ? 'var(--danger)' : 'var(--primary)',
                        border: `1px solid ${wizardStatus.isError ? 'var(--danger)' : 'var(--border-color)'}`,
                      }}
                    >
                      {wizardStatus.text}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {wizardStep > 1 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleWizardBack}
                    disabled={isWizardBusy}
                  >
                    ← Back
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleAddModalClose}
                  disabled={isWizardBusy}
                >
                  Cancel
                </button>
              </div>

              <div>
                {wizardStep < 3 && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleWizardNext}
                    disabled={wizardStep === 1 && !newAccountName.trim()}
                  >
                    Next →
                  </button>
                )}
                {wizardStep === 3 && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleWizardOpenLogin}
                    disabled={isWizardBusy}
                  >
                    {isWizardBusy ? 'Launching…' : '🚀 Open Login'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Connect Existing Profile Modal (advanced)                           */}
      {/* ================================================================== */}
      {isExistingModalOpen && (
        <div className="modal-overlay" onClick={() => !isConnectingExisting && setIsExistingModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleConnectExistingSubmit}>
              <div className="modal-header">
                <h2>Connect Existing Chrome Profile <em style={{ fontSize: '13px', fontWeight: 400 }}>(Advanced)</em></h2>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setIsExistingModalOpen(false)}
                  disabled={isConnectingExisting}
                >
                  &times;
                </button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '13px', lineHeight: '1.5' }}>
                  Connect an existing local Chrome profile without restarting your browser.
                  If Chrome has remote debugging enabled, Flow will open in a <strong>new tab</strong>.
                </p>

                {loadingLocalProfiles ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Scanning local Chrome profiles…
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 500 }}>Local Chrome Profile *</label>
                      <select
                        value={selectedFolder}
                        onChange={(e) => handleSelectFolder(e.target.value)}
                        style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}
                      >
                        {detectedLocalProfiles.map((lp) => (
                          <option key={lp.profileDirectory} value={lp.profileDirectory}>
                            {lp.accountDisplayName || lp.profileDisplayName} ({lp.profileDirectory})
                            {lp.accountEmail ? ` — ${lp.accountEmail}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 500 }}>Display Name *</label>
                      <input
                        type="text"
                        value={existingDisplayName}
                        onChange={(e) => setExistingDisplayName(e.target.value)}
                        placeholder="e.g. AI Automation"
                        required
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 500 }}>Account Email Hint</label>
                      <input
                        type="text"
                        value={existingEmail}
                        onChange={(e) => setExistingEmail(e.target.value)}
                        placeholder="e.g. aiautomation786786@gmail.com"
                      />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Display label only. Passwords and credentials are never requested or stored.
                      </span>
                    </div>
                  </>
                )}

                {connectExistingMsg && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: connectExistingMsg.isError ? 'var(--danger)' : 'var(--primary)',
                      fontWeight: 500,
                    }}
                  >
                    {connectExistingMsg.text}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsExistingModalOpen(false)}
                  disabled={isConnectingExisting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isConnectingExisting || !existingDisplayName.trim()}
                >
                  {isConnectingExisting ? 'Connecting…' : 'Connect Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
