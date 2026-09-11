import React, { useState, useEffect, useMemo } from 'react';
import type {
  ProjectEntity,
  ChannelEntity,
  DeliveryHistoryRecord,
} from '../../shared/types';
import {
  PlusIcon,
  FolderIcon,
  TrashIcon,
  PlayIcon,
  TvIcon,
  AlertCircleIcon,
  CheckCircleIcon,
} from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';
import { ChannelModal } from '../components/ChannelModal';

interface ProjectsScreenProps {
  onOpenProject: (projectId: string) => void;
  onNavigateNewProject: () => void;
  initialTab?: 'projects' | 'channels';
  onNavigateVideoFactory?: (channelId?: string) => void;
}

export const ProjectsScreen: React.FC<ProjectsScreenProps> = ({
  onOpenProject,
  onNavigateNewProject,
  initialTab = 'projects',
  onNavigateVideoFactory,
}) => {
  const [projects, setProjects] = useState<ProjectEntity[]>([]);
  const [channels, setChannels] = useState<ChannelEntity[]>([]);
  const [activeTab, setActiveTab] = useState<'projects' | 'channels'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Filter & Batch selection
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [projectToDelete, setProjectToDelete] = useState<ProjectEntity | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);

  // Channel details & modals
  const [activeChannelDetail, setActiveChannelDetail] = useState<ChannelEntity | null>(null);
  const [channelDetailOrientation, setChannelDetailOrientation] = useState<'all' | 'shorts' | 'longs'>('all');
  const [channelHistory, setChannelHistory] = useState<DeliveryHistoryRecord[]>([]);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelEntity | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<ChannelEntity | null>(null);
  const [deliveringProjectId, setDeliveringProjectId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; isError?: boolean } | null>(null);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const loadData = async (silent = false) => {
    try {
      if (!silent && projects.length === 0 && channels.length === 0) {
        setLoading(true);
      }
      if (window.flowApi) {
        const [projList, chList] = await Promise.all([
          window.flowApi.listProjects ? window.flowApi.listProjects() : Promise.resolve([]),
          window.flowApi.listChannels ? window.flowApi.listChannels() : Promise.resolve([]),
        ]);
        setProjects(projList || []);
        setChannels(chList || []);
      }
    } catch (err) {
      console.error('Failed to load projects and channels', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(false);
  }, []);

  // Load channel delivery history when activeChannelDetail changes
  useEffect(() => {
    if (activeChannelDetail && window.flowApi?.getChannelHistory) {
      window.flowApi
        .getChannelHistory({ channelId: activeChannelDetail.id, limit: 10 })
        .then((res) => {
          setChannelHistory(res?.records || []);
        })
        .catch((err) => {
          console.error('Failed to load channel history', err);
        });
    } else {
      setChannelHistory([]);
    }
  }, [activeChannelDetail]);

  const unsortedProjectsCount = useMemo(() => {
    return projects.filter((p) => !p.channelId).length;
  }, [projects]);

  const totalAssignedProjects = useMemo(() => {
    return projects.filter((p) => Boolean(p.channelId)).length;
  }, [projects]);

  const totalDelivered = useMemo(() => {
    return channels.reduce((acc, c) => acc + (c.stats?.deliveredVideos || 0), 0);
  }, [channels]);

  // Orientation helpers
  const isShorts = (p: ProjectEntity) => {
    const r = (p.settings as any)?.videoRatio || (p.settings as any)?.aspectRatio || (p.settings as any)?.imageRatio;
    if (r === '9:16' || r === 'portrait' || r === 'vertical') return true;
    if ((p.settings as any)?.generationMode?.toLowerCase().includes('portrait') || (p.settings as any)?.generationMode?.toLowerCase().includes('shorts')) return true;
    return false;
  };

  const isLongs = (p: ProjectEntity) => {
    const r = (p.settings as any)?.videoRatio || (p.settings as any)?.aspectRatio || (p.settings as any)?.imageRatio;
    if (r === '16:9' || r === 'landscape' || r === 'horizontal' || r === 'widescreen') return true;
    return !isShorts(p);
  };

  // Assign project to channel
  const handleAssignProject = async (projectId: string, channelId: string) => {
    if (!window.flowApi?.assignProjectToChannel) return;
    try {
      const targetChannelId = (channelId === 'none' || channelId === '') ? undefined : channelId;
      await window.flowApi.assignProjectToChannel(projectId, targetChannelId);
      await loadData(true);
      const chName = channels.find((c) => c.id === targetChannelId)?.name;
      setNotification({
        message: targetChannelId
          ? `Project moved to channel "${chName || targetChannelId}".`
          : 'Project unassigned from channel (moved to Unsorted).',
      });
    } catch (err: any) {
      setNotification({
        message: `Failed to assign project: ${err.message || err}`,
        isError: true,
      });
    }
  };

  // Deliver project to channel
  const handleDeliverProject = async (projectId: string, channelId?: string) => {
    if (!window.flowApi?.deliverProjectToChannel) return;
    setDeliveringProjectId(projectId);
    setNotification(null);
    try {
      const result = await window.flowApi.deliverProjectToChannel(projectId, channelId);
      setNotification({
        message: `Delivered to ${result.channelName}: ${result.deliveredVideoPath}`,
      });
      await loadData(true);
      if (activeChannelDetail && window.flowApi?.getChannelHistory) {
        const hist = await window.flowApi.getChannelHistory({ channelId: activeChannelDetail.id, limit: 10 });
        setChannelHistory(hist?.records || []);
      }
    } catch (err: any) {
      setNotification({
        message: `Delivery failed: ${err.message || err}`,
        isError: true,
      });
    } finally {
      setDeliveringProjectId(null);
    }
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    if (!window.flowApi?.retryDelivery) return;
    try {
      const result = await window.flowApi.retryDelivery(deliveryId);
      setNotification({
        message: `Retry successful for ${result.projectName}!`,
      });
      await loadData(true);
      if (activeChannelDetail && window.flowApi?.getChannelHistory) {
        const hist = await window.flowApi.getChannelHistory({ channelId: activeChannelDetail.id, limit: 10 });
        setChannelHistory(hist?.records || []);
      }
    } catch (err: any) {
      setNotification({
        message: `Retry failed: ${err.message || err}`,
        isError: true,
      });
    }
  };

  const handleReveal = (filePath: string) => {
    if (window.flowApi?.revealAsset) {
      window.flowApi.revealAsset(filePath);
    }
  };

  // Projects Delete handlers
  const handleDeleteConfirm = async () => {
    if (!projectToDelete || !window.flowApi) return;
    try {
      await window.flowApi.deleteProject(projectToDelete.projectId);
      setSelectedProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(projectToDelete.projectId);
        return next;
      });
      setProjectToDelete(null);
      await loadData(true);
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  const handleBatchDeleteConfirm = async () => {
    if (selectedProjectIds.size === 0 || !window.flowApi) return;
    try {
      const ids = Array.from(selectedProjectIds);
      if (window.flowApi.deleteProjects) {
        await window.flowApi.deleteProjects(ids);
      } else {
        for (const id of ids) {
          await window.flowApi.deleteProject(id).catch(() => {});
        }
      }
      setSelectedProjectIds(new Set());
      setShowBatchDeleteModal(false);
      await loadData(true);
    } catch (err) {
      console.error('Failed to batch delete projects', err);
    }
  };

  // Channel CRUD handlers
  const handleOpenCreateChannel = () => {
    setEditingChannel(null);
    setIsChannelModalOpen(true);
  };

  const handleOpenEditChannel = (ch: ChannelEntity) => {
    setEditingChannel(ch);
    setIsChannelModalOpen(true);
  };

  const handleChannelSaved = async (saved: ChannelEntity) => {
    setIsChannelModalOpen(false);
    setEditingChannel(null);
    setNotification({
      message: `Channel "${saved.name}" saved successfully.`,
    });
    await loadData(true);
    if (activeChannelDetail?.id === saved.id) {
      setActiveChannelDetail(saved);
    }
  };

  const handleDeleteChannelConfirm = async () => {
    if (!channelToDelete || !window.flowApi?.deleteChannel) return;
    try {
      const res = await window.flowApi.deleteChannel(channelToDelete.id);
      if (activeChannelDetail?.id === channelToDelete.id) {
        setActiveChannelDetail(null);
      }
      setChannelToDelete(null);
      setNotification({
        message: `Channel deleted safely. ${res.unassignedProjects} associated projects preserved and moved to Unsorted.`,
      });
      await loadData(true);
    } catch (err: any) {
      setNotification({
        message: `Failed to delete channel: ${err.message || err}`,
        isError: true,
      });
    }
  };

  // Filtered Projects for Projects Tab
  const filteredProjects = useMemo(() => {
    let result = projects;
    if (selectedChannelFilter === 'unsorted') {
      result = result.filter((p) => !p.channelId);
    } else if (selectedChannelFilter !== 'all') {
      result = result.filter((p) => p.channelId === selectedChannelFilter);
    }

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.campaignTag && p.campaignTag.toLowerCase().includes(q)) ||
          (p.channelName && p.channelName.toLowerCase().includes(q))
      );
    }
    return result;
  }, [projects, selectedChannelFilter, searchQuery]);

  // Filtered Channels for Channels Tab
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase().trim();
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.rulebook?.tone && c.rulebook.tone.toLowerCase().includes(q))
    );
  }, [channels, searchQuery]);

  // Filtered Projects for Channel Detail View
  const channelDetailProjects = useMemo(() => {
    if (!activeChannelDetail) return [];
    let list = projects.filter((p) => p.channelId === activeChannelDetail.id);
    if (channelDetailOrientation === 'shorts') {
      list = list.filter(isShorts);
    } else if (channelDetailOrientation === 'longs') {
      list = list.filter(isLongs);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.campaignTag && p.campaignTag.toLowerCase().includes(q))
      );
    }
    return list;
  }, [projects, activeChannelDetail, channelDetailOrientation, searchQuery]);

  const allFilteredSelected =
    filteredProjects.length > 0 &&
    filteredProjects.every((p) => selectedProjectIds.has(p.projectId));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedProjectIds((prev) => {
        const next = new Set(prev);
        filteredProjects.forEach((p) => next.delete(p.projectId));
        return next;
      });
    } else {
      setSelectedProjectIds((prev) => {
        const next = new Set(prev);
        filteredProjects.forEach((p) => next.add(p.projectId));
        return next;
      });
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      {/* Banner Notification */}
      {notification && (
        <div
          data-testid="projects-banner-notification"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderRadius: '8px',
            backgroundColor: notification.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
            border: `1px solid ${notification.isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
            color: notification.isError ? '#f87171' : '#4ade80',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {notification.isError ? <AlertCircleIcon size={16} /> : <CheckCircleIcon size={16} />}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Projects</h1>
          <p style={{ marginTop: '4px' }}>
            Manage projects, generation status, history, and channel organization
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {activeTab === 'projects' && selectedProjectIds.size > 0 && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => setShowBatchDeleteModal(true)}
              style={{
                borderColor: 'var(--danger)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <TrashIcon size={14} />
              Delete {selectedProjectIds.size} Selected
            </button>
          )}

          {activeTab === 'projects' ? (
            <button className="btn-primary" onClick={onNavigateNewProject}>
              <PlusIcon size={16} />
              New Project
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-primary" onClick={handleOpenCreateChannel}>
                <PlusIcon size={16} />
                New Channel
              </button>
              {onNavigateVideoFactory && (
                <button
                  className="btn-secondary"
                  onClick={() => onNavigateVideoFactory(activeChannelDetail?.id)}
                  title="Create video in Video Factory"
                >
                  Create Video
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top View Switcher Tabs (Projects vs Channels) */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
        <button
          data-testid="tab-projects"
          className={`btn-sm ${activeTab === 'projects' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setActiveTab('projects');
            setActiveChannelDetail(null);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FolderIcon size={15} />
          Projects ({projects.length})
        </button>
        <button
          data-testid="tab-channels"
          className={`btn-sm ${activeTab === 'channels' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('channels')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <TvIcon size={15} />
          Channels ({channels.length})
        </button>
      </div>

      {/* ================================================================ */}
      {/* TAB 1: PROJECTS VIEW                                             */}
      {/* ================================================================ */}
      {activeTab === 'projects' && (
        <>
          {/* Search and Channel filter toolbar */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, maxWidth: '640px' }}>
              <input
                type="search"
                placeholder="Search projects by name, tag, or channel..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, minWidth: '220px' }}
              />
              {/* Channel Filter Selector */}
              <select
                data-testid="channel-filter-select"
                value={selectedChannelFilter}
                onChange={(e) => setSelectedChannelFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  minWidth: '170px',
                }}
              >
                <option value="all">All Channels ({projects.length})</option>
                <option value="unsorted">Unsorted ({unsortedProjectsCount})</option>
                {channels.map((c) => {
                  const count = projects.filter((p) => p.channelId === c.id).length;
                  return (
                    <option key={c.id} value={c.id}>
                      📺 {c.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {filteredProjects.length > 0 && (
              <button
                className="btn-secondary btn-sm"
                onClick={toggleSelectAll}
                style={{ fontSize: '12px' }}
              >
                {allFilteredSelected ? 'Deselect All' : `Select All (${filteredProjects.length})`}
              </button>
            )}
          </div>

          {/* Projects List or Empty State */}
          {loading && projects.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
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
              <FolderIcon size={36} style={{ color: 'var(--text-muted)' }} />
              <h3>
                {searchQuery || selectedChannelFilter !== 'all'
                  ? 'No matching projects found'
                  : 'No projects yet'}
              </h3>
              <p style={{ maxWidth: '420px' }}>
                {searchQuery || selectedChannelFilter !== 'all'
                  ? 'Try changing your search terms or channel filter.'
                  : 'Create your first project to begin batch video and image generation across Google Flow and Gemini.'}
              </p>
              {!searchQuery && selectedChannelFilter === 'all' && (
                <button className="btn-primary" onClick={onNavigateNewProject} style={{ marginTop: '8px' }}>
                  <PlusIcon size={16} />
                  Create Project
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
              {filteredProjects.map((p) => {
                const total = (p.stats?.totalImages || 0) + (p.stats?.totalVideos || 0);
                const completed = (p.stats?.completedImages || 0) + (p.stats?.completedVideos || 0);
                const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                const updatedDate = new Date(p.updatedAt).toLocaleDateString();
                const assignedChannel = channels.find((c) => c.id === p.channelId);

                return (
                  <div
                    key={p.projectId}
                    data-testid={`project-card-${p.projectId}`}
                    className="card"
                    style={{
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      boxShadow: 'var(--shadow-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-lg)',
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <input
                          type="checkbox"
                          checked={selectedProjectIds.has(p.projectId)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedProjectIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.projectId)) next.delete(p.projectId);
                              else next.add(p.projectId);
                              return next;
                            });
                          }}
                          style={{ cursor: 'pointer', marginTop: '3px', width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                          title="Select project for batch actions"
                        />
                        <div>
                          <h3 style={{ fontSize: '15.5px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
                            {p.name}
                          </h3>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {p.settings?.generationMode && (
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 600,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: p.settings.generationMode.includes('image') ? 'var(--info-image-bg)' : 'var(--info-video-bg)',
                                  color: p.settings.generationMode.includes('image') ? 'var(--info-image)' : 'var(--info-video)',
                                  border: `1px solid ${p.settings.generationMode.includes('image') ? 'var(--info-image-border)' : 'var(--info-video-border)'}`,
                                  textTransform: 'capitalize',
                                }}
                              >
                                {p.settings.generationMode.replace('_', ' ')}
                              </span>
                            )}
                            {p.campaignTag && (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                Tag: {p.campaignTag}
                              </span>
                            )}
                            {assignedChannel ? (
                              <span
                                data-testid={`badge-channel-${p.projectId}`}
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 600,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                  color: '#60a5fa',
                                  border: '1px solid rgba(59, 130, 246, 0.25)',
                                }}
                              >
                                📺 {assignedChannel.name}
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                  color: 'var(--text-muted)',
                                  border: '1px solid var(--border-subtle)',
                                }}
                              >
                                Unsorted
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`badge badge-${p.status === 'completed' ? 'completed' : p.status === 'running' ? 'running' : 'draft'}`}
                      >
                        {p.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
                      <span>{p.stats?.totalImages || 0} images</span>
                      <span>·</span>
                      <span>{p.stats?.totalVideos || 0} videos</span>
                      {p.settings?.videoModel && (
                        <>
                          <span>·</span>
                          <span>{p.settings.videoModel}</span>
                        </>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                        <span>Progress: {completed} / {total} slots</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{percent}%</span>
                      </div>
                      <div style={{ height: '6px', backgroundColor: 'var(--bg-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${percent}%`,
                            height: '100%',
                            backgroundColor: p.status === 'completed' ? 'var(--success)' : 'var(--primary)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>

                    {/* Move to Channel & Quick Deliver row */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(0,0,0,0.12)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Channel:</span>
                        <select
                          data-testid={`move-channel-select-${p.projectId}`}
                          value={p.channelId || 'none'}
                          onChange={(e) => handleAssignProject(p.projectId, e.target.value)}
                          style={{
                            padding: '3px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            maxWidth: '150px',
                          }}
                          title="Assign or move project to channel"
                        >
                          <option value="none">Unsorted</option>
                          {channels.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {p.channelId && (p.status === 'completed' || completed > 0) && (
                        <button
                          data-testid={`btn-deliver-${p.projectId}`}
                          className="btn-secondary btn-sm"
                          onClick={() => handleDeliverProject(p.projectId, p.channelId)}
                          disabled={deliveringProjectId === p.projectId}
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          title="Deliver completed video to channel destination directory"
                        >
                          {deliveringProjectId === p.projectId ? 'Delivering...' : 'Deliver'}
                        </button>
                      )}
                    </div>

                    {/* Card Footer actions */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Modified: {updatedDate}
                      </span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() => setProjectToDelete(p)}
                          title="Delete project"
                        >
                          <TrashIcon size={12} />
                          Delete
                        </button>
                        <button
                          className="btn-primary btn-sm"
                          onClick={() => onOpenProject(p.projectId)}
                        >
                          <PlayIcon size={12} />
                          Open
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ================================================================ */}
      {/* TAB 2: CHANNELS VIEW (ZBot §4 Channel Organization)              */}
      {/* ================================================================ */}
      {activeTab === 'channels' && (
        <>
          {/* Sub-view A: Channel Detail View */}
          {activeChannelDetail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Breadcrumb bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    data-testid="btn-back-to-channels"
                    className="btn-secondary btn-sm"
                    onClick={() => setActiveChannelDetail(null)}
                  >
                    ← Back to Channels
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TvIcon size={20} style={{ color: '#60a5fa' }} />
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                      {activeChannelDetail.name}
                    </h2>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: activeChannelDetail.enabled ? '#22c55e' : '#ef4444',
                      }}
                      title={activeChannelDetail.enabled ? 'Active' : 'Disabled'}
                    />
                    {activeChannelDetail.rulebook?.tone && (
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          color: '#60a5fa',
                          border: '1px solid rgba(59, 130, 246, 0.25)',
                        }}
                      >
                        Tone: {activeChannelDetail.rulebook.tone}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => handleOpenEditChannel(activeChannelDetail)}
                  >
                    Edit Channel
                  </button>
                  {onNavigateVideoFactory && (
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => onNavigateVideoFactory(activeChannelDetail.id)}
                    >
                      <PlusIcon size={14} />
                      Create Video in Channel
                    </button>
                  )}
                </div>
              </div>

              {/* Destinations overview card */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '12px',
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  fontSize: '12px',
                }}
              >
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                    📱 Shorts Output (9:16):
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                    {activeChannelDetail.shortsOutputDir || (activeChannelDetail.outputDir ? `${activeChannelDetail.outputDir}/Shorts` : 'Default Shorts folder')}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                    🖥️ Longs Output (16:9):
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                    {activeChannelDetail.longsOutputDir || (activeChannelDetail.outputDir ? `${activeChannelDetail.outputDir}/Longs` : 'Default Longs folder')}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                    📖 Rulebook & Identity:
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    {activeChannelDetail.description || activeChannelDetail.rulebook?.visualStyle || 'Standard configuration'}
                  </div>
                </div>
              </div>

              {/* Orientation Filter Tabs */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    data-testid="tab-orientation-all"
                    className={`btn-sm ${channelDetailOrientation === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setChannelDetailOrientation('all')}
                  >
                    All Projects ({projects.filter((p) => p.channelId === activeChannelDetail.id).length})
                  </button>
                  <button
                    data-testid="tab-orientation-shorts"
                    className={`btn-sm ${channelDetailOrientation === 'shorts' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setChannelDetailOrientation('shorts')}
                  >
                    Shorts (9:16) ({projects.filter((p) => p.channelId === activeChannelDetail.id && isShorts(p)).length})
                  </button>
                  <button
                    data-testid="tab-orientation-longs"
                    className={`btn-sm ${channelDetailOrientation === 'longs' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setChannelDetailOrientation('longs')}
                  >
                    Longs (16:9) ({projects.filter((p) => p.channelId === activeChannelDetail.id && isLongs(p)).length})
                  </button>
                </div>

                <input
                  type="search"
                  placeholder="Search channel projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ maxWidth: '280px', padding: '6px 12px', fontSize: '12px' }}
                />
              </div>

              {/* Projects belonging to this channel */}
              {channelDetailProjects.length === 0 ? (
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px dashed var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '40px 20px',
                    textAlign: 'center',
                  }}
                >
                  <FolderIcon size={32} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
                  <h4>No projects in this view</h4>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Create a new video project or assign existing projects to "{activeChannelDetail.name}".
                  </p>
                  {onNavigateVideoFactory && (
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => onNavigateVideoFactory(activeChannelDetail.id)}
                      style={{ marginTop: '12px' }}
                    >
                      <PlusIcon size={14} />
                      Create Video for {activeChannelDetail.name}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
                  {channelDetailProjects.map((p) => {
                    const total = (p.stats?.totalImages || 0) + (p.stats?.totalVideos || 0);
                    const completed = (p.stats?.completedImages || 0) + (p.stats?.completedVideos || 0);
                    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

                    return (
                      <div
                        key={p.projectId}
                        className="card"
                        style={{
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-lg)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{p.name}</h4>
                            <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: isShorts(p) ? 'rgba(236, 72, 153, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                  color: isShorts(p) ? '#f472b6' : '#60a5fa',
                                  fontWeight: 600,
                                }}
                              >
                                {isShorts(p) ? 'Shorts 9:16' : 'Longs 16:9'}
                              </span>
                              {p.campaignTag && (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  {p.campaignTag}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={`badge badge-${p.status === 'completed' ? 'completed' : p.status === 'running' ? 'running' : 'draft'}`}>
                            {p.status}
                          </span>
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                            <span>Progress: {completed}/{total} slots</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{percent}%</span>
                          </div>
                          <div style={{ height: '4px', backgroundColor: 'var(--bg-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${percent}%`, height: '100%', backgroundColor: p.status === 'completed' ? 'var(--success)' : 'var(--primary)' }} />
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                          <button
                            data-testid={`btn-channel-detail-deliver-${p.projectId}`}
                            className="btn-secondary btn-sm"
                            onClick={() => handleDeliverProject(p.projectId, activeChannelDetail.id)}
                            disabled={deliveringProjectId === p.projectId}
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                          >
                            {deliveringProjectId === p.projectId ? 'Delivering...' : 'Deliver to Channel'}
                          </button>

                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="btn-secondary btn-sm"
                              onClick={() => setProjectToDelete(p)}
                              title="Delete project"
                            >
                              <TrashIcon size={12} />
                            </button>
                            <button
                              className="btn-primary btn-sm"
                              onClick={() => onOpenProject(p.projectId)}
                            >
                              <PlayIcon size={12} />
                              Open
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Channel Delivery History section */}
              {channelHistory.length > 0 && (
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Recent Deliveries ({channelHistory.length})
                  </h4>
                  <div
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-surface)',
                      overflow: 'hidden',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.2)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 12px' }}>Status</th>
                          <th style={{ padding: '8px 12px' }}>Project</th>
                          <th style={{ padding: '8px 12px' }}>Delivered Path</th>
                          <th style={{ padding: '8px 12px' }}>Time</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {channelHistory.map((rec) => (
                          <tr key={rec.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: rec.status === 'delivered' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  color: rec.status === 'delivered' ? '#4ade80' : '#f87171',
                                  fontWeight: 600,
                                }}
                              >
                                {rec.status}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', fontWeight: 500 }}>{rec.projectName}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                              {rec.deliveredVideoPath}
                            </td>
                            <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                              {new Date(rec.deliveredAt).toLocaleTimeString()}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                {rec.status === 'delivered' ? (
                                  <button
                                    className="btn-secondary btn-sm"
                                    onClick={() => handleReveal(rec.deliveredVideoPath)}
                                    style={{ fontSize: '10.5px', padding: '2px 6px' }}
                                  >
                                    Reveal
                                  </button>
                                ) : (
                                  <button
                                    className="btn-secondary btn-sm"
                                    onClick={() => handleRetryDelivery(rec.id)}
                                    style={{ fontSize: '10.5px', padding: '2px 6px' }}
                                  >
                                    Retry
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Sub-view B: Channels Overview Grid */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Quick Metrics Bar */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                      Active Channels
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '2px' }}>
                      {channels.length}
                    </div>
                  </div>
                  <TvIcon size={20} style={{ color: '#60a5fa', opacity: 0.8 }} />
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                      Assigned Projects
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '2px' }}>
                      {totalAssignedProjects}
                    </div>
                  </div>
                  <FolderIcon size={20} style={{ color: '#a78bfa', opacity: 0.8 }} />
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                      Delivered Videos
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '2px' }}>
                      {totalDelivered}
                    </div>
                  </div>
                  <CheckCircleIcon size={20} style={{ color: '#4ade80', opacity: 0.8 }} />
                </div>
              </div>

              {/* Channels Search */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <input
                  type="search"
                  placeholder="Search channels by name, tone, or rulebook..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ maxWidth: '380px' }}
                />
              </div>

              {/* Channel Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                {/* 1. New Channel Action Card */}
                <div
                  onClick={handleOpenCreateChannel}
                  data-testid="create-new-channel-card"
                  style={{
                    border: '2px dashed var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    minHeight: '220px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    gap: '12px',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--primary)',
                    }}
                  >
                    <PlusIcon size={22} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>+ New Channel</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Configure channel identity, rulebook, and output directories
                    </div>
                  </div>
                </div>

                {/* 2. Unsorted Projects Card */}
                <div
                  data-testid="unsorted-projects-card"
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: 'var(--bg-surface)',
                    gap: '14px',
                    boxShadow: 'var(--shadow-sm)',
                    minHeight: '220px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FolderIcon size={18} style={{ color: 'var(--text-muted)' }} />
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Unsorted Projects</h3>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Projects without an assigned channel
                      </div>
                    </div>
                    <span className="badge badge-draft">{unsortedProjectsCount}</span>
                  </div>

                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, flex: 1 }}>
                    Projects created directly or unassigned. Move them to channels to apply brand rulebooks and automated export destinations.
                  </p>

                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', marginTop: 'auto' }}>
                    <button
                      data-testid="btn-view-unsorted"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setSelectedChannelFilter('unsorted');
                        setActiveTab('projects');
                      }}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      View Unsorted ({unsortedProjectsCount})
                    </button>
                  </div>
                </div>

                {/* 3. Existing Channel Cards */}
                {filteredChannels.map((channel) => {
                  const channelProjects = projects.filter((p) => p.channelId === channel.id);
                  const shortsPath = channel.shortsOutputDir || (channel.outputDir ? `${channel.outputDir}/Shorts` : 'Default Shorts');
                  const longsPath = channel.longsOutputDir || (channel.outputDir ? `${channel.outputDir}/Longs` : 'Default Longs');

                  return (
                    <div
                      key={channel.id}
                      data-testid={`channel-card-${channel.id}`}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: 'var(--bg-surface)',
                        gap: '12px',
                        boxShadow: 'var(--shadow-sm)',
                        minHeight: '220px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TvIcon size={18} style={{ color: '#60a5fa' }} />
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{channel.name}</h3>
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: channel.enabled ? '#22c55e' : '#ef4444',
                              }}
                              title={channel.enabled ? 'Active' : 'Disabled'}
                            />
                          </div>
                          {channel.description && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', maxHeight: '36px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {channel.description}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            data-testid={`btn-edit-channel-${channel.id}`}
                            className="btn-secondary btn-sm"
                            onClick={() => handleOpenEditChannel(channel)}
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                            title="Edit Channel"
                          >
                            Edit
                          </button>
                          <button
                            data-testid={`btn-delete-channel-${channel.id}`}
                            className="btn-secondary btn-sm"
                            onClick={() => setChannelToDelete(channel)}
                            style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--danger)' }}
                            title="Delete Channel"
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            color: '#60a5fa',
                            border: '1px solid rgba(59, 130, 246, 0.25)',
                          }}
                        >
                          Tone: {channel.rulebook?.tone || 'Default'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {channelProjects.length} Projects · {channel.stats?.deliveredVideos || 0} Delivered
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          backgroundColor: 'rgba(0,0,0,0.15)',
                          padding: '8px 10px',
                          borderRadius: '6px',
                        }}
                      >
                        <div>
                          <strong style={{ color: 'var(--text-secondary)' }}>Shorts (9:16):</strong>{' '}
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{shortsPath}</span>
                        </div>
                        <div>
                          <strong style={{ color: 'var(--text-secondary)' }}>Longs (16:9):</strong>{' '}
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{longsPath}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                        <button
                          data-testid={`btn-view-projects-${channel.id}`}
                          className="btn-secondary btn-sm"
                          onClick={() => setActiveChannelDetail(channel)}
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          View Projects ({channelProjects.length})
                        </button>
                        {onNavigateVideoFactory && (
                          <button
                            data-testid={`btn-create-in-channel-${channel.id}`}
                            className="btn-primary btn-sm"
                            onClick={() => onNavigateVideoFactory(channel.id)}
                            style={{ justifyContent: 'center' }}
                            title="Create Video using this channel's rulebook"
                          >
                            Create Video
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal for Project Deletion */}
      <ConfirmModal
        isOpen={projectToDelete !== null}
        title="Delete Project"
        message={
          projectToDelete?.status === 'running'
            ? `WARNING: "${projectToDelete?.name}" is currently generating! Deleting will cancel all in-flight generation jobs, close active automation tabs, and permanently delete all output media files from disk. Are you sure?`
            : `Are you sure you want to delete "${projectToDelete?.name}"? All associated generated media, thumbnails, and slot records will be permanently deleted from disk.`
        }
        confirmLabel="Delete Project"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setProjectToDelete(null)}
      />

      {/* Confirmation Modal for Batch Project Deletion */}
      <ConfirmModal
        isOpen={showBatchDeleteModal}
        title={`Delete ${selectedProjectIds.size} Projects`}
        message={`Are you sure you want to delete ${selectedProjectIds.size} selected projects? This will cancel any active jobs for these projects and permanently remove all associated generated media files from disk. Flow accounts and browser profiles will remain untouched.`}
        confirmLabel={`Delete ${selectedProjectIds.size} Projects`}
        isDanger={true}
        onConfirm={handleBatchDeleteConfirm}
        onCancel={() => setShowBatchDeleteModal(false)}
      />

      {/* Confirmation Modal for Channel Deletion */}
      <ConfirmModal
        isOpen={channelToDelete !== null}
        title="Delete Channel"
        message={`Are you sure you want to delete channel "${channelToDelete?.name}"? Projects assigned to this channel will NOT be deleted; they will safely be preserved and moved to Unsorted.`}
        confirmLabel="Delete Channel"
        isDanger={true}
        onConfirm={handleDeleteChannelConfirm}
        onCancel={() => setChannelToDelete(null)}
      />

      {/* Channel Create / Edit Modal */}
      {isChannelModalOpen && (
        <ChannelModal
          isOpen={isChannelModalOpen}
          initialChannel={editingChannel}
          onClose={() => {
            setIsChannelModalOpen(false);
            setEditingChannel(null);
          }}
          onSaved={handleChannelSaved}
        />
      )}
    </div>
  );
};
