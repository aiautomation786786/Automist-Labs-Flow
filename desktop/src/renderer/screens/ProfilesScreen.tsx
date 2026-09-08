import React, { useState, useEffect } from 'react';
import type { ProfileSessionSnapshot, ProfileSessionStatus } from '../../shared/types';
import { PlusIcon, TrashIcon, ExternalLinkIcon, RefreshIcon, UsersIcon, CheckIcon } from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';

export const ProfilesScreen: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileToDelete, setProfileToDelete] = useState<ProfileSessionSnapshot | null>(null);

  // Per-profile action state/feedback
  const [actionFeedback, setActionFeedback] = useState<Record<string, { msg: string; isError?: boolean }>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Add Profile Wizard Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileEmail, setNewProfileEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

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
    }, 6000);
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
      setFeedback(profileId, 'Opening visible Chrome window for manual sign-in...');
      const res = await window.flowApi.openSignIn(profileId);
      setFeedback(profileId, res.message || 'Chrome window opened.');
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

  const getStatusBadge = (status: ProfileSessionStatus) => {
    switch (status) {
      case 'ready':
        return <span className="badge badge-ready">Connected (Ready)</span>;
      case 'auth_required':
        return <span className="badge badge-attention">Login Required</span>;
      case 'chrome_launched':
      case 'connecting':
      case 'connected':
        return <span className="badge badge-draft">Browser Ready</span>;
      case 'busy':
        return <span className="badge badge-running">Busy</span>;
      case 'error':
        return <span className="badge badge-attention" style={{ backgroundColor: 'var(--danger-subtle)', color: 'var(--danger)' }}>Error</span>;
      case 'stopped':
      case 'created':
      default:
        return <span className="badge badge-draft">Stopped</span>;
    }
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
          <strong style={{ color: 'var(--text-primary)' }}>Isolated Browser Sessions:</strong> Flow profiles use separate browser sessions. Your normal Chrome profiles are not modified or closed.
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
          <p style={{ maxWidth: '440px' }}>
            Add at least one profile to begin running automation tasks. Each profile maintains its own dedicated directory, cookies, and CDP port, completely separate from your personal Chrome.
          </p>
          <button className="btn-primary" onClick={() => setIsAddModalOpen(true)} style={{ marginTop: '8px' }}>
            <PlusIcon size={16} />
            Add First Profile
          </button>
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
                      {getStatusBadge(p.status)}
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '2px' }}>
                      <span>Account: <strong>{p.detectedEmail ?? p.expectedEmail ?? 'Not signed in yet'}</strong></span>
                      {p.expectedEmail && p.detectedEmail && p.expectedEmail !== p.detectedEmail && (
                        <span>Expected: <em>{p.expectedEmail}</em></span>
                      )}
                      <span>CDP Port: <code>{p.cdpPort}</code></span>
                      {p.flowUrl && <span>Locale URL: <code>{p.flowUrl}</code></span>}
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => handleOpenSignIn(p.profileId)}
                      disabled={busy}
                      title="Open visible Chrome window to sign into Google Flow"
                    >
                      <ExternalLinkIcon size={12} />
                      Open Sign-In
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
        message={`Are you sure you want to remove "${profileToDelete?.displayName}"? The profile's Chrome cookies and local directory will be deleted. You will need to sign in again if you re-create it.`}
        confirmLabel="Remove Profile"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setProfileToDelete(null)}
      />

      {/* Add Profile Setup Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => !isCreating && setIsAddModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreateProfileSubmit}>
              <div className="modal-header">
                <h2>Add Google Flow Profile</h2>
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
