import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type {
  ProjectEntity,
  PromptSlotEntity,
  SlotUpdatedEvent,
  JobProgressEvent,
} from '../../shared/types';
import { PromptSlotCard } from '../components/PromptSlotCard';
import { FullPromptModal } from '../components/FullPromptModal';
import { MediaPreviewModal } from '../components/MediaPreviewModal';
import { PlayIcon, RefreshIcon, FolderIcon } from '../components/Icons';
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

  // Progressive loading counts for large batches
  const [visibleImageCount, setVisibleImageCount] = useState<number>(60);
  const [visibleVideoCount, setVisibleVideoCount] = useState<number>(60);
  const imageSentinelRef = useRef<HTMLDivElement>(null);
  const videoSentinelRef = useRef<HTMLDivElement>(null);

  // Live progress tracking per slot index
  const [slotProgress, setSlotProgress] = useState<Record<number, {
    percent: number;
    stage: string;
    elapsedSeconds?: number;
    description?: string;
  }>>({});

  // Batch download and slot selection state
  const [selectedSlotIndices, setSelectedSlotIndices] = useState<Set<number>>(new Set());
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (window.flowApi?.listProfiles) {
      window.flowApi.listProfiles().then((profs) => {
        const map: Record<string, string> = {};
        for (const p of profs) {
          map[p.profileId] = p.displayName || p.detectedEmail || p.profileId;
        }
        setProfileMap(map);
      }).catch(() => {});
    }
  }, []);

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

    let animFrameId: number | null = null;
    let progressBuffer: Record<number, { percent: number; stage: string; elapsedSeconds?: number; description?: string }> = {};

    const unsubProgress = window.flowApi.onJobProgress((event: JobProgressEvent) => {
      if (event.projectId !== projectId) return;

      if (event.slotIndex !== undefined) {
        progressBuffer[event.slotIndex] = {
          percent: event.progressPercent ?? 15,
          stage: event.stage ?? (event.status === 'downloading' ? 'downloading' : 'generating'),
          elapsedSeconds: event.elapsedSeconds,
          description: event.stepDescription,
        };

        if (!animFrameId) {
          animFrameId = requestAnimationFrame(() => {
            animFrameId = null;
            const batch = { ...progressBuffer };
            progressBuffer = {};
            setSlotProgress((prev) => ({
              ...prev,
              ...batch,
            }));
          });
        }
      }
    });

    return () => {
      unsubSlot();
      unsubProgress();
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
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

  // Windowed slots for smooth DOM scaling
  const displayedImageSlots = useMemo(() => {
    return imageSlots.slice(0, visibleImageCount);
  }, [imageSlots, visibleImageCount]);

  const displayedVideoSlots = useMemo(() => {
    return videoSlots.slice(0, visibleVideoCount);
  }, [videoSlots, visibleVideoCount]);

  // Auto-expand visible slots when user scrolls near sentinel
  useEffect(() => {
    if (visibleImageCount >= imageSlots.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleImageCount((prev) => Math.min(prev + 40, imageSlots.length));
      }
    }, { rootMargin: '300px' });
    if (imageSentinelRef.current) observer.observe(imageSentinelRef.current);
    return () => observer.disconnect();
  }, [visibleImageCount, imageSlots.length]);

  useEffect(() => {
    if (visibleVideoCount >= videoSlots.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleVideoCount((prev) => Math.min(prev + 40, videoSlots.length));
      }
    }, { rootMargin: '300px' });
    if (videoSentinelRef.current) observer.observe(videoSentinelRef.current);
    return () => observer.disconnect();
  }, [visibleVideoCount, videoSlots.length]);

  const handleStartOrResume = useCallback(async () => {
    if (!window.flowApi || !project) return;
    try {
      await window.flowApi.startProjectGeneration(project.projectId);
      await loadProject();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }, [project, loadProject]);

  const handleRetrySlot = useCallback(async (slot: PromptSlotEntity) => {
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
  }, [project, loadProject]);

  const handleViewPrompt = useCallback((slot: PromptSlotEntity) => {
    setSelectedSlotForPrompt(slot);
  }, []);

  const handlePreviewMedia = useCallback((slot: PromptSlotEntity) => {
    setSelectedSlotForMedia(slot);
  }, []);

  const completedSlotsList = useMemo(() => {
    return (project?.slots || []).filter((s) => s.status === 'completed' && s.result?.mediaPath);
  }, [project]);

  const allCompletedSelected =
    completedSlotsList.length > 0 &&
    completedSlotsList.every((s) => selectedSlotIndices.has(s.slotIndex));

  const toggleSelectAllCompleted = () => {
    if (allCompletedSelected) {
      setSelectedSlotIndices(new Set());
    } else {
      setSelectedSlotIndices(new Set(completedSlotsList.map((s) => s.slotIndex)));
    }
  };

  const handleExportProjectZip = async () => {
    if (!window.flowApi?.exportProjectZip || !project) return;
    try {
      setIsExportingZip(true);
      await window.flowApi.exportProjectZip(projectId);
    } catch (err) {
      console.error('Failed to export project ZIP', err);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleExportSelectedZip = async () => {
    if (!window.flowApi?.exportProjectZip || !project || selectedSlotIndices.size === 0) return;
    try {
      setIsExportingZip(true);
      await window.flowApi.exportProjectZip(projectId, Array.from(selectedSlotIndices));
    } catch (err) {
      console.error('Failed to export selected ZIP', err);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleDownloadSelectedFolder = async () => {
    if (!window.flowApi?.downloadSelected || !window.flowApi?.selectDirectory || selectedSlotIndices.size === 0) return;
    const dir = await window.flowApi.selectDirectory();
    if (!dir) return;
    try {
      await window.flowApi.downloadSelected({
        projectId,
        slotIndices: Array.from(selectedSlotIndices),
        destinationDir: dir,
      });
    } catch (err) {
      console.error('Failed to download selected to directory', err);
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
          {completedSlots > 0 && (
            <button
              className="btn-secondary"
              onClick={handleExportProjectZip}
              disabled={isExportingZip}
              style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Download all completed videos as an ordered ZIP archive"
            >
              <FolderIcon size={14} />
              {isExportingZip ? 'Exporting ZIP...' : 'Export Project ZIP'}
            </button>
          )}
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

      {/* Batch Download / Selection Strip */}
      {completedSlotsList.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={allCompletedSelected}
                onChange={toggleSelectAllCompleted}
                style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <span>Select All Completed ({completedSlotsList.length})</span>
            </label>
            {selectedSlotIndices.size > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                &bull; {selectedSlotIndices.size} selected
              </span>
            )}
          </div>

          {selectedSlotIndices.size > 0 && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn-secondary btn-sm"
                onClick={handleDownloadSelectedFolder}
                style={{ fontSize: '12px' }}
                title="Download selected files sequentially to a local folder"
              >
                Save to Folder ({selectedSlotIndices.size})
              </button>
              <button
                className="btn-primary btn-sm"
                onClick={handleExportSelectedZip}
                disabled={isExportingZip}
                style={{ fontSize: '12px' }}
                title="Download selected files as an ordered ZIP"
              >
                {isExportingZip ? 'Exporting...' : `Export ZIP (${selectedSlotIndices.size})`}
              </button>
            </div>
          )}
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
            {displayedImageSlots.map((slot) => (
              <PromptSlotCard
                key={slot.promptId}
                slot={slot}
                progress={slotProgress[slot.slotIndex]}
                aspectRatio={project.settings.imageRatio}
                isSelected={selectedSlotIndices.has(slot.slotIndex)}
                onToggleSelect={(idx) =>
                  setSelectedSlotIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(idx)) next.delete(idx);
                    else next.add(idx);
                    return next;
                  })
                }
                profileMap={profileMap}
                onViewPrompt={handleViewPrompt}
                onPreviewMedia={handlePreviewMedia}
                onRetry={handleRetrySlot}
              />
            ))}
          </div>
          {imageSlots.length > visibleImageCount && (
            <div
              ref={imageSentinelRef}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 0',
              }}
            >
              <button
                className="btn-secondary btn-sm"
                onClick={() => setVisibleImageCount(imageSlots.length)}
                style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
              >
                Showing {displayedImageSlots.length} of {imageSlots.length} image prompts &bull; Show all
              </button>
            </div>
          )}
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
            {displayedVideoSlots.map((slot) => (
              <PromptSlotCard
                key={slot.promptId}
                slot={slot}
                progress={slotProgress[slot.slotIndex]}
                aspectRatio={project.settings.videoRatio || project.settings.imageRatio}
                isSelected={selectedSlotIndices.has(slot.slotIndex)}
                onToggleSelect={(idx) =>
                  setSelectedSlotIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(idx)) next.delete(idx);
                    else next.add(idx);
                    return next;
                  })
                }
                profileMap={profileMap}
                onViewPrompt={handleViewPrompt}
                onPreviewMedia={handlePreviewMedia}
                onRetry={handleRetrySlot}
              />
            ))}
          </div>
          {videoSlots.length > visibleVideoCount && (
            <div
              ref={videoSentinelRef}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 0',
              }}
            >
              <button
                className="btn-secondary btn-sm"
                onClick={() => setVisibleVideoCount(videoSlots.length)}
                style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
              >
                Showing {displayedVideoSlots.length} of {videoSlots.length} video prompts &bull; Show all
              </button>
            </div>
          )}
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
