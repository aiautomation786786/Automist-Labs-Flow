import React, { useState, useEffect } from 'react';
import type { ProfileSessionSnapshot } from '../../shared/types';
import { PlusIcon, TrashIcon, ExternalLinkIcon, RefreshIcon, UsersIcon } from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';

export const ProfilesScreen: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileToDelete, setProfileToDelete] = useState<ProfileSessionSnapshot | null>(null);

  // Add Profile Wizard Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
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

  const handleStart = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      await window.flowApi.startProfile(profileId);
      await loadProfiles();
    } catch (err) {
      console.error('Failed to start profile', err);
    }
  };

  const handleStop = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      await window.flowApi.stopProfile(profileId);
      await loadProfiles();
    } catch (err) {
      console.error('Failed to stop profile', err);
    }
  };

  const handleOpenChrome = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      await window.flowApi.openChrome(profileId);
      await loadProfiles();
    } catch (err) {
      console.error('Failed to open Chrome', err);
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
      setCreateMsg('Creating isolated Chrome profile directory...');
      const created = await window.flowApi.createProfile({ displayName: newProfileName.trim() });

      setCreateMsg('Launching Chrome window for manual Google sign-in...');
      await window.flowApi.openChrome(created.profileId);

      setIsAddModalOpen(false);
      setNewProfileName('');
      setCreateMsg(null);
      await loadProfiles();
    } catch (err) {
      setCreateMsg(`Error: ${(err as Error).message}`);
    } finally {
      setIsCreating(false);
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
          <p style={{ maxWidth: '420px' }}>
            Add at least one profile to begin running automation tasks. Each profile maintains its own isolated cookies, session, and CDP port.
          </p>
          <button className="btn-primary" onClick={() => setIsAddModalOpen(true)} style={{ marginTop: '8px' }}>
            <PlusIcon size={16} />
            Add First Profile
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {profiles.map((p) => {
            const isReady = p.status === 'ready';
            const isAuthReq = p.status === 'auth_required';
            const isBusy = p.status === 'busy';
            const isStopped = p.status === 'stopped' || p.status === 'created';

            return (
              <div
                key={p.profileId}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ fontSize: '15px' }}>{p.displayName}</h3>
                    <span
                      className={`badge badge-${isReady ? 'ready' : isBusy ? 'running' : isAuthReq ? 'attention' : 'draft'}`}
                    >
                      {isReady ? 'Ready' : isBusy ? 'Busy' : isAuthReq ? 'Sign-In Required' : p.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '16px' }}>
                    <span>Account: <strong>{p.detectedEmail ?? 'Manual Sign-In'}</strong></span>
                    <span>CDP Port: <code>{p.cdpPort}</code></span>
                    {p.flowUrl && <span>Locale: {p.flowUrl}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isAuthReq && (
                    <button className="btn-primary btn-sm" onClick={() => handleOpenChrome(p.profileId)}>
                      <ExternalLinkIcon size={12} />
                      Sign In in Chrome
                    </button>
                  )}

                  {isStopped ? (
                    <button className="btn-secondary btn-sm" onClick={() => handleStart(p.profileId)}>
                      Start Profile
                    </button>
                  ) : (
                    <button className="btn-secondary btn-sm" onClick={() => handleStop(p.profileId)}>
                      Stop
                    </button>
                  )}

                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => handleOpenChrome(p.profileId)}
                    title="Open visible Chrome window"
                  >
                    <ExternalLinkIcon size={12} />
                    Open Chrome
                  </button>

                  <button
                    className="btn-danger btn-sm"
                    onClick={() => setProfileToDelete(p)}
                    title="Remove profile"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
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
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
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
                  Each profile creates an isolated Chrome environment under <code>%LOCALAPPDATA%\GoogleFlowApp</code>.
                  A visible Chrome window will open so you can sign into your Google account manually.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>Profile Display Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Creator Account 01"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <strong>Setup steps:</strong>
                  <ol style={{ paddingLeft: '18px', marginTop: '6px' }}>
                    <li>Enter a recognizable display name.</li>
                    <li>Chrome will open to <code>https://labs.google/fx/tools/flow</code>.</li>
                    <li>Sign into Google manually. Passwords are never saved by this application.</li>
                    <li>Once signed in, return here. The profile status will switch to <strong>Ready</strong>.</li>
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
                  {isCreating ? 'Opening Chrome...' : 'Create & Open Chrome'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
