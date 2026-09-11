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

  // ---- Simplified 1-Click Add Flow Account State ----
  const [addingState, setAddingState] = useState<{
    profileId: string;
    displayName: string;
    status: 'launching' | 'waiting' | 'verified' | 'failed';
    detectedEmail?: string | null;
    message?: string;
  } | null>(null);

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
  const loadProfiles = async (silent = false) => {
    if (!window.flowApi) return;
    try {
      if (!silent) setLoading(true);
      const list = await window.flowApi.listProfiles();
      setProfiles(list);
    } catch (err) {
      console.error('Failed to load profiles', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles(false);
    if (window.flowApi) {
      const unsub = window.flowApi.onWorkerStatus(() => { loadProfiles(true); });
      return () => unsub();
    }
  }, []);

  // Auto-detect authentication while adding Flow account
  useEffect(() => {
    if (!addingState || addingState.status !== 'waiting' || !window.flowApi) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await window.flowApi!.verifyAccount(addingState.profileId);
        if (!isMounted) return;

        if (res.success && res.status === 'ready') {
          clearInterval(interval);
          setAddingState((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'verified',
                  detectedEmail: res.detectedEmail,
                  message: `✅ Authenticated as ${res.detectedEmail ?? 'Google Account'}. Account is ready!`,
                }
              : null
          );
          await loadProfiles(true);
          setTimeout(() => {
            if (isMounted) {
              setAddingState(null);
            }
          }, 1800);
        }
      } catch {
        // Quietly retry
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [addingState?.profileId, addingState?.status]);

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

  // ---- Simplified 1-Click Flow Account Onboarding ----

  const handleAddFlowAccount = async () => {
    if (!window.flowApi) return;
    try {
      // 1. Auto-generate next unique Flow Account name without forcing user to type
      let count = profiles.length + 1;
      let defaultName = `Flow Account ${count}`;
      while (profiles.some((p) => p.displayName.toLowerCase() === defaultName.toLowerCase())) {
        count++;
        defaultName = `Flow Account ${count}`;
      }

      // 2. Immediately create isolated profile config
      const created = await window.flowApi.createProfile({
        displayName: defaultName,
      });

      setAddingState({
        profileId: created.profileId,
        displayName: defaultName,
        status: 'launching',
        message: 'Launching dedicated Chrome window…',
      });

      // 3. Immediately launch dedicated visible Chrome window to Google Flow
      await window.flowApi.launchLoginBrowser(created.profileId);

      setAddingState({
        profileId: created.profileId,
        displayName: defaultName,
        status: 'waiting',
        message: 'Chrome window is open. Sign in to your Google Account.',
      });

      await loadProfiles(true);
    } catch (err) {
      setAddingState((prev) =>
        prev
          ? {
              ...prev,
              status: 'failed',
              message: `Failed to launch: ${(err as Error).message}`,
            }
          : null
      );
    }
  };

  const handleManualVerify = async () => {
    if (!addingState || !window.flowApi) return;
    try {
      setAddingState((prev) => (prev ? { ...prev, message: 'Checking Flow authentication state…' } : null));
      const res = await window.flowApi.verifyAccount(addingState.profileId);
      if (res.success && res.status === 'ready') {
        setAddingState((prev) =>
          prev
            ? {
                ...prev,
                status: 'verified',
                detectedEmail: res.detectedEmail,
                message: `✅ Authenticated as ${res.detectedEmail ?? 'Google Account'}. Account is ready!`,
              }
            : null
        );
        await loadProfiles(true);
        setTimeout(() => setAddingState(null), 1500);
      } else {
        setAddingState((prev) =>
          prev
            ? {
                ...prev,
                message: res.error || 'Google Flow sign-in not yet detected. Complete sign-in in Chrome and retry.',
              }
            : null
        );
      }
    } catch (err) {
      setAddingState((prev) =>
        prev
          ? {
              ...prev,
              message: `Verification check: ${(err as Error).message}`,
            }
          : null
      );
    }
  };

  const handleReopenChrome = async () => {
    if (!addingState || !window.flowApi) return;
    try {
      setAddingState((prev) => (prev ? { ...prev, message: 'Re-opening dedicated Chrome window…' } : null));
      await window.flowApi.launchLoginBrowser(addingState.profileId);
      setAddingState((prev) =>
        prev
          ? {
              ...prev,
              status: 'waiting',
              message: 'Chrome window is open. Sign in to your Google Account.',
            }
          : null
      );
    } catch (err) {
      setAddingState((prev) =>
        prev
          ? {
              ...prev,
              message: `Failed to open Chrome: ${(err as Error).message}`,
            }
          : null
      );
    }
  };

  const handleCancelAdd = async () => {
    if (!addingState) return;
    const targetId = addingState.profileId;
    const isVerified = addingState.status === 'verified';
    setAddingState(null);
    if (!isVerified && window.flowApi) {
      // Clean up temporary unverified profile so it does not linger
      try {
        await window.flowApi.deleteProfile(targetId);
        await loadProfiles(true);
      } catch {
        /* ignore */
      }
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
          <button className="btn-secondary" onClick={() => { loadProfiles(true); }} title="Refresh">
            <RefreshIcon size={14} />
          </button>
          <button
            className="btn-primary"
            onClick={handleAddFlowAccount}
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
            onClick={handleAddFlowAccount}
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
      {/* Add Flow Account Streamlined Onboarding Modal                        */}
      {/* ================================================================== */}
      {addingState && (
        <div className="modal-overlay" onClick={handleCancelAdd}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Flow Account</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleCancelAdd}
              >
                &times;
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {addingState.status === 'launching' && (
                <div style={{ textAlign: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '28px' }}>🚀</div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>Opening Dedicated Chrome Window...</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    Setting up isolated profile directory and launching browser.
                  </div>
                </div>
              )}

              {addingState.status === 'waiting' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                    }}
                  >
                    <div style={{ fontSize: '22px' }}>🌐</div>
                    <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Chrome window is open to Google Flow:</strong>
                      <ol style={{ paddingLeft: '18px', margin: '6px 0 0 0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <li>Sign into your Google Account in the Chrome window.</li>
                        <li>Complete 2-factor authentication or CAPTCHA if prompted.</li>
                        <li>Your account and cookies will be detected automatically.</li>
                      </ol>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-subtle)',
                      border: '1px solid var(--border-color)',
                      fontSize: '12.5px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#6366f1' }} />
                    <span>{addingState.message || 'Waiting for Google Flow sign-in in Chrome…'}</span>
                  </div>

                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    🔒 Dedicated profile isolation: passwords are never seen or stored by Infinity Flow. Session cookies remain safely inside your local Chrome profile.
                  </div>
                </div>
              )}

              {addingState.status === 'verified' && (
                <div style={{ textAlign: 'center', padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                  <div style={{ fontSize: '32px' }}>✅</div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#10b981' }}>Account Verified & Ready!</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                    {addingState.detectedEmail ? `Signed in as ${addingState.detectedEmail}` : 'Google Account authenticated'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    This window will close automatically. Chrome may be kept open or closed.
                  </div>
                </div>
              )}

              {addingState.status === 'failed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'rgba(239, 68, 68, 0.10)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      color: 'var(--danger, #ef4444)',
                      fontSize: '12.5px',
                    }}
                  >
                    {addingState.message}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCancelAdd}
              >
                {addingState.status === 'verified' ? 'Close' : 'Cancel'}
              </button>

              {addingState.status === 'waiting' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleReopenChrome}
                    title="Re-open Chrome if it was closed"
                  >
                    Re-open Chrome
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleManualVerify}
                  >
                    Verify & Complete
                  </button>
                </div>
              )}

              {addingState.status === 'verified' && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setAddingState(null)}
                >
                  Done
                </button>
              )}

              {addingState.status === 'failed' && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleReopenChrome}
                >
                  Try Again
                </button>
              )}
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
