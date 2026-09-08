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
import { SegmentedControl } from '../components/SegmentedControl';
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

  // Filter: 'all' | 'images' | 'videos'
  const [typeFilter, setTypeFilter] = useState<'all' | 'images' | 'videos'>('all');

  // Live progress tracking per slot index
  const [slotProgress, setSlotProgress] = useState<Record<number, {
    percent: number;
    stage: string;
    elapsedSeconds?: number;
    description?: string;
  }>>({});

  // Load project initially
  const loadProject = useCallback(async () => {
    if (!window.flowApi) return;
    try {
      setLoading(true);
      const data = await window.flowApi.getProject(projectId);
      if (data) {
        // Strict invariant: slots are ordered by slotIndex
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

    const unsubProgress = window.flowApi.onJobProgress((event: JobProgressEvent) => {
      if (event.projectId !== projectId) return;

      if (event.slotIndex !== undefined) {
        setSlotProgress((prev) => ({
          ...prev,
          [event.slotIndex]: {
            percent: event.progressPercent ?? 15,
            stage: event.stage ?? (event.status === 'downloading' ? 'downloading' : 'generating'),
            elapsedSeconds: event.elapsedSeconds,
            description: event.stepDescription,
          },
        }));
      }

      setProject((prev) => {
        if (!prev) return prev;
        const newSlots = prev.slots.map((s) => {
          if (s.slotIndex === event.slotIndex) {
            return {
              ...s,
              status: event.status === 'downloading' || event.status === 'generating' || event.status === 'starting' || event.status === 'configuring' ? 'running' : s.status,
              assignedProfileId: (event as any).profileId ?? s.assignedProfileId,
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

  // Separate image vs video slots, strictly ordered by slotIndex
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

  const handleRetrySlot = async (slot: PromptSlotEntity) => {
    if (!window.flowApi || !project) return;
    try {
      if (window.flowApi.retrySlot) {
        await window.flowApi.retrySlot(project.projectId, slot.slotIndex);
      } else {
        await window.flowApi.startProjectGeneration(project.projectId);
      }
      await loadProject();
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
    <div style={{ padding: '24px 36px', display: 'flex', flexDirection: 'column', gap: '22px', height: '100%', overflowY: 'auto' }}>
      {/* Top Header Bar (De-boxed & Minimalist) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-secondary btn-sm" onClick={onBackToProjects} title="Back to Projects">
            &larr; Projects
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>{project.name}</h1>
              <span className={`badge badge-${project.status === 'completed' ? 'completed' : project.status === 'running' ? 'running' : 'draft'}`}>
                {project.status}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {project.stats.totalImages > 0 && <span>{project.stats.totalImages} Images</span>}
              {project.stats.totalImages > 0 && project.stats.totalVideos > 0 && <span>·</span>}
              {project.stats.totalVideos > 0 && <span>{project.stats.totalVideos} Videos</span>}
              {project.settings.videoModel && <span>· {project.settings.videoModel}</span>}
              {project.settings.generationMode && <span>· {project.settings.generationMode.replace('_', ' ')}</span>}
              <span>· {project.settings.videoRatio || project.settings.imageRatio}</span>
            </div>
          </div>
        </div>

        {/* Global Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {hasIncomplete && (
            <button className="btn-primary" onClick={handleStartOrResume} style={{ padding: '8px 16px', fontWeight: 600 }}>
              <PlayIcon size={14} />
              Resume Generation
            </button>
          )}
          <button className="btn-secondary" onClick={loadProject} title="Reload state">
            <RefreshIcon size={14} />
          </button>
        </div>
      </div>

      {/* Progress Summary Bar (Unboxed & Sleek) */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
          <span>Total: <strong>{totalSlots}</strong></span>
          <span>Completed: <strong style={{ color: 'var(--success)' }}>{completedSlots}</strong></span>
          {project.stats.failedCount > 0 && (
            <span>Failed: <strong style={{ color: 'var(--danger)' }}>{project.stats.failedCount}</strong></span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '240px' }}>
          <div style={{ flex: 1, height: '7px', backgroundColor: 'var(--bg-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                backgroundColor: project.status === 'completed' ? 'var(--success)' : 'var(--primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{progressPercent}%</span>
        </div>
      </div>

      {/* Filter Segmented Control */}
      {imageSlots.length > 0 && videoSlots.length > 0 && (
        <div>
          <SegmentedControl<'all' | 'images' | 'videos'>
            options={[
              { value: 'all', label: `All Prompts (${totalSlots})` },
              { value: 'images', label: `Images (${imageSlots.length})` },
              { value: 'videos', label: `Videos (${videoSlots.length})` },
            ]}
            value={typeFilter}
            onChange={(val) => setTypeFilter(val)}
            size="sm"
          />
        </div>
      )}

      {/* IMAGE PROMPTS SECTION */}
      {(typeFilter === 'all' || typeFilter === 'images') && imageSlots.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Image Prompts
            </h2>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
              {imageSlots.length} slots
            </span>
          </div>
          <div className="workspace-grid">
            {imageSlots.map((slot) => (
              <PromptSlotCard
                key={slot.promptId}
                slot={slot}
                progress={slotProgress[slot.slotIndex]}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Video Prompts
            </h2>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
              {videoSlots.length} slots
            </span>
          </div>
          <div className="workspace-grid">
            {videoSlots.map((slot) => (
              <PromptSlotCard
                key={slot.promptId}
                slot={slot}
                progress={slotProgress[slot.slotIndex]}
                aspectRatio={project.settings.videoRatio || project.settings.imageRatio}
                onViewPrompt={(s) => setSelectedSlotForPrompt(s)}
                onPreviewMedia={(s) => setSelectedSlotForMedia(s)}
                onRetry={(s) => handleRetrySlot(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Full Prompt Modal */}
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
          mediaPath={selectedSlotForMedia.result?.mediaPath}
          thumbnailUrl={formatAssetUrl(selectedSlotForMedia.result?.thumbnailPath, selectedSlotForMedia.projectId)}
          promptText={selectedSlotForMedia.promptText}
          slotIndex={selectedSlotForMedia.slotIndex}
          metadata={{
            model: selectedSlotForMedia.result?.modelUsed,
            ratio: selectedSlotForMedia.result?.ratioUsed || project.settings.imageRatio,
            fileSize: selectedSlotForMedia.result?.fileSizeBytes,
            profile: selectedSlotForMedia.assignedProfileId,
            duration: selectedSlotForMedia.result?.durationFormatted,
            resolution: selectedSlotForMedia.result?.resolution,
          }}
          title={`Slot #${String(selectedSlotForMedia.slotIndex + 1).padStart(2, '0')}`}
          onClose={() => setSelectedSlotForMedia(null)}
        />
      )}
    </div>
  );
};
