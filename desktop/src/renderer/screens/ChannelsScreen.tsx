import React, { useState, useEffect, useMemo } from 'react';
import type {
  ChannelEntity,
  ProjectEntity,
  DeliveryHistoryRecord,
} from '../../shared/types';
import {
  PlusIcon,
  FolderIcon,
  TrashIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  TvIcon,
} from '../components/Icons';
import { ChannelModal } from '../components/ChannelModal';
import { ConfirmModal } from '../components/ConfirmModal';

interface ChannelsScreenProps {
  onOpenProject?: (projectId: string) => void;
  onNavigateVideoFactory?: (channelId?: string) => void;
}

export const ChannelsScreen: React.FC<ChannelsScreenProps> = ({
  onOpenProject,
  onNavigateVideoFactory,
}) => {
  const [channels, setChannels] = useState<ChannelEntity[]>([]);
  const [projects, setProjects] = useState<ProjectEntity[]>([]);
  const [historyRecords, setHistoryRecords] = useState<DeliveryHistoryRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'channels' | 'projects' | 'history'>('channels');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelEntity | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<ChannelEntity | null>(null);
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>('all');
  const [deliveringProjectId, setDeliveringProjectId] = useState<string | null>(null);
  const [deliveryNotification, setDeliveryNotification] = useState<{ message: string; isError?: boolean } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      if (window.flowApi) {
        const [chList, projList, histResult] = await Promise.all([
          window.flowApi.listChannels ? window.flowApi.listChannels() : Promise.resolve([]),
          window.flowApi.listProjects ? window.flowApi.listProjects() : Promise.resolve([]),
          window.flowApi.getChannelHistory ? window.flowApi.getChannelHistory({ limit: 100 }) : Promise.resolve({ records: [], total: 0, limit: 100, offset: 0 }),
        ]);
        setChannels(chList || []);
        setProjects(projList || []);
        setHistoryRecords(histResult?.records || []);
      }
    } catch (err) {
      console.error('Failed to load channel data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalDelivered = useMemo(() => {
    return channels.reduce((acc, c) => acc + (c.stats?.deliveredVideos || 0), 0);
  }, [channels]);

  const totalAssignedProjects = useMemo(() => {
    return projects.filter((p) => Boolean(p.channelId)).length;
  }, [projects]);

  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase();
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.rulebook?.tone && c.rulebook.tone.toLowerCase().includes(q))
    );
  }, [channels, searchQuery]);

  const filteredProjects = useMemo(() => {
    let result = projects;
    if (selectedChannelFilter === 'unassigned') {
      result = result.filter((p) => !p.channelId);
    } else if (selectedChannelFilter !== 'all') {
      result = result.filter((p) => p.channelId === selectedChannelFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.channelName && p.channelName.toLowerCase().includes(q))
      );
    }
    return result;
  }, [projects, selectedChannelFilter, searchQuery]);

  const filteredHistory = useMemo(() => {
    let result = historyRecords;
    if (selectedChannelFilter !== 'all' && selectedChannelFilter !== 'unassigned') {
      result = result.filter((r) => r.channelId === selectedChannelFilter);
    }
    if (deliveryStatusFilter !== 'all') {
      result = result.filter((r) => r.status === deliveryStatusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.projectName.toLowerCase().includes(q) ||
          r.channelName.toLowerCase().includes(q) ||
          r.deliveredVideoPath.toLowerCase().includes(q)
      );
    }
    return result;
  }, [historyRecords, selectedChannelFilter, deliveryStatusFilter, searchQuery]);

  const handleOpenCreateModal = () => {
    setEditingChannel(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (ch: ChannelEntity) => {
    setEditingChannel(ch);
    setIsModalOpen(true);
  };

  const handleDeleteChannelConfirm = async () => {
    if (!channelToDelete || !window.flowApi?.deleteChannel) return;
    try {
      const res = await window.flowApi.deleteChannel(channelToDelete.id);
      setChannelToDelete(null);
      setDeliveryNotification({
        message: `Channel deleted safely. ${res.unassignedProjects} associated projects were preserved and unassigned.`,
      });
      await loadData();
    } catch (err: any) {
      setDeliveryNotification({
        message: `Failed to delete channel: ${err.message}`,
        isError: true,
      });
    }
  };

  const handleAssignProject = async (projectId: string, newChannelId: string) => {
    if (!window.flowApi?.assignProjectToChannel) return;
    try {
      await window.flowApi.assignProjectToChannel(
        projectId,
        newChannelId === 'none' ? undefined : newChannelId
      );
      await loadData();
    } catch (err) {
      console.error('Failed to assign project', err);
    }
  };

  const handleDeliverProject = async (projectId: string, channelId?: string) => {
    if (!window.flowApi?.deliverProjectToChannel) return;
    setDeliveringProjectId(projectId);
    setDeliveryNotification(null);
    try {
      const result = await window.flowApi.deliverProjectToChannel(projectId, channelId);
      setDeliveryNotification({
        message: `Delivered to ${result.channelName}: ${result.deliveredVideoPath}`,
      });
      await loadData();
    } catch (err: any) {
      setDeliveryNotification({
        message: `Delivery failed: ${err.message}`,
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
      setDeliveryNotification({
        message: `Retry successful for ${result.projectName}!`,
      });
      await loadData();
    } catch (err: any) {
      setDeliveryNotification({
        message: `Retry failed: ${err.message}`,
        isError: true,
      });
    }
  };

  const handleReveal = (filePath: string) => {
    if (window.flowApi?.revealAsset) {
      window.flowApi.revealAsset(filePath);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '24px 32px' }}>
      {/* Top Banner / Notification */}
      {deliveryNotification && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            marginBottom: '16px',
            borderRadius: '8px',
            backgroundColor: deliveryNotification.isError
              ? 'rgba(239, 68, 68, 0.15)'
              : 'rgba(34, 197, 94, 0.15)',
            border: `1px solid ${deliveryNotification.isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
            color: deliveryNotification.isError ? '#f87171' : '#4ade80',
            fontSize: '13px',
          }}
        >
          <span>{deliveryNotification.message}</span>
          <button
            onClick={() => setDeliveryNotification(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Screen Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <TvIcon size={24} style={{ color: '#3b82f6' }} />
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Channels & Automation
            </h1>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary, #94a3b8)' }}>
            Reusable channel identities, rulebook presets, project assignment, and automated output delivery.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: '13px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
          }}
        >
          <PlusIcon size={16} />
          <span>New Channel</span>
        </button>
      </div>

      {/* Quick Metrics Bar */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
        <div
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-surface, #1e1e24)',
            border: '1px solid var(--border-color, #333)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
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
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-surface, #1e1e24)',
            border: '1px solid var(--border-color, #333)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
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
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-surface, #1e1e24)',
            border: '1px solid var(--border-color, #333)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Total Delivered Videos
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '2px', color: '#4ade80' }}>
              {totalDelivered}
            </div>
          </div>
          <CheckCircleIcon size={20} style={{ color: '#4ade80', opacity: 0.8 }} />
        </div>
      </div>

      {/* Main Tabs and Filter Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-color, #333)',
          paddingBottom: '12px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { id: 'channels', label: `Channels (${channels.length})` },
            { id: 'projects', label: `Projects (${projects.length})` },
            { id: 'history', label: `Delivery History (${historyRecords.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: activeTab === tab.id ? '#2563eb' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'var(--text-secondary, #94a3b8)',
                fontWeight: activeTab === tab.id ? 600 : 500,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Channel Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {activeTab !== 'channels' && (
            <select
              value={selectedChannelFilter}
              onChange={(e) => setSelectedChannelFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #444)',
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: '#fff',
                fontSize: '12px',
              }}
            >
              <option value="all">All Channels</option>
              {activeTab === 'projects' && <option value="unassigned">Unassigned Only</option>}
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {activeTab === 'history' && (
            <select
              value={deliveryStatusFilter}
              onChange={(e) => setDeliveryStatusFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #444)',
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: '#fff',
                fontSize: '12px',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="delivered">Delivered Only</option>
              <option value="failed">Failed Only</option>
            </select>
          )}

          <input
            type="text"
            placeholder="Search channels, titles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #444)',
              backgroundColor: 'rgba(0,0,0,0.3)',
              color: '#fff',
              fontSize: '13px',
              width: '220px',
            }}
          />
        </div>
      </div>

      {/* Screen Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            Loading channels and workflows...
          </div>
        ) : (
          <>
            {/* TAB 1: CHANNELS GRID */}
            {activeTab === 'channels' && (
              <>
                {filteredChannels.length === 0 ? (
                  <div
                    style={{
                      padding: '48px',
                      textAlign: 'center',
                      borderRadius: '12px',
                      border: '1px dashed var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.1)',
                    }}
                  >
                    <TvIcon size={36} style={{ color: '#64748b', marginBottom: '12px' }} />
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0' }}>
                      No channels created yet
                    </div>
                    <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px', maxWidth: '400px', margin: '6px auto 16px' }}>
                      Set up your first channel to define a brand persona, rulebook constraints, and automated video output directories.
                    </div>
                    <button
                      onClick={handleOpenCreateModal}
                      style={{
                        backgroundColor: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Create First Channel
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                      gap: '16px',
                    }}
                  >
                    {filteredChannels.map((channel) => (
                      <div
                        key={channel.id}
                        style={{
                          borderRadius: '12px',
                          border: '1px solid var(--border-color, #333)',
                          backgroundColor: 'var(--bg-surface, #1e1e24)',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                        }}
                      >
                        {/* Channel Header */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                                {channel.name}
                              </h3>
                              {channel.enabled ? (
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }} title="Active" />
                              ) : (
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} title="Disabled" />
                              )}
                            </div>
                            <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                              ID: {channel.id}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => handleOpenEditModal(channel)}
                              style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #444)',
                                backgroundColor: 'rgba(255,255,255,0.06)',
                                color: '#e2e8f0',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setChannelToDelete(channel)}
                              title="Delete Channel"
                              style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                color: '#f87171',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              <TrashIcon size={12} />
                            </button>
                          </div>
                        </div>

                        {channel.description && (
                          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>
                            {channel.description}
                          </div>
                        )}

                        {/* Presets Badges */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              color: '#60a5fa',
                              border: '1px solid rgba(59, 130, 246, 0.2)',
                            }}
                          >
                            Ratio: {channel.defaultAspectRatio || '16:9'}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(168, 85, 247, 0.1)',
                              color: '#c084fc',
                              border: '1px solid rgba(168, 85, 247, 0.2)',
                            }}
                          >
                            Motion: {channel.defaultMotionStyle || 'breathe'}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(20, 184, 166, 0.1)',
                              color: '#2dd4bf',
                              border: '1px solid rgba(20, 184, 166, 0.2)',
                            }}
                          >
                            Trans: {channel.defaultTransitionStyle || 'hard_cut'}
                          </span>
                        </div>

                        {/* Rulebook Preview */}
                        {channel.rulebook && (
                          <div
                            style={{
                              fontSize: '11px',
                              backgroundColor: 'rgba(0,0,0,0.25)',
                              borderRadius: '6px',
                              padding: '8px',
                              border: '1px solid rgba(255,255,255,0.05)',
                              color: '#cbd5e1',
                            }}
                          >
                            {channel.rulebook.narrationStyle && (
                              <div style={{ marginBottom: '2px' }}>
                                <strong>Narration:</strong> {channel.rulebook.narrationStyle}
                              </div>
                            )}
                            {channel.rulebook.tone && (
                              <div>
                                <strong>Tone:</strong> {channel.rulebook.tone}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Channel Stats Footer */}
                        <div
                          style={{
                            marginTop: 'auto',
                            paddingTop: '8px',
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '11px',
                            color: '#94a3b8',
                          }}
                        >
                          <div>
                            Projects: <strong>{channel.stats?.totalProjects || 0}</strong>
                          </div>
                          <div>
                            Delivered: <strong style={{ color: '#4ade80' }}>{channel.stats?.deliveredVideos || 0}</strong>
                          </div>
                          {onNavigateVideoFactory && (
                            <button
                              onClick={() => onNavigateVideoFactory(channel.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '4px',
                                border: 'none',
                                backgroundColor: '#2563eb',
                                color: '#fff',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Create Video
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* TAB 2: PROJECTS & ASSIGNMENT */}
            {activeTab === 'projects' && (
              <div>
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '13px',
                      textAlign: 'left',
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color, #333)', color: '#94a3b8' }}>
                        <th style={{ padding: '10px 12px' }}>Project Title</th>
                        <th style={{ padding: '10px 12px' }}>Assigned Channel</th>
                        <th style={{ padding: '10px 12px' }}>Ratio</th>
                        <th style={{ padding: '10px 12px' }}>Status</th>
                        <th style={{ padding: '10px 12px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.map((p) => {
                        const isDelivering = deliveringProjectId === p.projectId;
                        return (
                          <tr
                            key={p.projectId}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.05)',
                            }}
                          >
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                              {p.name}
                              <div style={{ fontSize: '11px', color: '#888', fontWeight: 400 }}>
                                {p.projectId} · {p.slots.length} scenes
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <select
                                value={p.channelId || 'none'}
                                onChange={(e) => handleAssignProject(p.projectId, e.target.value)}
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-color, #444)',
                                  backgroundColor: 'rgba(0,0,0,0.3)',
                                  color: '#fff',
                                  fontSize: '12px',
                                }}
                              >
                                <option value="none">-- Unassigned --</option>
                                {channels.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                {p.settings.imageRatio || '16:9'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  backgroundColor: p.status === 'completed' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                                  color: p.status === 'completed' ? '#4ade80' : '#94a3b8',
                                }}
                              >
                                {p.status}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                {onOpenProject && (
                                  <button
                                    onClick={() => onOpenProject(p.projectId)}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      border: '1px solid var(--border-color, #444)',
                                      backgroundColor: 'rgba(255,255,255,0.06)',
                                      color: '#e2e8f0',
                                      fontSize: '11px',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Open
                                  </button>
                                )}
                                {p.channelId && (
                                  <button
                                    onClick={() => handleDeliverProject(p.projectId, p.channelId)}
                                    disabled={isDelivering}
                                    style={{
                                      padding: '4px 10px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      backgroundColor: '#2563eb',
                                      color: '#fff',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      cursor: isDelivering ? 'wait' : 'pointer',
                                      opacity: isDelivering ? 0.6 : 1,
                                    }}
                                  >
                                    {isDelivering ? 'Delivering...' : 'Deliver'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: DELIVERY HISTORY */}
            {activeTab === 'history' && (
              <div>
                {filteredHistory.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                    No delivery records found matching criteria.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '13px',
                        textAlign: 'left',
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color, #333)', color: '#94a3b8' }}>
                          <th style={{ padding: '10px 12px' }}>Status</th>
                          <th style={{ padding: '10px 12px' }}>Project</th>
                          <th style={{ padding: '10px 12px' }}>Channel</th>
                          <th style={{ padding: '10px 12px' }}>Output Video Path</th>
                          <th style={{ padding: '10px 12px' }}>Duration</th>
                          <th style={{ padding: '10px 12px' }}>Delivered At</th>
                          <th style={{ padding: '10px 12px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map((rec) => {
                          const isDelivered = rec.status === 'delivered';
                          const sizeMb = (rec.fileSizeBytes / (1024 * 1024)).toFixed(1);
                          return (
                            <tr
                              key={rec.id}
                              style={{
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                              }}
                            >
                              <td style={{ padding: '10px 12px' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    backgroundColor: isDelivered ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                    color: isDelivered ? '#4ade80' : '#f87171',
                                  }}
                                >
                                  {isDelivered ? <CheckCircleIcon size={12} /> : <AlertCircleIcon size={12} />}
                                  {rec.status.toUpperCase()}
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                {rec.projectName}
                                <div style={{ fontSize: '11px', color: '#888', fontWeight: 400 }}>
                                  {rec.aspectRatio} · {rec.videoCodec}/{rec.audioCodec} · {sizeMb}MB
                                </div>
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                {rec.channelName}
                              </td>
                              <td
                                style={{
                                  padding: '10px 12px',
                                  maxWidth: '240px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  fontFamily: 'monospace',
                                  fontSize: '11px',
                                  color: '#cbd5e1',
                                }}
                                title={rec.deliveredVideoPath}
                              >
                                {rec.deliveredVideoPath || (rec.error ? `Error: ${rec.error}` : '--')}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: '12px' }}>
                                {rec.durationSeconds > 0 ? `${rec.durationSeconds}s` : '--'}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: '11px', color: '#94a3b8' }}>
                                {new Date(rec.deliveredAt).toLocaleString()}
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  {isDelivered && rec.deliveredVideoPath && (
                                    <button
                                      onClick={() => handleReveal(rec.deliveredVideoPath)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border-color, #444)',
                                        backgroundColor: 'rgba(255,255,255,0.06)',
                                        color: '#e2e8f0',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      <FolderIcon size={12} />
                                      <span>Reveal</span>
                                    </button>
                                  )}
                                  {!isDelivered && (
                                    <button
                                      onClick={() => handleRetryDelivery(rec.id)}
                                      style={{
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        backgroundColor: '#2563eb',
                                        color: '#fff',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Retry
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Channel Create / Edit Modal */}
      <ChannelModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialChannel={editingChannel}
        onSaved={async () => {
          await loadData();
        }}
      />

      {/* Channel Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(channelToDelete)}
        title="Delete Channel"
        message={`Are you sure you want to delete "${channelToDelete?.name}"? Projects assigned to this channel will NOT be deleted; they will simply become unassigned.`}
        confirmLabel="Delete Channel"
        cancelLabel="Cancel"
        isDanger={true}
        onConfirm={handleDeleteChannelConfirm}
        onCancel={() => setChannelToDelete(null)}
      />
    </div>
  );
};
