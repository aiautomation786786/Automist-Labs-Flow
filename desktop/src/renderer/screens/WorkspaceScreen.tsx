import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type {
  ProjectEntity,
  PromptSlotEntity,
  SlotUpdatedEvent,
  JobProgressEvent,
  FinalRenderManifest,
  FinalRenderProgressEvent,
  TransitionStyle,
  ChannelEntity,
  VideoFactoryPipelineState,
  VideoFactoryStage,
  SystemMetrics,
} from '../../shared/types';
import { PromptSlotCard } from '../components/PromptSlotCard';
import { FullPromptModal } from '../components/FullPromptModal';
import { MediaPreviewModal } from '../components/MediaPreviewModal';
import { FinalVideoModal } from '../components/FinalVideoModal';
import { PlayIcon, RefreshIcon, FolderIcon, TvIcon, CheckCircleIcon } from '../components/Icons';
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
  const [retryingSlots, setRetryingSlots] = useState<Set<number>>(new Set());
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});

  // Phase 6 Final Assembly State
  const [finalManifest, setFinalManifest] = useState<FinalRenderManifest | null>(null);
  const [finalProgress, setFinalProgress] = useState<FinalRenderProgressEvent | null>(null);
  const [isFinalRendering, setIsFinalRendering] = useState<boolean>(false);
  const [finalModalOpen, setFinalModalOpen] = useState<boolean>(false);
  const [musicPath, setMusicPath] = useState<string>('');
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const [musicVolume, setMusicVolume] = useState<number>(0.20);
  const [duckingEnabled, setDuckingEnabled] = useState<boolean>(true);
  const [assemblyTransition, setAssemblyTransition] = useState<TransitionStyle>('hard_cut');
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblySectionCollapsed, setAssemblySectionCollapsed] = useState<boolean>(false);

  // Phase 7 Channel & Delivery State
  const [channels, setChannels] = useState<ChannelEntity[]>([]);
  const [isDelivering, setIsDelivering] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState<{ path: string; channelName: string } | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  // Phase 2/3 Video Factory Pipeline State
  const [pipelineState, setPipelineState] = useState<VideoFactoryPipelineState | null>(null);
  const [isRetryingStage, setIsRetryingStage] = useState<Record<string, boolean>>({});

  // Phase 6 System Telemetry (CPU / RAM / Ping per ZBot §4)
  const [telemetry, setTelemetry] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    let active = true;
    const fetchTelemetry = async () => {
      if (!window.flowApi?.getSystemMetrics) return;
      try {
        const metrics = await window.flowApi.getSystemMetrics();
        if (active && metrics) {
          setTelemetry(metrics);
        }
      } catch {
        // Non-blocking telemetry
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load project initially
  const loadProject = useCallback(async () => {
    if (!window.flowApi) return;
    try {
      setLoading(true);
      const data = await window.flowApi.getProject(projectId);
      if (!mountedRef.current) return;
      if (data) {
        // Strict invariant: slots are ordered by slotIndex
        data.slots.sort((a, b) => a.slotIndex - b.slotIndex);
        setProject(data);

        // Load Phase 6 Final Render Manifest if exists
        if (window.flowApi?.getFinalRenderManifest) {
          window.flowApi.getFinalRenderManifest(projectId).then((manifest) => {
            if (mountedRef.current && manifest) {
              setFinalManifest(manifest);
            }
          }).catch(() => {});
        }

        // Load Phase 7 Channels
        if (window.flowApi?.listChannels) {
          window.flowApi.listChannels().then((chs) => {
            if (mountedRef.current && chs) {
              setChannels(chs);
            }
          }).catch(() => {});
        }

        // Load Phase 2/3 Pipeline State if exists
        if (window.flowApi?.getPipelineState) {
          window.flowApi.getPipelineState(projectId).then((pState) => {
            if (mountedRef.current && pState) {
              setPipelineState(pState);
            }
          }).catch(() => {});
        }
      } else {
        setErrorMsg(`Project ${projectId} not found.`);
      }
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg((err as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Listen to live final-render progress events
  useEffect(() => {
    if (!window.flowApi?.onFinalRenderProgress) return;
    const unsub = window.flowApi.onFinalRenderProgress((event: FinalRenderProgressEvent) => {
      if (event.projectId !== projectId) return;
      setFinalProgress(event);

      if (event.status === 'completed') {
        setIsFinalRendering(false);
        setAssemblyError(null);
        window.flowApi?.getFinalRenderManifest?.(projectId).then((manifest) => {
          if (mountedRef.current && manifest) {
            setFinalManifest(manifest);
          }
        }).catch(() => {});
      } else if (event.status === 'failed') {
        setIsFinalRendering(false);
        setAssemblyError(event.error || 'Assembly failed');
      } else if (event.status === 'cancelled') {
        setIsFinalRendering(false);
      } else {
        setIsFinalRendering(true);
      }
    });

    return () => unsub();
  }, [projectId]);

  const handleToggleSelect = useCallback((idx: number) => {
    setSelectedSlotIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

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

    let unsubPipeline: (() => void) | undefined;
    if (window.flowApi?.onPipelineProgress) {
      unsubPipeline = window.flowApi.onPipelineProgress((ev) => {
        if (ev.projectId !== projectId) return;
        setPipelineState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            status: ev.status,
            currentStage: ev.currentStage,
            overallProgress: ev.overallProgress,
            stages: ev.stages || prev.stages,
            error: ev.error,
          };
        });
      });
    }

    return () => {
      unsubSlot();
      unsubProgress();
      if (unsubPipeline) unsubPipeline();
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
    if (retryingSlots.has(slot.slotIndex)) return;
    try {
      setRetryingSlots((prev) => new Set(prev).add(slot.slotIndex));
      if (window.flowApi.retrySlot) {
        await window.flowApi.retrySlot(project.projectId, slot.slotIndex);
      } else {
        await window.flowApi.startProjectGeneration(project.projectId);
      }
      await loadProject();
    } catch (err) {
      console.error('Failed to retry slot', err);
      setErrorMsg((err as Error).message);
    } finally {
      setTimeout(() => {
        setRetryingSlots((prev) => {
          const next = new Set(prev);
          next.delete(slot.slotIndex);
          return next;
        });
      }, 500);
    }
  }, [project, loadProject, retryingSlots]);

  const handlePausePipeline = useCallback(async () => {
    if (!window.flowApi?.pausePipeline || !project) return;
    try {
      const updated = await window.flowApi.pausePipeline(project.projectId);
      setPipelineState(updated);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }, [project]);

  const handleResumePipeline = useCallback(async () => {
    if (!window.flowApi?.resumePipeline || !project) return;
    try {
      const updated = await window.flowApi.resumePipeline(project.projectId);
      setPipelineState(updated);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }, [project]);

  const handleCancelPipeline = useCallback(async () => {
    if (!window.flowApi?.cancelPipeline || !project) return;
    try {
      const updated = await window.flowApi.cancelPipeline(project.projectId);
      setPipelineState(updated);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }, [project]);

  const handleRetryPipelineStage = useCallback(async (stage: VideoFactoryStage) => {
    if (!window.flowApi?.retryPipelineStage || !project) return;
    if (isRetryingStage[stage]) return;
    try {
      setIsRetryingStage((prev) => ({ ...prev, [stage]: true }));
      const updated = await window.flowApi.retryPipelineStage(project.projectId, stage);
      setPipelineState(updated);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setTimeout(() => {
        setIsRetryingStage((prev) => ({ ...prev, [stage]: false }));
      }, 1000);
    }
  }, [project, isRetryingStage]);

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

  const handleSelectMusic = async () => {
    if (!window.flowApi?.selectMusicFile) return;
    const chosen = await window.flowApi.selectMusicFile();
    if (chosen) {
      setMusicPath(chosen);
      setMusicEnabled(true);
    }
  };

  const handleAssembleFinalVideo = async () => {
    if (!window.flowApi?.assembleFinalVideo) return;
    try {
      setIsFinalRendering(true);
      setAssemblyError(null);
      const manifest = await window.flowApi.assembleFinalVideo(projectId, {
        musicPath: musicEnabled && musicPath ? musicPath : undefined,
        musicEnabled: musicEnabled && Boolean(musicPath),
        musicVolume,
        duckingEnabled,
        transitionStyle: assemblyTransition,
      });
      if (mountedRef.current) {
        setFinalManifest(manifest);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setAssemblyError(err.message || 'Final video assembly failed');
      }
    } finally {
      if (mountedRef.current) {
        setIsFinalRendering(false);
      }
    }
  };

  const handleCancelFinalRender = async () => {
    if (!window.flowApi?.cancelFinalRender) return;
    try {
      await window.flowApi.cancelFinalRender(projectId);
    } catch (err) {
      console.error('Failed to cancel final render', err);
    }
  };

  const handleAssignChannel = async (newChannelId: string) => {
    if (!window.flowApi?.assignProjectToChannel) return;
    try {
      const updated = await window.flowApi.assignProjectToChannel(
        projectId,
        newChannelId === 'none' ? undefined : newChannelId
      );
      setProject(updated);
    } catch (err) {
      console.error('Failed to assign project to channel', err);
    }
  };

  const handleDeliverToChannel = async () => {
    if (!window.flowApi?.deliverProjectToChannel) return;
    if (!project?.channelId && channels.length === 0) {
      setDeliveryError('No channels exist. Create a channel in Channels screen first.');
      return;
    }
    const targetChannelId = project?.channelId || channels[0]?.id;
    try {
      setIsDelivering(true);
      setDeliveryError(null);
      setDeliveryResult(null);
      const res = await window.flowApi.deliverProjectToChannel(projectId, targetChannelId);
      setDeliveryResult({ path: res.deliveredVideoPath, channelName: res.channelName });
      loadProject();
    } catch (err: any) {
      setDeliveryError(err.message || 'Delivery failed');
    } finally {
      setIsDelivering(false);
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
              {project.channelName && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  📺 {project.channelName}
                </span>
              )}
              {project.settings.provider && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: project.settings.provider === 'gemini' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                    color: project.settings.provider === 'gemini' ? '#60a5fa' : '#818cf8',
                    border: `1px solid ${project.settings.provider === 'gemini' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`,
                  }}
                >
                  {project.settings.provider === 'gemini' ? 'Gemini' : project.settings.provider === 'auto' ? 'Auto Balanced' : 'Google Flow'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {project.stats.totalImages > 0 && <span>{project.stats.totalImages} Images</span>}
              {project.stats.totalImages > 0 && project.stats.totalVideos > 0 && <span>·</span>}
              {project.stats.totalVideos > 0 && <span>{project.stats.totalVideos} Videos</span>}
              {project.settings.videoModel && <span>· {project.settings.videoModel}</span>}
              {project.settings.generationMode && <span>· {project.settings.generationMode.replace('_', ' ')}</span>}
              <span>· {project.settings.videoRatio || project.settings.imageRatio}</span>
              <span style={{ marginLeft: '4px' }}>· Channel:</span>
              <select
                value={project.channelId || 'none'}
                onChange={(e) => handleAssignChannel(e.target.value)}
                style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--border-color)',
                  color: project.channelName ? '#60a5fa' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <option value="none">-- Unassigned --</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Global Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {telemetry && (
            <div
              data-testid="system-telemetry-row"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'var(--text-secondary)',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 10px',
              }}
              title="System Telemetry (ZBot Parity)"
            >
              <span title="CPU Utilization">
                CPU: <strong style={{ color: telemetry.cpuPercent > 85 ? 'var(--danger)' : 'var(--text-primary)' }}>{telemetry.cpuPercent}%</strong>
              </span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span title="Memory Usage">
                RAM: <strong style={{ color: telemetry.memPercent > 85 ? 'var(--danger)' : 'var(--text-primary)' }}>{telemetry.memPercent}%</strong> ({Math.round((telemetry.totalMemMb - telemetry.freeMemMb) / 102.4) / 10}GB)
              </span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span title="Ping Latency">
                PING: <strong style={{ color: telemetry.pingMs > 250 ? 'var(--warning)' : 'var(--text-primary)' }}>{telemetry.pingMs}ms</strong>
              </span>
            </div>
          )}
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
          <button
            className="btn-secondary"
            onClick={async () => {
              if (isRefreshing) return;
              setIsRefreshing(true);
              try {
                await loadProject();
              } finally {
                setIsRefreshing(false);
              }
            }}
            disabled={isRefreshing}
            title="Refresh"
            aria-label="Refresh project state"
          >
            <RefreshIcon size={14} className={isRefreshing ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {/* Phase 2/3 Video Factory Pipeline Panel */}
      {pipelineState && (
        <div
          data-testid="video-factory-pipeline-panel"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: pipelineState.status === 'failed'
              ? '1px solid rgba(239, 68, 68, 0.4)'
              : pipelineState.status === 'running'
              ? '1px solid rgba(99, 102, 241, 0.4)'
              : '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em' }}>
                Video Factory Pipeline
              </span>
              <span
                className={`badge badge-${
                  pipelineState.status === 'completed'
                    ? 'completed'
                    : pipelineState.status === 'running'
                    ? 'running'
                    : pipelineState.status === 'failed'
                    ? 'failed'
                    : 'draft'
                }`}
              >
                {pipelineState.status.toUpperCase()}
              </span>
              {pipelineState.currentStage && (
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Current Stage: <strong>{pipelineState.currentStage}</strong>
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {pipelineState.status === 'running' && (
                <button
                  className="btn-secondary btn-sm"
                  onClick={handlePausePipeline}
                  title="Pause pipeline safely at next checkpoint"
                >
                  Pause
                </button>
              )}
              {pipelineState.status === 'paused' && (
                <button
                  className="btn-primary btn-sm"
                  onClick={handleResumePipeline}
                  title="Resume paused pipeline"
                >
                  Resume
                </button>
              )}
              {(pipelineState.status === 'running' || pipelineState.status === 'paused' || pipelineState.status === 'resuming') && (
                <button
                  className="btn-secondary btn-sm"
                  onClick={handleCancelPipeline}
                  style={{ color: 'var(--danger)' }}
                  title="Cancel pipeline and prevent auto-retries"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Overall Progress Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--bg-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pipelineState.overallProgress}%`,
                  height: '100%',
                  backgroundColor: pipelineState.status === 'completed'
                    ? 'var(--success)'
                    : pipelineState.status === 'failed'
                    ? 'var(--danger)'
                    : 'var(--primary)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              {pipelineState.overallProgress}%
            </span>
          </div>

          {/* Pipeline Stages Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '8px',
              paddingTop: '6px',
            }}
          >
            {(
              [
                'story',
                'images',
                'voice',
                'thumbnail',
                'clips',
                'review',
                'subtitles',
                'rendering',
                'export',
              ] as VideoFactoryStage[]
            ).map((stKey) => {
              const st = pipelineState.stages[stKey];
              if (!st) return null;
              const isCurrent = pipelineState.currentStage === stKey;
              const retryState = st.retryState;

              let retryBadgeText = '';
              if (retryState?.retryReason === 'IDENTICAL_ERROR_BAILOUT') {
                retryBadgeText = 'Halted (Identical)';
              } else if (retryState?.retryReason === 'RETRY_LIMIT_EXCEEDED') {
                retryBadgeText = 'Max Retries';
              } else if (retryState?.cancelledByUser) {
                retryBadgeText = 'Cancelled';
              } else if (retryState && retryState.attempt > 0) {
                retryBadgeText = `Retry ${retryState.attempt}/${retryState.maxAttempts}`;
              }

              return (
                <div
                  key={stKey}
                  data-testid={`pipeline-stage-${stKey}`}
                  style={{
                    backgroundColor: isCurrent ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-card)',
                    border: isCurrent
                      ? '1px solid var(--primary)'
                      : st.status === 'completed'
                      ? '1px solid rgba(16, 185, 129, 0.3)'
                      : st.status === 'failed'
                      ? '1px solid rgba(239, 68, 68, 0.4)'
                      : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '11.5px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{stKey}</span>
                    <span
                      className={`badge badge-${
                        st.status === 'completed'
                          ? 'completed'
                          : st.status === 'running'
                          ? 'running'
                          : st.status === 'failed'
                          ? 'failed'
                          : 'draft'
                      }`}
                      style={{ fontSize: '9.5px', padding: '1px 5px' }}
                    >
                      {st.status}
                    </span>
                  </div>

                  {/* Phase 5 Clips stage specific indicators */}
                  {stKey === 'clips' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                      {Boolean((project as any)?.config?.motionStyle) && (
                        <span
                          className="badge"
                          style={{
                            fontSize: '8.5px',
                            padding: '1px 4px',
                            width: 'fit-content',
                            backgroundColor: 'rgba(168, 85, 247, 0.15)',
                            color: '#c084fc',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                          }}
                        >
                          Motion: {(project as any).config.motionStyle}
                        </span>
                      )}
                      {Boolean(st.outputs?.verifiedClips) && (
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {String(st.outputs?.verifiedClips)} clips ready
                        </span>
                      )}
                    </div>
                  )}

                  {/* Phase 4 Export stage specific indicators */}
                  {stKey === 'export' && st.status === 'running' && (
                    <span style={{ fontSize: '9.5px', color: '#60a5fa', fontWeight: 600 }}>
                      Exporting...
                    </span>
                  )}

                  {stKey === 'export' && st.status === 'completed' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                      <span
                        className="badge badge-completed"
                        style={{ fontSize: '8.5px', padding: '1px 4px', width: 'fit-content' }}
                      >
                        {st.outputs?.destinationType === 'shorts'
                          ? 'Exported to Shorts'
                          : st.outputs?.destinationType === 'longs'
                          ? 'Exported to Longs'
                          : 'Exported'}
                      </span>
                      {Boolean(st.outputs?.collisionHandled) && (
                        <span
                          className="badge"
                          style={{
                            fontSize: '8.5px',
                            padding: '1px 4px',
                            width: 'fit-content',
                            backgroundColor: 'rgba(234, 179, 8, 0.15)',
                            color: '#facc15',
                            border: '1px solid rgba(234, 179, 8, 0.3)',
                          }}
                        >
                          Collision handled
                        </span>
                      )}
                      {Boolean(st.outputs?.deliveredVideoPath) && (
                        <span
                          style={{
                            fontSize: '9px',
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={String(st.outputs?.deliveredVideoPath)}
                        >
                          {String(st.outputs?.deliveredVideoPath).split(/[\\/]/).pop()}
                        </span>
                      )}
                    </div>
                  )}

                  {retryBadgeText && (
                    <span
                      className={`badge badge-${retryState?.retryReason === 'IDENTICAL_ERROR_BAILOUT' || retryState?.retryReason === 'RETRY_LIMIT_EXCEEDED' ? 'failed' : 'retrying'}`}
                      style={{ fontSize: '9px', padding: '1px 4px', width: 'fit-content' }}
                    >
                      {retryBadgeText}
                    </span>
                  )}

                  {st.error && (
                    <div
                      style={{
                        color: 'var(--danger)',
                        fontSize: '10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={st.error}
                    >
                      {stKey === 'export' ? `Export failed: ${st.error}` : st.error}
                    </div>
                  )}

                  {(st.status === 'failed' || st.status === 'cancelled') && (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleRetryPipelineStage(stKey)}
                      disabled={isRetryingStage[stKey]}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        marginTop: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                      title={`Retry ${stKey} stage manually`}
                    >
                      <RefreshIcon size={10} />
                      {isRetryingStage[stKey]
                        ? 'Retrying...'
                        : stKey === 'export'
                        ? 'Retry Export'
                        : 'Retry Stage'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Final Video & Music Assembly Panel */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', fontWeight: 700 }}>Final Video &amp; Music Assembly</span>
            {finalManifest?.status === 'completed' && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}
              >
                Final Video Ready ({finalManifest.durationSeconds.toFixed(1)}s)
              </span>
            )}
            {isFinalRendering && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}
              >
                {finalProgress?.stageMessage || 'Assembling...'} ({finalProgress?.progressPercent || 0}%)
              </span>
            )}
          </div>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setAssemblySectionCollapsed((prev) => !prev)}
            style={{ fontSize: '12px', padding: '3px 8px' }}
          >
            {assemblySectionCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>

        {!assemblySectionCollapsed && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', paddingTop: '4px' }}>
            {/* Left Column: Music & Transitions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Background Music &amp; Transitions
              </div>

              {/* Music Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={musicEnabled}
                      onChange={(e) => setMusicEnabled(e.target.checked)}
                      disabled={isFinalRendering}
                    />
                    Enable Background Music
                  </label>
                  {musicPath && (
                    <button
                      onClick={() => setMusicPath('')}
                      disabled={isFinalRendering}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={handleSelectMusic}
                    disabled={isFinalRendering || !musicEnabled}
                    style={{ fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}
                  >
                    Choose Audio File...
                  </button>
                  <span
                    style={{
                      fontSize: '12px',
                      color: musicPath ? 'var(--text-primary)' : 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={musicPath || undefined}
                  >
                    {musicPath ? musicPath.split(/[\\/]/).pop() : '(No background music selected)'}
                  </span>
                </div>
              </div>

              {/* Volume Slider & Ducking */}
              {musicEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>Music Volume: {Math.round(musicVolume * 100)}%</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={duckingEnabled}
                        onChange={(e) => setDuckingEnabled(e.target.checked)}
                        disabled={isFinalRendering}
                      />
                      Auto-Ducking Narration
                    </label>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={musicVolume}
                    onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                    disabled={isFinalRendering}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {/* Transition Style */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Transition:</span>
                <button
                  className={assemblyTransition === 'hard_cut' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  onClick={() => setAssemblyTransition('hard_cut')}
                  disabled={isFinalRendering}
                  style={{ fontSize: '11px', padding: '3px 10px' }}
                >
                  Hard Cut
                </button>
                <button
                  className={assemblyTransition === 'cross_fade' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  onClick={() => setAssemblyTransition('cross_fade')}
                  disabled={isFinalRendering}
                  style={{ fontSize: '11px', padding: '3px 10px' }}
                >
                  Cross Fade (0.75s)
                </button>
              </div>
            </div>

            {/* Right Column: Final Assembly Action & Output Status */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: '12px',
                borderLeft: '1px solid var(--border-color)',
                paddingLeft: '20px',
              }}
            >
              {isFinalRendering ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    {finalProgress?.stageMessage || 'Assembling Final Video...'}
                  </div>
                  <div style={{ height: '8px', backgroundColor: 'var(--bg-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${finalProgress?.progressPercent || 0}%`,
                        height: '100%',
                        backgroundColor: 'var(--primary)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {finalProgress?.progressPercent || 0}% complete
                    </span>
                    <button
                      className="btn-danger btn-sm"
                      onClick={handleCancelFinalRender}
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      Cancel Assembly
                    </button>
                  </div>
                </div>
              ) : assemblyError ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ color: 'var(--danger)', fontSize: '12px' }}>
                    <strong>Assembly Error:</strong> {assemblyError}
                  </div>
                  <button
                    className="btn-primary btn-sm"
                    onClick={handleAssembleFinalVideo}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Retry Assembly
                  </button>
                </div>
              ) : finalManifest?.status === 'completed' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  {finalManifest.thumbnailFile && (
                    <div
                      onClick={() => setFinalModalOpen(true)}
                      style={{
                        width: '100px',
                        height: '60px',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        position: 'relative',
                        border: '1px solid var(--border-color)',
                        flexShrink: 0,
                      }}
                      title="Click to preview final video"
                    >
                      <img
                        src={formatAssetUrl(finalManifest.absoluteThumbnailPath || finalManifest.thumbnailFile)}
                        alt="Final Thumbnail"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: 'rgba(0,0,0,0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                        }}
                      >
                        <PlayIcon size={18} />
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>final.mp4 ({finalManifest.durationSeconds.toFixed(1)}s)</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {finalManifest.width}x{finalManifest.height} &bull; {(finalManifest.fileSizeBytes / (1024 * 1024)).toFixed(1)}MB &bull; {finalManifest.videoCodec}/{finalManifest.audioCodec}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => setFinalModalOpen(true)}
                        style={{ fontSize: '12px', padding: '4px 12px' }}
                      >
                        Watch Video
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => window.flowApi?.revealAsset?.(finalManifest.absoluteVideoPath)}
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        title="Open folder in File Explorer"
                      >
                        <FolderIcon size={13} />
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={handleAssembleFinalVideo}
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        title="Re-assemble with updated settings"
                      >
                        Re-assemble
                      </button>
                      <button
                        className="btn-primary btn-sm"
                        onClick={handleDeliverToChannel}
                        disabled={isDelivering}
                        style={{
                          fontSize: '12px',
                          padding: '4px 12px',
                          backgroundColor: '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        title="Deliver final video to assigned channel destination folder"
                      >
                        <TvIcon size={13} />
                        {isDelivering ? 'Delivering...' : project.channelName ? `Deliver to ${project.channelName}` : 'Deliver to Channel'}
                      </button>
                    </div>

                    {deliveryResult && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11.5px',
                          color: '#4ade80',
                          backgroundColor: 'rgba(34, 197, 94, 0.1)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(34, 197, 94, 0.25)',
                          marginTop: '4px',
                        }}
                      >
                        <CheckCircleIcon size={12} />
                        <span>Delivered to {deliveryResult.channelName}!</span>
                        <button
                          onClick={() => window.flowApi?.revealAsset?.(deliveryResult.path)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#60a5fa',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: '11.5px',
                            padding: 0,
                            marginLeft: '4px',
                          }}
                        >
                          Reveal in Folder
                        </button>
                      </div>
                    )}

                    {deliveryError && (
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: '#f87171',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          marginTop: '4px',
                        }}
                      >
                        Delivery error: {deliveryError}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Combine rendered scene clips, speech narration, and background music into a polished final MP4.
                  </div>
                  <button
                    className="btn-primary"
                    onClick={handleAssembleFinalVideo}
                    style={{ alignSelf: 'flex-start', padding: '8px 18px', fontWeight: 600, fontSize: '13px' }}
                  >
                    Assemble Final Video
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
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
                onToggleSelect={handleToggleSelect}
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
                onToggleSelect={handleToggleSelect}
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
            watermarkCleaned: selectedSlotForMedia.result?.watermarkCleaned,
            originalMediaPath: selectedSlotForMedia.result?.originalMediaPath,
          }}
          title={`Slot #${String(selectedSlotForMedia.slotIndex + 1).padStart(2, '0')}`}
          onClose={() => setSelectedSlotForMedia(null)}
        />
      )}

      {/* Final Finished Video Modal */}
      {finalManifest && (
        <FinalVideoModal
          isOpen={finalModalOpen}
          manifest={finalManifest}
          onClose={() => setFinalModalOpen(false)}
          onReveal={(p) => window.flowApi?.revealAsset?.(p)}
        />
      )}
    </div>
  );
};
