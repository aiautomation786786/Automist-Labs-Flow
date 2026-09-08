import React, { useState, useEffect } from 'react';
import type { ProfileSessionSnapshot, DiscoveredLocalProfile } from '../../shared/types';
import { PlusIcon, TrashIcon, ExternalLinkIcon, RefreshIcon, UsersIcon, CheckIcon } from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';

export const ProfilesScreen: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileToDelete, setProfileToDelete] = useState<ProfileSessionSnapshot | null>(null);

  // Per-profile action state/feedback
  const [actionFeedback, setActionFeedback] = useState<Record<string, { msg: string; isError?: boolean }>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Add Dedicated Profile Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileEmail, setNewProfileEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Connect Existing Profile Modal State
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

    // Listen for worker status updates
    if (window.flowApi) {
      const unsub = window.flowApi.onWorkerStatus(() => {
        loadProfiles();
      });
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
    }, 8000);
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
      setFeedback(profileId, 'Profile session stopped.');
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Stop failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleOpenSignIn = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      setFeedback(profileId, 'Opening Google Flow tab...');
      const res = await window.flowApi.openSignIn(profileId);
      setFeedback(profileId, res.message || 'Browser opened.');
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Open failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleVerifyAccount = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      setFeedback(profileId, 'Checking Google Flow authentication state...');
      const res = await window.flowApi.verifyAccount(profileId);
      if (res.success) {
        setFeedback(profileId, `Verified! Signed in as: ${res.detectedEmail ?? 'Google Account'}`);
      } else if (res.status === 'auth_required' || res.error) {
        setFeedback(profileId, res.error ? `Notice: ${res.error}` : 'Login required — please complete sign-in in Chrome.', true);
      } else {
        setFeedback(profileId, `Current status: ${res.status}`);
      }
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Verification check failed: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleDetectState = async (profileId: string) => {
    if (!window.flowApi?.detectProfileState) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      const res = await window.flowApi.detectProfileState(profileId);
      setFeedback(profileId, res.details, res.state === 'open_not_attachable');
      await loadProfiles();
    } catch (err) {
      setFeedback(profileId, `Detection error: ${(err as Error).message}`, true);
    } finally {
      setActionLoading((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleTestConnection = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      const res = await window.flowApi.testConnection(profileId);
      if (res.responsive) {
        setFeedback(profileId, `Connection OK (CDP port ${res.port} responsive, status: ${res.status})`);
      } else {
        setFeedback(profileId, `CDP port ${res.port} not responding (session status: ${res.status})`, true);
      }
    } catch (err) {
      setFeedback(profileId, `Connection test error: ${(err as Error).message}`, true);
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

  const handleCreateProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim() || !window.flowApi) return;

    try {
      setIsCreating(true);
      setCreateMsg('Creating dedicated isolated Chrome profile directory...');
      const created = await window.flowApi.createProfile({
        displayName: newProfileName.trim(),
        expectedEmail: newProfileEmail.trim() || undefined,
      });

      setCreateMsg('Launching visible Chrome window for manual Google sign-in...');
      await window.flowApi.openSignIn(created.profileId);

      setIsAddModalOpen(false);
      setNewProfileName('');
      setNewProfileEmail('');
      setCreateMsg(null);
      await loadProfiles();
    } catch (err) {
      setCreateMsg(`Error: ${(err as Error).message}`);
    } finally {
      setIsCreating(false);
    }
  };

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
        setExistingDisplayName(first.accountDisplayName || first.profileDisplayName || 'AI Automation');
        setExistingEmail(first.accountEmail || '');
      } else {
        setSelectedFolder('Default');
        setExistingDisplayName('AI Automation');
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
      setExistingDisplayName(found.accountDisplayName || found.profileDisplayName || 'AI Automation');
      setExistingEmail(found.accountEmail || '');
    }
  };

  const handleConnectExistingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.flowApi?.createExistingProfile) return;
    try {
      setIsConnectingExisting(true);
      setConnectExistingMsg({ text: 'Registering existing profile...' });
      const created = await window.flowApi.createExistingProfile({
        displayName: existingDisplayName.trim() || 'AI Automation',
        localProfileDirectory: selectedFolder,
        expectedEmail: existingEmail.trim() || undefined,
      });

      setConnectExistingMsg({ text: 'Checking whether this profile is currently open or attachable...' });
      const detection = window.flowApi.detectProfileState
        ? await window.flowApi.detectProfileState(created.profileId)
        : null;

      if (detection?.state === 'open_and_attachable') {
        setConnectExistingMsg({ text: 'Profile is open and attachable! Opening Google Flow in a new tab...' });
        await window.flowApi.openSignIn(created.profileId);
        setIsExistingModalOpen(false);
        setFeedback(created.profileId, 'Connected to running Chrome session! Flow opened in new tab.');
      } else if (detection?.state === 'open_not_attachable') {
        setIsExistingModalOpen(false);
        setFeedback(created.profileId, detection.details, true);
      } else {
        setIsExistingModalOpen(false);
        setFeedback(created.profileId, 'Profile registered (currently closed). Ready to launch.');
      }
      await loadProfiles();
    } catch (err) {
      setConnectExistingMsg({ text: `Error: ${(err as Error).message}`, isError: true });
    } finally {
      setIsConnectingExisting(false);
    }
  };

  const getStatusBadge = (p: ProfileSessionSnapshot) => {
    const badges: React.ReactNode[] = [];

    // 1. Connection State Badge
    if (p.connectionState === 'connected_existing') {
      badges.push(
        <span key="conn" className="badge badge-ready">
          Connected — Existing Chrome
        </span>
      );
    } else if (p.connectionState === 'connected_dedicated') {
      badges.push(
        <span key="conn" className="badge badge-ready">
          Connected — Dedicated Flow Browser
        </span>
      );
    } else if (p.connectionState === 'profile_open_not_attachable') {
      badges.push(
        <span
          key="conn"
          className="badge badge-attention"
          style={{ backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}
        >
          Chrome Profile Open — Not Attachable
        </span>
      );
    } else if (p.connectionState === 'profile_closed' || p.status === 'stopped' || p.status === 'created') {
      badges.push(
        <span key="conn" className="badge badge-draft">
          Profile Closed
        </span>
      );
    }

    // 2. Auth / Operational State Badge
    if (p.status === 'ready') {
      badges.push(
        <span key="status" className="badge badge-ready">
          Ready (Authenticated)
        </span>
      );
    } else if (p.status === 'auth_required') {
      badges.push(
        <span key="status" className="badge badge-attention">
          Login Required
        </span>
      );
    } else if (p.status === 'chrome_launched' || p.status === 'connecting' || p.status === 'connected') {
      badges.push(
        <span key="status" className="badge badge-draft">
          Browser Ready
        </span>
      );
    } else if (p.status === 'busy') {
      badges.push(
        <span key="status" className="badge badge-running">
          Busy
        </span>
      );
    } else if (p.status === 'error') {
      badges.push(
        <span
          key="status"
          className="badge badge-attention"
          style={{ backgroundColor: 'var(--danger-subtle)', color: 'var(--danger)' }}
        >
          Error
        </span>
      );
    }

    return <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{badges}</div>;
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Google Flow Profiles</h1>
          <p style={{ marginTop: '4px' }}>
            Manage isolated Google accounts and Chrome workers for parallel generation.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-secondary" onClick={loadProfiles} title="Refresh profiles">
            <RefreshIcon size={14} />
          </button>
          <button
            className="btn-secondary"
            onClick={handleOpenConnectExistingModal}
            title="Connect an already open or existing local Chrome profile"
          >
            <UsersIcon size={14} />
            Connect Existing Chrome Profile
          </button>
          <button className="btn-primary" onClick={() => setIsAddModalOpen(true)}>
            <PlusIcon size={16} />
            Add Flow Profile
          </button>
        </div>
      </div>

      {/* Isolation Notice Banner */}
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
          <strong style={{ color: 'var(--text-primary)' }}>Safe Browser Architecture:</strong> Flow profiles use separate browser sessions. Supports attaching to running Chrome profiles without restarting them, or launching dedicated isolated profiles under <code>%LOCALAPPDATA%\AutomistLabs</code>. Normal browser sessions are never killed.
        </div>
      </div>

      {/* Profile List */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading profiles...
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
          <h3>No Google Flow profiles configured</h3>
          <p style={{ maxWidth: '480px' }}>
            Connect an existing local Chrome profile (such as AI Automation) or create a dedicated Flow profile.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button className="btn-secondary" onClick={handleOpenConnectExistingModal}>
              <UsersIcon size={14} />
              Connect Existing Chrome Profile
            </button>
            <button className="btn-primary" onClick={() => setIsAddModalOpen(true)}>
              <PlusIcon size={16} />
              Add Flow Profile
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {profiles.map((p) => {
            const isStopped = p.status === 'stopped' || p.status === 'created';
            const feedback = actionFeedback[p.profileId];
            const busy = actionLoading[p.profileId];

            return (
              <div
                key={p.profileId}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{p.displayName}</h3>
                      {getStatusBadge(p)}
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '2px' }}>
                      <span>
                        Mode: <strong>{p.connectionMode === 'existing_chrome' ? `Existing Chrome (${p.localProfileDirectory ?? 'Default'})` : 'Dedicated Flow Browser'}</strong>
                      </span>
                      <span>Account: <strong>{p.detectedEmail ?? p.expectedEmail ?? 'Not signed in yet'}</strong></span>
                      {p.expectedEmail && p.detectedEmail && p.expectedEmail !== p.detectedEmail && (
                        <span>Expected: <em>{p.expectedEmail}</em></span>
                      )}
                      <span>CDP Port: <code>{p.cdpPort}</code></span>
                      {p.tabCount !== undefined && <span>Tabs: <code>{p.tabCount}</code></span>}
                      {p.flowUrl && <span>Locale URL: <code>{p.flowUrl}</code></span>}
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => handleOpenSignIn(p.profileId)}
                      disabled={busy}
                      title="Open Google Flow tab in this profile"
                    >
                      <ExternalLinkIcon size={12} />
                      Open Sign-In
                    </button>

                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleDetectState(p.profileId)}
                      disabled={busy}
                      title="Detect whether Chrome profile is currently open or attachable"
                    >
                      Detect State
                    </button>

                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleVerifyAccount(p.profileId)}
                      disabled={busy}
                      title="Check Google Flow authentication status"
                    >
                      <CheckIcon size={12} />
                      Verify Account
                    </button>

                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleTestConnection(p.profileId)}
                      disabled={busy}
                      title="Test CDP port responsiveness"
                    >
                      Test Connection
                    </button>

                    {isStopped ? (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => handleStart(p.profileId)}
                        disabled={busy}
                        title="Start background session"
                      >
                        Start
                      </button>
                    ) : (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => handleStop(p.profileId)}
                        disabled={busy}
                        title="Stop this profile session"
                      >
                        Stop
                      </button>
                    )}

                    <button
                      className="btn-danger btn-sm"
                      onClick={() => setProfileToDelete(p)}
                      disabled={busy}
                      title="Remove profile"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>

                {/* Inline Action Feedback */}
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

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={profileToDelete !== null}
        title="Remove Profile"
        message={`Are you sure you want to remove "${profileToDelete?.displayName}"? The profile registration will be removed.`}
        confirmLabel="Remove Profile"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setProfileToDelete(null)}
      />

      {/* Connect Existing Profile Modal */}
      {isExistingModalOpen && (
        <div className="modal-overlay" onClick={() => !isConnectingExisting && setIsExistingModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleConnectExistingSubmit}>
              <div className="modal-header">
                <h2>Connect Existing Chrome Profile</h2>
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
                  Connect an existing Google Chrome profile without restarting or terminating your browser. If Chrome is already running with remote debugging enabled, Flow will open in a <strong>new tab</strong> while keeping all existing tabs open.
                </p>

                {loadingLocalProfiles ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Scanning local Chrome profiles...
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 500 }}>Select Local Chrome Profile *</label>
                      <select
                        value={selectedFolder}
                        onChange={(e) => handleSelectFolder(e.target.value)}
                        style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}
                      >
                        {detectedLocalProfiles.map((lp) => (
                          <option key={lp.profileDirectory} value={lp.profileDirectory}>
                            {lp.accountDisplayName || lp.profileDisplayName} ({lp.profileDirectory}) {lp.accountEmail ? `— ${lp.accountEmail}` : ''}
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
                        Used only as a display label. Passwords and credentials are never requested or stored.
                      </span>
                    </div>

                    <div
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '10px 14px',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <strong>Connection behavior:</strong>
                      <ul style={{ paddingLeft: '18px', marginTop: '6px', lineHeight: '1.6' }}>
                        <li><strong>Open &amp; attachable:</strong> Flow attaches to the live session and opens a new tab. Existing tabs remain untouched.</li>
                        <li><strong>Open but not attachable:</strong> You will be notified safely. Chrome will not be closed or killed.</li>
                        <li><strong>Closed:</strong> The app will launch the profile with remote debugging enabled.</li>
                      </ul>
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
                  {isConnectingExisting ? 'Connecting...' : 'Connect Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Dedicated Profile Setup Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => !isCreating && setIsAddModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreateProfileSubmit}>
              <div className="modal-header">
                <h2>Add Dedicated Flow Profile</h2>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isCreating}
                >
                  &times;
                </button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '13px', lineHeight: '1.5' }}>
                  Each profile creates a dedicated Chrome user data directory under{' '}
                  <code>%LOCALAPPDATA%\AutomistLabs\FlowProfiles</code>.
                  Your personal Chrome sessions remain completely untouched.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Profile Display Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Profile A - Creative"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Target Google Account Email (Optional)</label>
                  <input
                    type="email"
                    placeholder="e.g. aiautomation786786@gmail.com"
                    value={newProfileEmail}
                    onChange={(e) => setNewProfileEmail(e.target.value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Used as a reference hint. Passwords and credentials are never requested or stored.
                  </span>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 14px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <strong>Setup flow:</strong>
                  <ol style={{ paddingLeft: '18px', marginTop: '6px', lineHeight: '1.6' }}>
                    <li>Click <strong>Create &amp; Open Sign-In</strong> below.</li>
                    <li>A visible Chrome window will open to Google Flow.</li>
                    <li>Sign into Google manually in the window. Normal Chrome tabs stay untouched.</li>
                    <li>Once signed in, click <strong>Verify Account</strong> in the dashboard.</li>
                  </ol>
                </div>

                {createMsg && (
                  <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 500 }}>
                    {createMsg}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isCreating || !newProfileName.trim()}
                >
                  {isCreating ? 'Opening Chrome...' : 'Create & Open Sign-In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
