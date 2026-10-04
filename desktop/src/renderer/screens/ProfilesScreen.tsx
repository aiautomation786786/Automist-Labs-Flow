import React, { useState, useEffect } from 'react';
import type {
  ProfileSessionSnapshot,
  DiscoveredLocalProfile,
  ProfileConnectionProgress,
} from '../../shared/types';
import { PlusIcon, TrashIcon, ExternalLinkIcon, RefreshIcon, UsersIcon, CheckIcon, ArrowRightIcon } from '../components/Icons';
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

  if (
    p.isVerifying ||
    s === 'starting' ||
    s === 'chrome_launched' ||
    s === 'waiting_for_cdp' ||
    s === 'connecting' ||
    s === 'creating_page'
  ) {
    return { label: 'Checking...', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', emoji: '◌' };
  }
  if (s === 'ready') {
    return { label: 'Connected', color: '#10b981', bg: 'rgba(16,185,129,0.12)', emoji: '●' };
  }
  if (s === 'busy') {
    return { label: 'Busy (Generating)', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', emoji: '⏳' };
  }
  if (s === 'auth_required' || cs === 'login_required') {
    return { label: 'Reconnect Required', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', emoji: '🔑' };
  }
  if (s === 'connected') {
    return { label: 'Connected', color: '#10b981', bg: 'rgba(16,185,129,0.12)', emoji: '●' };
  }
  if (s === 'reconnecting') {
    return { label: 'Reconnecting…', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', emoji: '🔄' };
  }
  if (s === 'connection_error') {
    return { label: 'Temporary Error', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', emoji: '⚠️' };
  }
  if (s === 'browser_open' || cs === 'browser_open') {
    return { label: 'Signing In…', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', emoji: '🌐' };
  }
  if (s === 'stopping') {
    return { label: 'Stopping…', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', emoji: '⏹' };
  }
  if (s === 'error') {
    return { label: 'Verification Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', emoji: '❌' };
  }
  // created / stopped
  return { label: 'Stopped', color: '#64748b', bg: 'rgba(100,116,139,0.10)', emoji: '⚪' };
}

const CONNECTION_STAGE_STEPS: Array<{ key: string; label: string }> = [
  { key: 'preparing', label: 'Preparing profile' },
  { key: 'copying_session', label: 'Copying account session' },
  { key: 'checking_auth', label: 'Checking existing login' },
  { key: 'connecting_flow', label: 'Connecting to Google Flow' },
  { key: 'finalizing', label: 'Finalizing account' },
];

function getStageStepState(stepIndex: number, progress: ProfileConnectionProgress): 'completed' | 'active' | 'pending' | 'error' {
  const stage = progress.stage;
  if (stage === 'success') return 'completed';
  if (stage === 'error' || stage === 'cancelled') {
    let errorStep = 0;
    if (progress.progress >= 90) errorStep = 4;
    else if (progress.progress >= 70) errorStep = 3;
    else if (progress.progress >= 50) errorStep = 2;
    else if (progress.progress >= 30) errorStep = 1;

    if (stepIndex < errorStep) return 'completed';
    if (stepIndex === errorStep) return 'error';
    return 'pending';
  }

  let currentStep = 0;
  switch (stage) {
    case 'preparing':
      currentStep = 0;
      break;
    case 'copying_session':
      currentStep = 1;
      break;
    case 'checking_auth':
      currentStep = 2;
      break;
    case 'connecting_flow':
      currentStep = 3;
      break;
    case 'auth_required':
    case 'waiting_for_user':
    case 'login_detected':
    case 'finalizing':
      currentStep = 4;
      break;
    default:
      currentStep = 0;
  }

  if (stepIndex < currentStep) return 'completed';
  if (stepIndex === currentStep) return 'active';
  return 'pending';
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

  // ---- Add Flow Account: choice modal ----
  const [isAddChoiceModalOpen, setIsAddChoiceModalOpen] = useState(false);

  // ---- Sign in with Google onboarding state ----
  const [addingState, setAddingState] = useState<{
    profileId: string;
    displayName: string;
    status: 'launching' | 'waiting' | 'verified' | 'failed';
    detectedEmail?: string | null;
    message?: string;
  } | null>(null);

  // ---- Connect Existing Profile Modal ----
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

  // ---- Live Connection Progress Modal (event-driven) ----
  const [connectionProgress, setConnectionProgress] = useState<ProfileConnectionProgress | null>(null);
  const [isCancellingConnection, setIsCancellingConnection] = useState(false);

  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadProfiles(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadProfiles(false);
    const unsubs: Array<() => void> = [];
    if (window.flowApi) {
      if (window.flowApi.onWorkerStatus) {
        unsubs.push(window.flowApi.onWorkerStatus(() => { loadProfiles(true); }));
      }
      if (window.flowApi.onProfileConnectionProgress) {
        unsubs.push(
          window.flowApi.onProfileConnectionProgress((prog) => {
            setConnectionProgress((prev) => {
              if (!prev || !prog.profileId || prev.profileId === prog.profileId || !prev.profileId) {
                return { ...prev, ...prog };
              }
              return prev;
            });
            if (prog.stage === 'success') {
              loadProfiles(true);
              setTimeout(() => {
                setConnectionProgress(null);
              }, 700);
            }
          })
        );
      }
    }
    return () => {
      unsubs.forEach((u) => u());
    };
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

  // ---- Selection & Bulk Verification ----
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [isBulkVerifying, setIsBulkVerifying] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);

  const handleToggleSelect = (profileId: string) => {
    setSelectedProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedProfileIds.size === profiles.length) {
      setSelectedProfileIds(new Set());
    } else {
      setSelectedProfileIds(new Set(profiles.map((p) => p.profileId)));
    }
  };

  const handleClearSelection = () => {
    setSelectedProfileIds(new Set());
  };

  const handleVerifySelected = async () => {
    if (!window.flowApi || selectedProfileIds.size === 0 || isBulkVerifying) return;

    const selectedProfiles = profiles.filter((p) => selectedProfileIds.has(p.profileId));
    const alreadyConnected = selectedProfiles.filter((p) => p.status === 'ready');
    const eligibleProfiles = selectedProfiles.filter(
      (p) =>
        p.status !== 'ready' &&
        p.status !== 'starting' &&
        p.status !== 'chrome_launched' &&
        p.status !== 'waiting_for_cdp' &&
        p.status !== 'connecting' &&
        p.status !== 'creating_page' &&
        p.status !== 'busy'
    );

    if (eligibleProfiles.length === 0) {
      setBulkFeedback(
        `All ${selectedProfiles.length} selected account(s) are already connected or in progress.`
      );
      setTimeout(() => setBulkFeedback(null), 4000);
      return;
    }

    try {
      setIsBulkVerifying(true);
      setBulkFeedback(
        `Verifying ${eligibleProfiles.length} account(s) in background... (${alreadyConnected.length} already connected skipped)`
      );

      if (window.flowApi.verifySelectedProfiles) {
        await window.flowApi.verifySelectedProfiles(eligibleProfiles.map((p) => p.profileId));
      } else {
        for (const ep of eligibleProfiles) {
          await window.flowApi.verifyAccount(ep.profileId).catch(() => {});
        }
      }

      await loadProfiles(true);
      setBulkFeedback(`Bulk verification complete for ${eligibleProfiles.length} account(s).`);
    } catch (err) {
      setBulkFeedback(`Bulk verification error: ${(err as Error).message}`);
    } finally {
      setIsBulkVerifying(false);
      setTimeout(() => setBulkFeedback(null), 5000);
    }
  };

  // ---- Per-profile handlers ----

  const handleLaunchLoginBrowser = async (profileId: string) => {
    if (!window.flowApi) return;
    try {
      setActionLoading((prev) => ({ ...prev, [profileId]: true }));
      setFeedback(profileId, 'Launching dedicated Chrome window…');
      const target = profiles.find((item) => item.profileId === profileId);
      setAddingState({
        profileId,
        displayName: target?.displayName || 'Flow Account',
        status: 'waiting',
        message: 'Chrome window is open. Sign in to your Google Account.',
      });
      const res = await window.flowApi.launchLoginBrowser(profileId);
      setFeedback(profileId, `✅ ${res.message}`);
      await loadProfiles(true);
    } catch (err) {
      setFeedback(profileId, `Launch failed: ${(err as Error).message}`, true);
      setAddingState(null);
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



  // ---- Simplified 1-Click Flow Account Onboarding ----

  const handleAddFlowAccount = () => {
    // Open choice modal instead of immediately launching Chrome
    setIsAddChoiceModalOpen(true);
  };

  // ---- Called when user picks "Sign in with Google" in the choice modal ----
  const handleSignInWithGoogle = async () => {
    if (!window.flowApi) return;
    setIsAddChoiceModalOpen(false);
    try {
      // 1. Auto-generate next unique Flow Account name
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

      // 3. Launch dedicated visible Chrome window to Google Flow
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
    setIsAddChoiceModalOpen(false);
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
    if (!window.flowApi) return;
    try {
      setIsConnectingExisting(true);
      setConnectExistingMsg(null);
      setIsExistingModalOpen(false);

      setConnectionProgress({
        profileId: '',
        stage: 'preparing',
        message: 'Preparing isolated profile environment…',
        progress: 10,
        displayName: existingDisplayName.trim() || 'Flow Account',
      });

      if (window.flowApi.connectExistingProfile) {
        const result = await window.flowApi.connectExistingProfile({
          displayName: existingDisplayName.trim() || 'Flow Account',
          localProfileDirectory: selectedFolder,
          expectedEmail: existingEmail.trim() || undefined,
        });

        if (result.success && result.status === 'ready') {
          setConnectionProgress({
            profileId: result.profileId,
            stage: 'success',
            message: 'Connected successfully ✓',
            progress: 100,
            displayName: existingDisplayName.trim() || 'Flow Account',
            detectedEmail: result.detectedEmail,
          });
          await loadProfiles(true);
          setTimeout(() => {
            setConnectionProgress(null);
          }, 700);
        } else if (result.requiresInteraction) {
          setConnectionProgress({
            profileId: result.profileId,
            stage: 'waiting_for_user',
            message: 'Chrome window is open. Sign in to your Google Account.',
            progress: 80,
            displayName: existingDisplayName.trim() || 'Flow Account',
          });
        } else {
          setConnectionProgress({
            profileId: result.profileId,
            stage: 'error',
            message: result.error || 'Failed to connect profile',
            progress: 100,
            error: result.error || 'Failed to connect profile',
          });
        }
      } else if (window.flowApi.createExistingProfile) {
        // Fallback if connectExistingProfile not available
        const created = await window.flowApi.createExistingProfile({
          displayName: existingDisplayName.trim() || 'Flow Account',
          localProfileDirectory: selectedFolder,
          expectedEmail: existingEmail.trim() || undefined,
        });
        setConnectionProgress({
          profileId: created.profileId,
          stage: 'checking_auth',
          message: 'Verifying Google Flow connection…',
          progress: 60,
          displayName: created.displayName,
        });
        const verifyRes = await window.flowApi.verifyAccount(created.profileId);
        if (verifyRes.success && verifyRes.status === 'ready') {
          setConnectionProgress({
            profileId: created.profileId,
            stage: 'success',
            message: 'Connected successfully ✓',
            progress: 100,
            displayName: created.displayName,
            detectedEmail: verifyRes.detectedEmail,
          });
          await loadProfiles(true);
          setTimeout(() => setConnectionProgress(null), 700);
        } else {
          setConnectionProgress({
            profileId: created.profileId,
            stage: 'waiting_for_user',
            message: 'Chrome window is open. Sign in to your Google Account.',
            progress: 80,
            displayName: created.displayName,
          });
          await window.flowApi.launchLoginBrowser(created.profileId);
        }
      }
      await loadProfiles(true);
    } catch (err) {
      setConnectionProgress((prev) => ({
        profileId: prev?.profileId || '',
        stage: 'error',
        message: (err as Error).message,
        progress: 100,
        error: (err as Error).message,
      }));
    } finally {
      setIsConnectingExisting(false);
    }
  };

  const handleCancelConnection = async () => {
    if (!connectionProgress || isCancellingConnection) return;
    const targetId = connectionProgress.profileId;
    setIsCancellingConnection(true);
    try {
      if (targetId && window.flowApi?.cancelConnection) {
        await window.flowApi.cancelConnection(targetId);
      }
    } catch (err) {
      console.warn('Failed to cancel connection', err);
    } finally {
      setIsCancellingConnection(false);
      setConnectionProgress(null);
      await loadProfiles(true);
    }
  };

  const handleConnectionReopenChrome = async () => {
    if (!connectionProgress?.profileId || !window.flowApi?.launchLoginBrowser) return;
    try {
      await window.flowApi.launchLoginBrowser(connectionProgress.profileId);
    } catch (err) {
      console.warn('Failed to re-open Chrome', err);
    }
  };

  const handleConnectionManualVerify = async () => {
    if (!connectionProgress?.profileId || !window.flowApi?.verifyAccount) return;
    try {
      setConnectionProgress((prev) =>
        prev ? { ...prev, message: 'Checking Google Flow authentication state…' } : null
      );
      const res = await window.flowApi.verifyAccount(connectionProgress.profileId);
      if (res.success && res.status === 'ready') {
        setConnectionProgress((prev) => ({
          profileId: prev?.profileId || '',
          stage: 'success',
          message: 'Connected successfully ✓',
          progress: 100,
          displayName: prev?.displayName,
          detectedEmail: res.detectedEmail,
        }));
        await loadProfiles(true);
        setTimeout(() => setConnectionProgress(null), 700);
      } else {
        setConnectionProgress((prev) =>
          prev
            ? {
                ...prev,
                message: res.error || 'Not signed in yet. Complete sign-in in the open Chrome window.',
              }
            : null
        );
      }
    } catch (err) {
      setConnectionProgress((prev) =>
        prev ? { ...prev, message: `Check failed: ${(err as Error).message}` } : null
      );
    }
  };

  // ---- Render ----

  const isStopped = (p: ProfileSessionSnapshot) =>
    p.status === 'stopped' || p.status === 'created' || p.status === 'error' || p.status === 'connection_error';

  const isBrowserRunning = (p: ProfileSessionSnapshot) =>
    p.status === 'browser_open' ||
    p.status === 'chrome_launched' ||
    p.status === 'waiting_for_cdp' ||
    p.status === 'connecting' ||
    p.status === 'creating_page' ||
    p.status === 'connected' ||
    p.status === 'auth_required' ||
    p.status === 'reconnecting' ||
    p.status === 'ready' ||
    p.status === 'busy';

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Flow Accounts</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh"
            aria-label="Refresh accounts"
          >
            <RefreshIcon size={14} className={isRefreshing ? 'spin' : undefined} />
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
          {/* Smart Bulk Action Bar */}
          <div
            data-testid="bulk-action-bar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md, 10px)',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  data-testid="select-all-checkbox"
                  checked={selectedProfileIds.size === profiles.length && profiles.length > 0}
                  onChange={handleSelectAll}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                />
                Select All
              </label>

              {selectedProfileIds.size > 0 && (
                <span
                  data-testid="selected-count-badge"
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--primary)',
                    backgroundColor: 'rgba(99, 102, 241, 0.10)',
                    padding: '3px 10px',
                    borderRadius: '12px',
                  }}
                >
                  {selectedProfileIds.size} of {profiles.length} selected
                </span>
              )}

              {selectedProfileIds.size > 0 && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={handleClearSelection}
                  style={{ fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px' }}
                >
                  Clear
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {bulkFeedback && (
                <span
                  data-testid="bulk-feedback-msg"
                  style={{ fontSize: '12.5px', color: 'var(--text-secondary)', fontWeight: 500 }}
                >
                  {bulkFeedback}
                </span>
              )}

              {selectedProfileIds.size > 0 && (
                <button
                  type="button"
                  data-testid="verify-selected-btn"
                  className="btn-secondary btn-sm"
                  onClick={handleVerifySelected}
                  disabled={isBulkVerifying}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 600,
                  }}
                >
                  <CheckIcon size={14} />
                  {isBulkVerifying ? 'Verifying...' : 'Verify Selected'}
                </button>
              )}
            </div>
          </div>

          {profiles.map((p) => {
            const statusInfo = getStatusInfo(p);
            const feedback = actionFeedback[p.profileId];
            const busy = actionLoading[p.profileId];
            const isChecking = Boolean(busy || p.isVerifying || p.status === 'starting');
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
                  {/* Left: Checkbox + Avatar + Account info */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      data-testid={`select-profile-${p.profileId}`}
                      checked={selectedProfileIds.has(p.profileId)}
                      onChange={() => handleToggleSelect(p.profileId)}
                      style={{
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        accentColor: 'var(--primary)',
                        marginTop: '11px',
                        marginRight: '2px',
                      }}
                      aria-label={`Select ${p.displayName}`}
                    />
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
                          {p.status === 'ready' || p.status === 'busy'
                            ? 'Background (Managed)'
                            : (p.connectionMode === 'existing_chrome' ? 'Imported Chrome Profile' : 'Dedicated Profile')}
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
                    {/* Reconnect action: when auth_required */}
                    {p.status === 'auth_required' && (
                      <button
                        className="btn-primary btn-sm"
                        data-testid={`reconnect-btn-${p.profileId}`}
                        onClick={() => handleLaunchLoginBrowser(p.profileId)}
                        disabled={busy}
                        title="Reconnect Google account in dedicated Chrome window"
                      >
                        <ExternalLinkIcon size={12} />
                        Reconnect
                      </button>
                    )}

                    {/* Open Login: when stopped or browser open (and not auth_required) */}
                    {(stopped || p.status === 'browser_open') && p.status !== 'auth_required' && (
                      <button
                        className="btn-primary btn-sm"
                        data-testid={`open-login-btn-${p.profileId}`}
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
                        data-testid={`open-flow-btn-${p.profileId}`}
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
                      data-testid={`verify-btn-${p.profileId}`}
                      aria-label="Verify Account"
                      onClick={() => handleVerifyAccount(p.profileId)}
                      disabled={isChecking}
                      title="Check if signed into Google Flow"
                    >
                      <CheckIcon size={12} />
                      {isChecking ? 'Verifying…' : 'Verify'}
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
      {/* Add Flow Account — Choice Modal                                     */}
      {/* ================================================================== */}
      {isAddChoiceModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddChoiceModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: '0', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '20px 24px 16px 24px', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Add Flow Account</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Choose how you'd like to connect your account.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setIsAddChoiceModalOpen(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px 24px' }}>
              {/* Card 1 — Connect Existing Profile */}
              <button
                type="button"
                data-testid="choice-connect-existing"
                onClick={handleOpenConnectExistingModal}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px 18px',
                  borderRadius: 'var(--radius-md, 10px)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease',
                  boxShadow: 'var(--shadow-sm)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.12)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(99, 102, 241, 0.12)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <UsersIcon size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Connect Existing Profile
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Use a Chrome profile that's already signed in.
                  </div>
                </div>
                <ArrowRightIcon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>

              {/* Card 2 — Add New Account */}
              <button
                type="button"
                data-testid="choice-google-signin"
                onClick={handleSignInWithGoogle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px 18px',
                  borderRadius: 'var(--radius-md, 10px)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease',
                  boxShadow: 'var(--shadow-sm)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.12)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    color: '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <PlusIcon size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Add New Account
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Sign in with a new Google account using a dedicated Infinity Flow profile.
                  </div>
                </div>
                <ArrowRightIcon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            </div>

            <div className="modal-footer" style={{ padding: '12px 24px 16px 24px', borderTop: '1px solid var(--border-color)', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsAddChoiceModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
      {/* Event-Driven Live Connection Progress Modal                        */}
      {/* ================================================================== */}
      {connectionProgress && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (connectionProgress.stage === 'success' || connectionProgress.stage === 'error') {
              setConnectionProgress(null);
            }
          }}
        >
          <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Connect Existing Chrome Profile</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleCancelConnection}
                disabled={isCancellingConnection}
                title="Cancel connection"
              >
                &times;
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Progress Bar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>{connectionProgress.displayName || 'Connecting Profile'}</span>
                  <span>{Math.round(connectionProgress.progress)}%</span>
                </div>
                <div
                  style={{
                    height: '6px',
                    width: '100%',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(5, connectionProgress.progress))}%`,
                      backgroundColor:
                        connectionProgress.stage === 'success'
                          ? '#10b981'
                          : connectionProgress.stage === 'error' || connectionProgress.stage === 'cancelled'
                          ? '#ef4444'
                          : '#6366f1',
                      transition: 'width 0.35s ease',
                      borderRadius: '999px',
                    }}
                  />
                </div>
              </div>

              {/* 5-Stage Checklist */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {CONNECTION_STAGE_STEPS.map((step, idx) => {
                  const state = getStageStepState(idx, connectionProgress);
                  return (
                    <div
                      key={step.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '13px',
                        color:
                          state === 'completed'
                            ? 'var(--text-primary)'
                            : state === 'active'
                            ? '#6366f1'
                            : state === 'error'
                            ? 'var(--danger)'
                            : 'var(--text-muted)',
                        fontWeight: state === 'active' ? 600 : state === 'completed' ? 500 : 400,
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          backgroundColor:
                            state === 'completed'
                              ? '#10b981'
                              : state === 'active'
                              ? '#6366f1'
                              : state === 'error'
                              ? '#ef4444'
                              : 'transparent',
                          color: state === 'pending' ? 'var(--text-muted)' : '#ffffff',
                          border: state === 'pending' ? '1.5px solid var(--border-color)' : 'none',
                          flexShrink: 0,
                        }}
                      >
                        {state === 'completed' ? '✓' : state === 'active' ? '●' : state === 'error' ? '✕' : idx + 1}
                      </div>
                      <span style={{ flex: 1 }}>{step.label}</span>
                      {state === 'active' && (
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>In progress...</span>
                      )}
                      {state === 'completed' && (
                        <span style={{ fontSize: '11px', color: '#10b981' }}>Done</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Status Details / Banners */}
              {connectionProgress.stage === 'success' && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#10b981',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <span style={{ fontSize: '18px' }}>✅</span>
                  <div>
                    <strong style={{ display: 'block' }}>Connected successfully ✓</strong>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {connectionProgress.detectedEmail
                        ? `Authenticated as ${connectionProgress.detectedEmail}`
                        : 'Profile authenticated and ready for generations.'}
                    </span>
                  </div>
                </div>
              )}

              {(connectionProgress.stage === 'auth_required' || connectionProgress.stage === 'waiting_for_user') && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    fontSize: '12.5px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    <span>🌐</span>
                    <span>Google Sign-In Required</span>
                  </div>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    A dedicated Chrome window has opened. Please sign in to your Google Account.
                    Infinity Flow will automatically detect your login and complete setup.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handleConnectionReopenChrome}
                    >
                      Re-open Chrome
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={handleConnectionManualVerify}
                    >
                      Verify & Complete
                    </button>
                  </div>
                </div>
              )}

              {(connectionProgress.stage === 'error' || connectionProgress.stage === 'cancelled') && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: 'var(--danger)',
                    fontSize: '12.5px',
                  }}
                >
                  <strong>Connection {connectionProgress.stage === 'cancelled' ? 'Cancelled' : 'Failed'}:</strong>{' '}
                  {connectionProgress.error || connectionProgress.message}
                </div>
              )}

              {connectionProgress.stage !== 'success' &&
                connectionProgress.stage !== 'auth_required' &&
                connectionProgress.stage !== 'waiting_for_user' &&
                connectionProgress.stage !== 'error' &&
                connectionProgress.stage !== 'cancelled' && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12.5px',
                      color: 'var(--text-secondary)',
                      padding: '8px 12px',
                    }}
                  >
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#6366f1' }} />
                    <span>{connectionProgress.message}</span>
                  </div>
                )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              {connectionProgress.stage === 'success' ? (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setConnectionProgress(null)}
                >
                  Done
                </button>
              ) : connectionProgress.stage === 'error' || connectionProgress.stage === 'cancelled' ? (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setConnectionProgress(null)}
                >
                  Close
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCancelConnection}
                  disabled={isCancellingConnection}
                >
                  {isCancellingConnection ? 'Cancelling...' : 'Cancel'}
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
