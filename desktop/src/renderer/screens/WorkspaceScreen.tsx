import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  ProjectEntity,
  PromptSlotEntity,
  SlotUpdatedEvent,
  JobProgressEvent,
} from '../../shared/types';
import { PromptSlotCard } from '../components/PromptSlotCard';
import { FullPromptModal } from '../components/FullPromptModal';
import { MediaPreviewModal } from '../components/MediaPreviewModal';
import { PlayIcon, RefreshIcon } from '../components/Icons';
import { formatAssetUrl } from '../utils/assetUrl';

interface WorkspaceScreenProps {
  projectId: string;
  onBackToProjects: () => void;
}

export const WorkspaceScreen: React.FC<WorkspaceScreenProps> = ({
  projectId,
  onBackToProjects,
}) => {
  const [project, setProject] = useState<ProjectEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals state
  const [selectedSlotForPrompt, setSelectedSlotForPrompt] = useState<PromptSlotEntity | null>(null);
  const [selectedSlotForMedia, setSelectedSlotForMedia] = useState<PromptSlotEntity | null>(null);

  // Tab filter: 'all' | 'images' | 'videos'
  const [typeFilter, setTypeFilter] = useState<'all' | 'images' | 'videos'>('all');

  // Load project initially
  const loadProject = useCallback(async () => {
    if (!window.flowApi) return;
    try {
      setLoading(true);
      const data = await window.flowApi.getProject(projectId);
      if (data) {
        // Enforce strict invariant: ensure slots are ordered by slotIndex
        data.slots.sort((a, b) => a.slotIndex - b.slotIndex);
        setProject(data);
      } else {
        setErrorMsg(`Project ${projectId} not found.`);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Connect to IPC live event stream without re-fetching entire project
  useEffect(() => {
    if (!window.flowApi) return;

    // Surgical slot update
    const unsubSlot = window.flowApi.onSlotUpdated((event: SlotUpdatedEvent) => {
      if (event.projectId !== projectId) return;

      setProject((prev) => {
        if (!prev) return prev;
        const newSlots = prev.slots.map((s) => {
          if (s.slotIndex === event.slotIndex) {
            return {
              ...s,
              status: event.status,
              result: event.result ?? s.result,
              error: event.error ?? s.error,
              updatedAt: event.timestamp,
            };
          }
          return s;
        });

        // Recalculate stats cleanly
        const completedImages = newSlots.filter((s) => s.type === 'image' && s.status === 'completed').length;
        const completedVideos = newSlots.filter((s) => s.type === 'video' && s.status === 'completed').length;
        const failedCount = newSlots.filter((s) => s.status === 'failed').length;

        return {
          ...prev,
          slots: newSlots,
          stats: {
            ...prev.stats,
            completedImages,
            completedVideos,
            failedCount,
          },
        };
      });
    });

    // Surgical progress update
    const unsubProgress = window.flowApi.onJobProgress((event: JobProgressEvent) => {
      if (event.projectId !== projectId) return;

      setProject((prev) => {
        if (!prev) return prev;
        const newSlots = prev.slots.map((s) => {
          if (s.slotIndex === event.slotIndex) {
            return {
              ...s,
              status: event.status === 'downloading' || event.status === 'generating' || event.status === 'starting' || event.status === 'configuring' ? 'running' : s.status,
              assignedProfileId: event.profileId ?? s.assignedProfileId,
            };
          }
          return s;
        });
        return { ...prev, slots: newSlots };
      });
    });

    return () => {
      unsubSlot();
      unsubProgress();
    };
  }, [projectId]);

  // Separate image vs video slots, STRICTLY ORDERED by slotIndex
  const { imageSlots, videoSlots } = useMemo(() => {
    if (!project) return { imageSlots: [], videoSlots: [] };
    const sorted = [...project.slots].sort((a, b) => a.slotIndex - b.slotIndex);
    return {
      imageSlots: sorted.filter((s) => s.type === 'image'),
      videoSlots: sorted.filter((s) => s.type === 'video'),
    };
  }, [project]);

  const handleStartOrResume = async () => {
    if (!window.flowApi || !project) return;
    try {
      await window.flowApi.startProjectGeneration(project.projectId);
      await loadProject();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRetrySlot = async (_slot: PromptSlotEntity) => {
    if (!window.flowApi || !project) return;
    try {
      // Re-enqueuing project will pick up failed slots
      await window.flowApi.startProjectGeneration(project.projectId);
    } catch (err) {
      console.error('Failed to retry slot', err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading project workspace...
      </div>
    );
  }

  if (errorMsg || !project) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ color: 'var(--danger)', marginBottom: '12px' }}>{errorMsg ?? 'Project not found'}</div>
        <button className="btn-secondary" onClick={onBackToProjects}>
          &larr; Back to Projects
        </button>
      </div>
    );
  }

  const totalSlots = project.slots.length;
  const completedSlots = (project.stats.completedImages || 0) + (project.stats.completedVideos || 0);
  const progressPercent = totalSlots > 0 ? Math.round((completedSlots / totalSlots) * 100) : 0;
  const hasIncomplete = project.slots.some((s) => s.status === 'draft' || s.status === 'failed');

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      {/* Top Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-secondary btn-sm" onClick={onBackToProjects}>
            &larr; Projects
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1>{project.name}</h1>
              <span className={`badge badge-${project.status === 'completed' ? 'completed' : project.status === 'running' ? 'running' : 'draft'}`}>
                {project.status}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {project.stats.totalImages} Images · {project.stats.totalVideos} Videos · Ratio: {project.settings.imageRatio}
            </div>
          </div>
        </div>

        {/* Global Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {hasIncomplete && (
            <button className="btn-primary" onClick={handleStartOrResume}>
              <PlayIcon size={14} />
              Resume Generation
            </button>
          )}
          <button className="btn-secondary" onClick={loadProject} title="Reload state">
            <RefreshIcon size={14} />
          </button>
        </div>
      </div>

      {/* Progress Summary Bar */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
          <span>Total: <strong>{totalSlots}</strong></span>
          <span>Completed: <strong style={{ color: 'var(--success)' }}>{completedSlots}</strong></span>
          {project.stats.failedCount > 0 && (
            <span>Failed: <strong style={{ color: 'var(--danger)' }}>{project.stats.failedCount}</strong></span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '240px' }}>
          <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--bg-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                backgroundColor: project.status === 'completed' ? 'var(--success)' : 'var(--primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{progressPercent}%</span>
        </div>
      </div>

      {/* Tabs / Filter Controls */}
      {imageSlots.length > 0 && videoSlots.length > 0 && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={typeFilter === 'all' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setTypeFilter('all')}
          >
            All Prompts ({totalSlots})
          </button>
          <button
            className={typeFilter === 'images' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setTypeFilter('images')}
          >
            Image Prompts ({imageSlots.length})
          </button>
          <button
            className={typeFilter === 'videos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setTypeFilter('videos')}
          >
            Video Prompts ({videoSlots.length})
          </button>
        </div>
      )}

      {/* IMAGE PROMPTS SECTION */}
      {(typeFilter === 'all' || typeFilter === 'images') && imageSlots.length > 0 && (
        <div>
          <h2 style={{ fontSize: '15px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            IMAGE PROMPTS
            <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)' }}>
              ({imageSlots.length} slots)
            </span>
          </h2>
          <div className="workspace-grid">
            {imageSlots.map((slot) => (
              <PromptSlotCard
                key={slot.promptId}
                slot={slot}
                aspectRatio={project.settings.imageRatio}
                onViewPrompt={(s) => setSelectedSlotForPrompt(s)}
                onPreviewMedia={(s) => setSelectedSlotForMedia(s)}
                onRetry={(s) => handleRetrySlot(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* VIDEO PROMPTS SECTION */}
      {(typeFilter === 'all' || typeFilter === 'videos') && videoSlots.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <h2 style={{ fontSize: '15px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            VIDEO PROMPTS
            <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)' }}>
              ({videoSlots.length} slots)
            </span>
          </h2>
          <div className="workspace-grid">
            {videoSlots.map((slot) => (
              <PromptSlotCard
                key={slot.promptId}
                slot={slot}
                aspectRatio={project.settings.imageRatio}
                onViewPrompt={(s) => setSelectedSlotForPrompt(s)}
                onPreviewMedia={(s) => setSelectedSlotForMedia(s)}
                onRetry={(s) => handleRetrySlot(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Full Prompt Inspection Modal */}
      {selectedSlotForPrompt && (
        <FullPromptModal
          isOpen={selectedSlotForPrompt !== null}
          promptText={selectedSlotForPrompt.promptText}
          slotIndex={selectedSlotForPrompt.slotIndex}
          type={selectedSlotForPrompt.type}
          onClose={() => setSelectedSlotForPrompt(null)}
        />
      )}

      {/* Media Preview Lightbox / Player Modal */}
      {selectedSlotForMedia && (
        <MediaPreviewModal
          isOpen={selectedSlotForMedia !== null}
          type={selectedSlotForMedia.type}
          mediaUrl={formatAssetUrl(selectedSlotForMedia.result?.mediaPath, selectedSlotForMedia.projectId)}
          promptText={selectedSlotForMedia.promptText}
          slotIndex={selectedSlotForMedia.slotIndex}
          metadata={{
            model: selectedSlotForMedia.result?.modelUsed,
            ratio: selectedSlotForMedia.result?.ratioUsed || project.settings.imageRatio,
            fileSize: selectedSlotForMedia.result?.fileSizeBytes,
            profile: selectedSlotForMedia.assignedProfileId,
          }}
          title={`Slot #${String(selectedSlotForMedia.slotIndex + 1).padStart(2, '0')}`}
          onClose={() => setSelectedSlotForMedia(null)}
        />
      )}
    </div>
  );
};
