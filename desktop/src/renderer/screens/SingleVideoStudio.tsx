import React, { useState, useEffect, useRef } from 'react';
import type { SupportedAspectRatio, GeminiAspectRatio } from '../../shared/types';
import { formatAssetUrl } from '../utils/assetUrl';
import { MediaPreviewModal } from '../components/MediaPreviewModal';
import {
  VideoIcon,
  SparklesIcon,
  ClockIcon,
  CheckIcon,
  CopyIcon,
  FolderIcon,
  EyeIcon,
  ChevronLeftIcon,
  AlertCircleIcon,
  CloseIcon,
} from '../components/Icons';

export type SingleVideoModel =
  | 'Veo 3.1 - Quality'
  | 'Veo 3.1 - Fast'
  | 'Veo 3.1 - Lite'
  | 'Omni 1.1 Flash';

interface SingleVideoStudioProps {
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
  onNavigateProfiles?: () => void;
}

interface VideoModelOption {
  id: SingleVideoModel;
  label: string;
  badge: string;
  badgeColor: string;
  description: string;
  provider: 'flow' | 'gemini';
  tag: string;
}

const VIDEO_MODELS: VideoModelOption[] = [
  {
    id: 'Veo 3.1 - Quality',
    label: 'Veo 3.1 - Quality',
    badge: 'Google Flow',
    badgeColor: 'rgba(168, 85, 247, 0.15)',
    description: 'Cinema-grade realism with rich motion, physics & lighting.',
    provider: 'flow',
    tag: 'Cinema Fidelity',
  },
  {
    id: 'Veo 3.1 - Fast',
    label: 'Veo 3.1 - Fast',
    badge: 'Google Flow',
    badgeColor: 'rgba(59, 130, 246, 0.15)',
    description: 'Fast 8s generation for dynamic motion and rapid iteration.',
    provider: 'flow',
    tag: 'Popular',
  },
  {
    id: 'Veo 3.1 - Lite',
    label: 'Veo 3.1 - Lite',
    badge: 'Google Flow',
    badgeColor: 'rgba(16, 185, 129, 0.15)',
    description: 'Efficient 8s generation for quick, lightweight creation.',
    provider: 'flow',
    tag: 'Efficient',
  },
  {
    id: 'Omni 1.1 Flash',
    label: 'Omni 1.1 Flash',
    badge: 'Flow / Gemini',
    badgeColor: 'rgba(6, 182, 212, 0.15)',
    description: 'Flexible duration and resolution with Flow or Gemini.',
    provider: 'flow',
    tag: 'Multimodal',
  },
];

const ASPECT_RATIOS: Array<{
  id: SupportedAspectRatio;
  label: string;
  sub: string;
  iconType: 'landscape' | 'portrait';
}> = [
  {
    id: '16:9',
    label: '16:9 Landscape',
    sub: 'Desktop, Cinema & YouTube',
    iconType: 'landscape',
  },
  {
    id: '9:16',
    label: '9:16 Portrait',
    sub: 'Mobile, Shorts & Reels',
    iconType: 'portrait',
  },
];

const SAMPLE_VIDEO_CHIPS = [
  {
    label: '🎬 Cinematic Drone',
    prompt: 'A sweeping cinematic drone shot over a misty pine forest at golden hour, realistic volumetric lighting and slow forward motion.',
  },
  {
    label: '🏎️ Dynamic Motion',
    prompt: 'A sleek red sports car accelerating down a winding coastal highway, realistic motion blur, dynamic low camera angle.',
  },
  {
    label: '☕ Warm Lifestyle',
    prompt: 'A cozy Nordic coffee shop interior with warm pendant lights, gentle steam rising from a fresh cappuccino, soft morning sunlight.',
  },
  {
    label: '🌿 Macro Orbit',
    prompt: 'A slow cinematic camera orbit around a lush green monstera leaf with morning dew drops, shallow depth of field, photorealistic lighting.',
  },
];

type ProgressStage = 'idle' | 'preparing' | 'configuring' | 'submitting' | 'generating' | 'fetching' | 'processing' | 'ready';

interface GeneratedVideoResult {
  projectId: string;
  slotIndex: number;
  mediaPath: string;
  thumbnailPath?: string;
  modelUsed: string;
  ratioUsed: string;
  durationFormatted?: string;
  durationSeconds?: number;
  prompt: string;
  durationMs: number;
  completedAt: string;
  watermarkCleaned?: boolean;
}

export const SingleVideoStudio: React.FC<SingleVideoStudioProps> = ({
  onProjectCreated: _onProjectCreated,
  onCancel,
}) => {
  const [selectedModel, setSelectedModel] = useState<SingleVideoModel>('Veo 3.1 - Fast');
  const [aspectRatio, setAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [prompt, setPrompt] = useState<string>('');
  
  // Model-specific settings: only Omni 1.1 Flash supports selectable duration & resolution
  const [omniProvider, setOmniProvider] = useState<'flow' | 'gemini'>('flow');
  const [omniDuration, setOmniDuration] = useState<'4s' | '6s' | '8s' | '10s'>('4s');
  const [omniResolution, setOmniResolution] = useState<'360p' | '720p'>('720p');

  // Execution & Progress state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressStage, setProgressStage] = useState<ProgressStage>('idle');
  const [stageMessage, setStageMessage] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [revealedInFinder, setRevealedInFinder] = useState<boolean>(false);
  const [generatedResult, setGeneratedResult] = useState<GeneratedVideoResult | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState<boolean>(false);
  const [accountsCount, setAccountsCount] = useState<{ ready: number; total: number }>({ ready: 6, total: 6 });

  const activeJobIdRef = useRef<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const autoDismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const promptRef = useRef<string>(prompt);
  promptRef.current = prompt;
  const selectedModelRef = useRef<SingleVideoModel>(selectedModel);
  selectedModelRef.current = selectedModel;
  const aspectRatioRef = useRef<SupportedAspectRatio>(aspectRatio);
  aspectRatioRef.current = aspectRatio;
  const omniProviderRef = useRef<'flow' | 'gemini'>(omniProvider);
  omniProviderRef.current = omniProvider;

  // Load connected accounts count
  useEffect(() => {
    async function loadAccounts() {
      if (window.flowApi && typeof window.flowApi.listProfiles === 'function') {
        try {
          const profiles = await window.flowApi.listProfiles();
          if (Array.isArray(profiles) && profiles.length > 0) {
            const readyCount = profiles.filter((p: any) => p.status === 'ready' || p.status === 'connected').length;
            setAccountsCount({
              ready: readyCount > 0 ? readyCount : profiles.length,
              total: profiles.length,
            });
          }
        } catch {}
      }
    }
    loadAccounts();
  }, []);

  // Timer for generation duration
  useEffect(() => {
    if (isGenerating) {
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isGenerating]);

  // Clean up auto-dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
      }
    };
  }, []);

  // Subscribe to flowApi events for real-time progress & completion
  useEffect(() => {
    if (!window.flowApi) return;

    const unsubs: Array<() => void> = [];

    if (typeof window.flowApi.onJobProgress === 'function') {
      const unsub = window.flowApi.onJobProgress((evt) => {
        if (!activeProjectIdRef.current || evt.projectId !== activeProjectIdRef.current) return;
        const msg = (evt.stepDescription || '').toLowerCase();
        if (msg.includes('preparing') || msg.includes('starting') || msg.includes('allocat')) {
          setProgressStage('preparing');
        } else if (msg.includes('configuring') || msg.includes('setting') || msg.includes('select')) {
          setProgressStage('configuring');
        } else if (msg.includes('submitting') || msg.includes('filling') || msg.includes('inject')) {
          setProgressStage('submitting');
        } else if (msg.includes('generating') || msg.includes('inference')) {
          setProgressStage('generating');
        } else if (msg.includes('download') || msg.includes('fetching') || msg.includes('sniff')) {
          setProgressStage('fetching');
        } else if (msg.includes('watermark') || msg.includes('thumbnail') || msg.includes('poster') || msg.includes('process')) {
          setProgressStage('processing');
        }
        setStageMessage(evt.stepDescription || 'Processing video...');
      });
      unsubs.push(unsub);
    }

    if (typeof window.flowApi.onSlotUpdated === 'function') {
      const unsub = window.flowApi.onSlotUpdated((evt) => {
        if (!activeProjectIdRef.current || evt.projectId !== activeProjectIdRef.current) return;
        if (evt.status === 'completed' && evt.result?.mediaPath) {
          const totalMs = Date.now() - (startTimeRef.current || Date.now());
          setGeneratedResult({
            projectId: evt.projectId,
            slotIndex: evt.slotIndex,
            mediaPath: evt.result.mediaPath,
            thumbnailPath: evt.result.thumbnailPath,
            modelUsed: evt.result.modelUsed || selectedModelRef.current,
            ratioUsed: evt.result.ratioUsed || aspectRatioRef.current,
            durationFormatted: evt.result.durationFormatted,
            durationSeconds: evt.result.durationSeconds,
            prompt: promptRef.current.trim(),
            durationMs: evt.result.totalElapsedTimeMs || totalMs,
            completedAt: new Date().toISOString(),
            watermarkCleaned: evt.result.watermarkCleaned,
          });
          setProgressStage('ready');
          setStageMessage('Video generated successfully!');
          setIsGenerating(false);

          autoDismissTimerRef.current = setTimeout(() => {
            setIsProgressModalOpen(false);
          }, 850);
        } else if (evt.status === 'failed') {
          setErrorMsg('Video generation failed.');
          setIsGenerating(false);
          setProgressStage('idle');
        }
      });
      unsubs.push(unsub);
    }

    if (typeof window.flowApi.onJobFailed === 'function') {
      const unsub = window.flowApi.onJobFailed((job) => {
        if (!activeProjectIdRef.current || job.projectId !== activeProjectIdRef.current) return;
        setErrorMsg(job.errorMessage || 'Job failed during execution.');
        setIsGenerating(false);
        setProgressStage('idle');
      });
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    if (!window.flowApi) {
      setErrorMsg('Desktop API bridge is not available.');
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);
    setProgressStage('preparing');
    setStageMessage('Initializing automation session...');
    setIsProgressModalOpen(true);

    const isOmni = selectedModel === 'Omni 1.1 Flash';
    const effectiveProvider = isOmni ? omniProvider : 'flow';
    const isGemini = effectiveProvider === 'gemini';

    const effectiveDuration = selectedModel === 'Veo 3.1 - Quality'
      ? '10s'
      : (selectedModel === 'Veo 3.1 - Fast' || selectedModel === 'Veo 3.1 - Lite')
      ? '8s'
      : isOmni
      ? (isGemini ? '10s' : omniDuration)
      : '8s';

    const effectiveResolution = isGemini
      ? '720p'
      : isOmni
      ? omniResolution
      : 'Default';

    try {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const project = await window.flowApi.createProject({
        name: `Single Video · ${timeStr}`,
        provider: effectiveProvider,
        generationMode: isGemini ? 'gemini_text_to_video' : 'single_video',
        videoModel: isGemini ? 'Gemini Omni' : selectedModel,
        videoRatio: aspectRatio,
        geminiAspectRatio: isGemini ? (aspectRatio as GeminiAspectRatio) : undefined,
        videoDuration: effectiveDuration,
        videoResolution: effectiveResolution,
        videoDownloadQuality: 'original', // Strictly native original output internally
        prompts: [
          {
            text: prompt.trim(),
            type: 'video',
            provider: effectiveProvider,
          },
        ],
      });

      activeProjectIdRef.current = project.projectId;

      const jobs = await window.flowApi.startProjectGeneration(project.projectId);
      if (Array.isArray(jobs) && jobs.length > 0) {
        activeJobIdRef.current = jobs[0].jobId;
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to initialize video generation.');
      setIsGenerating(false);
      setProgressStage('idle');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleCopyPrompt = async () => {
    if (!generatedResult) return;
    try {
      await navigator.clipboard.writeText(generatedResult.prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {}
  };

  const handleRevealInFinder = async () => {
    if (!generatedResult || !window.flowApi) return;
    try {
      if (typeof window.flowApi.revealAsset === 'function') {
        await window.flowApi.revealAsset(generatedResult.mediaPath);
        setRevealedInFinder(true);
        setTimeout(() => setRevealedInFinder(false), 2000);
      }
    } catch {}
  };

  // Stage definitions for floating progress modal
  const STAGES = [
    { id: 'preparing', label: 'Preparing Session' },
    { id: 'configuring', label: 'Configuring Model' },
    { id: 'submitting', label: 'Submitting Prompt' },
    { id: 'generating', label: 'Generating Video' },
    { id: 'fetching', label: 'Fetching & Downloading' },
    { id: 'processing', label: 'Finalizing & Verifying' },
  ];

  const getStageStatus = (stageId: string): 'pending' | 'active' | 'done' => {
    const stageOrder = ['preparing', 'configuring', 'submitting', 'generating', 'fetching', 'processing', 'ready'];
    const currentIndex = stageOrder.indexOf(progressStage);
    const thisIndex = stageOrder.indexOf(stageId);
    if (progressStage === 'ready') return 'done';
    if (thisIndex < currentIndex) return 'done';
    if (thisIndex === currentIndex) return 'active';
    return 'pending';
  };

  const activeDurationDisplay = selectedModel === 'Veo 3.1 - Quality'
    ? '10s'
    : (selectedModel === 'Veo 3.1 - Fast' || selectedModel === 'Veo 3.1 - Lite')
    ? '8s'
    : selectedModel === 'Omni 1.1 Flash'
    ? (omniProvider === 'gemini' ? '10s' : omniDuration)
    : '8s';

  return (
    <div
      className="if-studio-container"
      style={{
        width: '100%',
        minHeight: '100%',
        backgroundColor: 'var(--if-bg-base)',
        color: 'var(--if-text-primary)',
        padding: '16px 24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="if-studio-inner"
        style={{
          width: '100%',
          maxWidth: '820px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          flex: 1,
        }}
      >
        {/* 1. STUDIO HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '2px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={onCancel}
              className="if-btn-secondary"
              style={{
                width: '34px',
                height: '34px',
                padding: 0,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Return to Workspace"
              aria-label="Back"
            >
              <ChevronLeftIcon size={16} />
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '18px',
                    fontWeight: 650,
                    letterSpacing: '-0.02em',
                    color: '#ffffff',
                  }}
                >
                  Single Video Studio
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(109, 93, 251, 0.16)',
                    color: 'var(--if-accent-secondary)',
                    border: '1px solid var(--if-accent-glow)',
                  }}
                >
                  Pro Motion
                </span>
              </div>
              <p
                style={{
                  fontSize: '12px',
                  color: 'var(--if-text-secondary)',
                  margin: '2px 0 0 0',
                }}
              >
                Cinematic video generation with Veo 3.1 & Omni 1.1 across isolated browser profiles.
              </p>
            </div>
          </div>

          {/* Account Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '20px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--if-border-card)',
              fontSize: '12px',
              color: 'var(--if-text-secondary)',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: 'var(--if-success)',
                boxShadow: '0 0 8px var(--if-success-glow)',
              }}
            />
            <span style={{ fontWeight: 500 }}>
              {accountsCount.ready} Flow Account{accountsCount.ready === 1 ? '' : 's'} Ready
            </span>
          </div>
        </div>

        {/* ERROR BANNER */}
        {errorMsg && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              color: '#fca5a5',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertCircleIcon size={16} />
            <span style={{ flex: 1 }}>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0 }}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        {/* 2. PROMPT COMPOSER CARD */}
        <div
          className="if-card-interactive"
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            backgroundColor: 'var(--if-bg-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '13.5px',
                fontWeight: 600,
                color: 'var(--if-text-primary)',
                letterSpacing: '-0.01em',
              }}
            >
              <VideoIcon size={15} style={{ color: 'var(--if-accent-primary)' }} />
              <span>Video Prompt</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--if-text-muted)' }}>
              {prompt.length} characters
            </span>
          </div>

          {/* Clean Prompt Textarea (no double-border) */}
          <textarea
            ref={textareaRef}
            className="if-composer-textarea"
            aria-label="Scene prompt"
            placeholder="Describe your scene, camera movement, and lighting (e.g. 'Cinematic drone push-in over misty coastal cliffs at dawn, golden hour lighting, 4k quality')..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
          />

          {/* Sample Prompt Chips & Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              paddingTop: '4px',
              borderTop: '1px solid rgba(255, 255, 255, 0.04)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--if-text-muted)', marginRight: '2px' }}>
                Ideas:
              </span>
              {SAMPLE_VIDEO_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setPrompt(chip.prompt)}
                  disabled={isGenerating}
                  style={{
                    padding: '3px 9px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--if-border-card)',
                    color: 'var(--if-text-secondary)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(109, 93, 251, 0.15)';
                    e.currentTarget.style.borderColor = 'var(--if-accent-glow)';
                    e.currentTarget.style.color = '#ffffff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.borderColor = 'var(--if-border-card)';
                    e.currentTarget.style.color = 'var(--if-text-secondary)';
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {prompt.length > 0 && (
              <button
                type="button"
                onClick={() => setPrompt('')}
                disabled={isGenerating}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--if-text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* 3. AI VIDEO MODEL SELECTION (Balanced 2×2 Grid) */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span className="if-section-label">AI Video Model</span>
            <span style={{ fontSize: '11.5px', color: 'var(--if-text-muted)' }}>
              Active: <strong style={{ color: 'var(--if-accent-secondary)' }}>{selectedModel}</strong>
              {' · '}{activeDurationDisplay}
            </span>
          </div>

          <div
            className="if-model-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '12px',
            }}
          >
            {VIDEO_MODELS.map((model) => {
              const isSelected = selectedModel === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  aria-label={model.label}
                  onClick={() => setSelectedModel(model.id)}
                  disabled={isGenerating}
                  className={`if-card-interactive if-model-card ${isSelected ? 'selected' : ''}`}
                  style={{
                    minWidth: 0,
                    width: '100%',
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                >
                  {/* Top Row: Model Name & Tag */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      width: '100%',
                      minWidth: 0,
                      gap: '8px',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: '15px',
                          fontWeight: 650,
                          color: isSelected ? '#ffffff' : 'var(--if-text-primary)',
                          letterSpacing: '-0.01em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {model.label}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: model.badgeColor,
                            color: isSelected ? '#ffffff' : 'var(--if-text-secondary)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {model.badge}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 500,
                            padding: '1px 5px',
                            borderRadius: '3px',
                            backgroundColor: 'rgba(255, 255, 255, 0.04)',
                            color: 'var(--if-text-muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {model.tag}
                        </span>
                      </div>
                    </div>

                    {/* Radio Checkmark */}
                    {isSelected ? (
                      <div
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--if-accent-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          boxShadow: '0 0 10px rgba(109, 93, 251, 0.45)',
                          flexShrink: 0,
                        }}
                      >
                        <CheckIcon size={11} />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          border: '1.5px solid rgba(255, 255, 255, 0.18)',
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>

                  {/* Description */}
                  <p
                    style={{
                      fontSize: '12px',
                      lineHeight: '1.45',
                      color: isSelected ? '#c4cbe0' : 'var(--if-text-secondary)',
                      margin: '6px 0 0 0',
                      whiteSpace: 'normal',
                      overflowWrap: 'break-word',
                      wordBreak: 'break-word',
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {model.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* CONTEXTUAL MODEL OPTIONS PANEL */}
          <div
            style={{
              marginTop: '10px',
              padding: '12px 16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--if-border-card)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              minHeight: '44px',
              boxSizing: 'border-box',
            }}
          >
            {/* Case 1: Veo 3.1 Quality (Fixed 10s Cinema Output Profile) */}
            {selectedModel === 'Veo 3.1 - Quality' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                {/* LEFT: Accent mark & label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span
                    style={{
                      width: '3px',
                      height: '14px',
                      borderRadius: '2px',
                      backgroundColor: '#a855f7',
                      boxShadow: '0 0 8px rgba(168, 85, 247, 0.5)',
                      display: 'inline-block',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 650,
                      color: 'var(--if-text-primary)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Cinema Output
                  </span>
                </div>

                {/* CENTER: Strong fixed-duration badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '5px',
                      backgroundColor: 'rgba(168, 85, 247, 0.16)',
                      color: '#e9d5ff',
                      border: '1px solid rgba(168, 85, 247, 0.35)',
                      boxShadow: '0 0 10px rgba(168, 85, 247, 0.15)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    10s Fixed
                  </span>
                </div>

                {/* RIGHT: Short useful description */}
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--if-text-muted)',
                    textAlign: 'right',
                    flexShrink: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Maximum fidelity for cinematic motion &amp; detail.
                </span>
              </div>
            )}

            {/* Case 2: Veo 3.1 Fast (Fixed 8s Fast Output Profile) */}
            {selectedModel === 'Veo 3.1 - Fast' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                {/* LEFT: Accent mark & label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span
                    style={{
                      width: '3px',
                      height: '14px',
                      borderRadius: '2px',
                      backgroundColor: '#38bdf8',
                      boxShadow: '0 0 8px rgba(56, 189, 248, 0.5)',
                      display: 'inline-block',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 650,
                      color: 'var(--if-text-primary)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Fast Output
                  </span>
                </div>

                {/* CENTER: Strong fixed-duration badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '5px',
                      backgroundColor: 'rgba(56, 189, 248, 0.16)',
                      color: '#bae6fd',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      boxShadow: '0 0 10px rgba(56, 189, 248, 0.15)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    8s Fixed
                  </span>
                </div>

                {/* RIGHT: Short useful description */}
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--if-text-muted)',
                    textAlign: 'right',
                    flexShrink: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Optimized for dynamic motion and rapid iteration.
                </span>
              </div>
            )}

            {/* Case 3: Veo 3.1 Lite (Fixed 8s Efficient Output Profile) */}
            {selectedModel === 'Veo 3.1 - Lite' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                {/* LEFT: Accent mark & label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span
                    style={{
                      width: '3px',
                      height: '14px',
                      borderRadius: '2px',
                      backgroundColor: '#34d399',
                      boxShadow: '0 0 8px rgba(52, 211, 153, 0.5)',
                      display: 'inline-block',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 650,
                      color: 'var(--if-text-primary)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Efficient Output
                  </span>
                </div>

                {/* CENTER: Strong fixed-duration badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '5px',
                      backgroundColor: 'rgba(52, 211, 153, 0.16)',
                      color: '#a7f3d0',
                      border: '1px solid rgba(52, 211, 153, 0.35)',
                      boxShadow: '0 0 10px rgba(52, 211, 153, 0.15)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    8s Fixed
                  </span>
                </div>

                {/* RIGHT: Short useful description */}
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--if-text-muted)',
                    textAlign: 'right',
                    flexShrink: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Lightweight generation with faster turnaround.
                </span>
              </div>
            )}

            {/* Case 3: Omni 1.1 Flash (Provider Toggle + Duration + Resolution) */}
            {selectedModel === 'Omni 1.1 Flash' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                {/* Provider Selector */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--if-text-secondary)', fontWeight: 600 }}>
                      Engine:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setOmniProvider('flow')}
                        disabled={isGenerating}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          backgroundColor: omniProvider === 'flow' ? 'var(--if-accent-primary)' : 'rgba(255, 255, 255, 0.04)',
                          color: omniProvider === 'flow' ? '#ffffff' : 'var(--if-text-secondary)',
                          border: `1px solid ${omniProvider === 'flow' ? 'var(--if-accent-glow)' : 'var(--if-border-card)'}`,
                          boxShadow: omniProvider === 'flow' ? '0 0 10px rgba(109, 93, 251, 0.3)' : 'none',
                        }}
                      >
                        Google Flow
                      </button>
                      <button
                        type="button"
                        onClick={() => setOmniProvider('gemini')}
                        disabled={isGenerating}
                        className={omniProvider === 'gemini' ? 'if-gemini-active-btn' : ''}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          backgroundColor: omniProvider === 'gemini' ? undefined : 'rgba(255, 255, 255, 0.04)',
                          color: omniProvider === 'gemini' ? '#ffffff' : 'var(--if-text-secondary)',
                          border: omniProvider === 'gemini' ? undefined : '1px solid var(--if-border-card)',
                          transition: 'all 0.18s ease',
                        }}
                      >
                        Gemini (Clean)
                      </button>
                    </div>
                  </div>

                  {omniProvider === 'gemini' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(6, 182, 212, 0.12)',
                        color: 'var(--if-cyan)',
                        border: '1px solid rgba(6, 182, 212, 0.35)',
                        boxShadow: '0 0 10px rgba(6, 182, 212, 0.15)',
                        letterSpacing: '0.01em',
                      }}
                    >
                      ✨ Watermark Removed Automatically
                    </span>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: 'var(--if-text-muted)' }}>
                      Native Google Flow Multimodal Pipeline
                    </span>
                  )}
                </div>

                {/* Sub-controls based on Engine */}
                {omniProvider === 'flow' ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '8px' }}>
                    {/* Duration Pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--if-text-secondary)' }}>Duration:</span>
                      {(['4s', '6s', '8s', '10s'] as const).map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() => setOmniDuration(dur)}
                          disabled={isGenerating}
                          style={{
                            padding: '3px 9px',
                            borderRadius: '5px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            backgroundColor: omniDuration === dur ? 'rgba(109, 93, 251, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                            color: omniDuration === dur ? '#ffffff' : 'var(--if-text-secondary)',
                            border: `1px solid ${omniDuration === dur ? 'var(--if-accent-primary)' : 'var(--if-border-card)'}`,
                          }}
                        >
                          {dur}
                        </button>
                      ))}
                    </div>

                    {/* Resolution Pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--if-text-secondary)' }}>Resolution:</span>
                      {(['720p', '360p'] as const).map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => setOmniResolution(res)}
                          disabled={isGenerating}
                          style={{
                            padding: '3px 9px',
                            borderRadius: '5px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            backgroundColor: omniResolution === res ? 'rgba(109, 93, 251, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                            color: omniResolution === res ? '#ffffff' : 'var(--if-text-secondary)',
                            border: `1px solid ${omniResolution === res ? 'var(--if-accent-primary)' : 'var(--if-border-card)'}`,
                          }}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                      paddingTop: '8px',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span
                        style={{
                          width: '3px',
                          height: '14px',
                          borderRadius: '2px',
                          background: 'linear-gradient(180deg, #6d5dfb 0%, #06b6d4 100%)',
                          boxShadow: '0 0 8px rgba(6, 182, 212, 0.5)',
                          display: 'inline-block',
                        }}
                      />
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 650,
                          color: 'var(--if-text-primary)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        Gemini Output
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{ fontSize: '12px', color: 'var(--if-text-secondary)' }}>
                        Gemini Parameters: <strong style={{ color: '#67e8f9' }}>10s Duration</strong> · <strong style={{ color: '#c4b5fd' }}>720p HD</strong>
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--if-text-muted)',
                        textAlign: 'right',
                        flexShrink: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Automatic reverse-alpha watermark removal applied.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 4. ASPECT RATIO (16:9 Landscape & 9:16 Portrait) */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span className="if-section-label">Aspect Ratio</span>
            <span style={{ fontSize: '11.5px', color: 'var(--if-text-muted)' }}>
              Active: <strong style={{ color: 'var(--if-accent-secondary)' }}>{aspectRatio === '16:9' ? '16:9 Landscape' : '9:16 Portrait'}</strong>
            </span>
          </div>

          <div
            className="if-ratio-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '12px',
            }}
          >
            {ASPECT_RATIOS.map((ratio) => {
              const isSelected = aspectRatio === ratio.id;
              return (
                <button
                  key={ratio.id}
                  type="button"
                  aria-label={ratio.label}
                  onClick={() => setAspectRatio(ratio.id)}
                  disabled={isGenerating}
                  className={`if-card-interactive if-ratio-card ${isSelected ? 'selected' : ''}`}
                >
                  {/* Framing Visual Frame */}
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '10px',
                      backgroundColor: isSelected ? 'rgba(109, 93, 251, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1.5px solid ${isSelected ? 'var(--if-accent-primary)' : 'var(--if-border-card)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {ratio.iconType === 'landscape' ? (
                      <div
                        style={{
                          width: '30px',
                          height: '17px',
                          borderRadius: '3px',
                          border: `1.5px solid ${isSelected ? 'var(--if-accent-primary)' : 'var(--if-text-muted)'}`,
                          backgroundColor: isSelected ? 'rgba(109, 93, 251, 0.3)' : 'transparent',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '17px',
                          height: '30px',
                          borderRadius: '3px',
                          border: `1.5px solid ${isSelected ? 'var(--if-accent-primary)' : 'var(--if-text-muted)'}`,
                          backgroundColor: isSelected ? 'rgba(109, 93, 251, 0.3)' : 'transparent',
                        }}
                      />
                    )}
                  </div>

                  {/* Ratio Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 650, color: isSelected ? '#ffffff' : 'var(--if-text-primary)' }}>
                      {ratio.label}
                    </div>
                    <div style={{ fontSize: '12px', color: isSelected ? '#c4cbe0' : 'var(--if-text-secondary)', marginTop: '3px' }}>
                      {ratio.sub}
                    </div>
                  </div>

                  {isSelected ? (
                    <div
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--if-accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        boxShadow: '0 0 10px rgba(109, 93, 251, 0.45)',
                        flexShrink: 0,
                      }}
                    >
                      <CheckIcon size={11} />
                    </div>
                  ) : (
                    <div
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        border: '1.5px solid rgba(255, 255, 255, 0.18)',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. GENERATE PRIMARY CTA */}
        <div
          className="if-cta-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginTop: 'auto',
            paddingTop: '8px',
            paddingBottom: '2px',
          }}
        >
          <button
            type="button"
            className="if-btn-primary if-cta-button"
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            style={{
              height: '50px',
              padding: '12px 32px',
              fontSize: '14.5px',
              fontWeight: 650,
            }}
          >
            <SparklesIcon size={16} />
            <span>Generate Video (x1)</span>
            <span
              style={{
                marginLeft: '6px',
                padding: '2px 7px',
                backgroundColor: 'rgba(255, 255, 255, 0.18)',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              ⌘ Enter
            </span>
          </button>
        </div>

        {/* 6. GENERATED VIDEO RESULT SECTION */}
        {generatedResult && (
          <div
            style={{
              marginTop: '12px',
              padding: '24px',
              backgroundColor: 'var(--if-bg-surface)',
              border: '1px solid var(--if-border-card)',
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
              animation: 'ifFadeIn 0.3s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--if-text-primary)' }}>
                  Generated Video Result
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(46, 211, 167, 0.12)',
                    color: 'var(--if-success)',
                    border: '1px solid var(--if-success-glow)',
                  }}
                >
                  ⚡ {(generatedResult.durationMs / 1000).toFixed(1)}s
                </span>
                {generatedResult.watermarkCleaned && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(6, 182, 212, 0.12)',
                      color: 'var(--if-cyan)',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                    }}
                  >
                    Watermark Cleaned
                  </span>
                )}
              </div>

              {/* Badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    padding: '3px 9px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--if-border-card)',
                    color: 'var(--if-text-secondary)',
                  }}
                >
                  {generatedResult.modelUsed}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    padding: '3px 9px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--if-border-card)',
                    color: 'var(--if-text-secondary)',
                  }}
                >
                  {generatedResult.ratioUsed === '16:9' ? '16:9 Landscape' : '9:16 Portrait'}
                </span>
                {generatedResult.durationFormatted && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      padding: '3px 9px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--if-border-card)',
                      color: 'var(--if-text-secondary)',
                    }}
                  >
                    {generatedResult.durationFormatted}
                  </span>
                )}
              </div>
            </div>

            {/* Video Playback Container */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxHeight: '440px',
                borderRadius: '10px',
                overflow: 'hidden',
                backgroundColor: '#000000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--if-border-card)',
              }}
            >
              <video
                src={formatAssetUrl(generatedResult.mediaPath)}
                poster={generatedResult.thumbnailPath ? formatAssetUrl(generatedResult.thumbnailPath) : undefined}
                controls
                playsInline
                preload="metadata"
                style={{
                  maxWidth: '100%',
                  maxHeight: '440px',
                  objectFit: 'contain',
                }}
              />
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="if-btn-secondary"
                  onClick={handleRevealInFinder}
                  style={{ fontSize: '12px', padding: '7px 14px' }}
                >
                  <FolderIcon size={13} />
                  <span>{revealedInFinder ? 'Revealed' : 'Reveal in Explorer'}</span>
                </button>
                <button
                  type="button"
                  className="if-btn-secondary"
                  onClick={() => setShowPreviewModal(true)}
                  style={{ fontSize: '12px', padding: '7px 14px' }}
                >
                  <EyeIcon size={13} />
                  <span>Full Lightbox</span>
                </button>
                <button
                  type="button"
                  className="if-btn-secondary"
                  onClick={handleCopyPrompt}
                  style={{ fontSize: '12px', padding: '7px 14px' }}
                >
                  <CopyIcon size={13} />
                  <span>{copiedPrompt ? 'Copied' : 'Copy Prompt'}</span>
                </button>
              </div>

              <span style={{ fontSize: '11px', color: 'var(--if-text-muted)' }}>
                Saved to project repository (original native resolution)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 7. FLOATING PROGRESS MODAL */}
      {isProgressModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-gen-progress-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(6, 11, 23, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'ifFadeIn 0.2s ease',
          }}
        >
          <div
            style={{
              width: '460px',
              maxWidth: '92vw',
              backgroundColor: 'var(--if-bg-surface)',
              border: '1px solid var(--if-border-card)',
              borderRadius: '16px',
              padding: '28px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.55), 0 0 40px rgba(109, 93, 251, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <VideoIcon size={18} />
                  <span id="video-gen-progress-title" style={{ fontSize: '16px', fontWeight: 650, color: '#ffffff' }}>
                    Generating Single Video
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--if-text-secondary)', marginTop: '4px' }}>
                  {selectedModel} · {aspectRatio} · {activeDurationDisplay}
                </div>
              </div>

              {/* Elapsed Timer Pill */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--if-border-card)',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--if-accent-secondary)',
                }}
              >
                <ClockIcon size={12} />
                <span>{elapsedSeconds}s</span>
              </div>
            </div>

            {/* Stages Timeline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {STAGES.map((st, idx) => {
                const status = getStageStatus(st.id);
                return (
                  <div
                    key={st.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '12.5px',
                    }}
                  >
                    {/* Status Circle */}
                    <div
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor:
                          status === 'done'
                            ? 'rgba(46, 211, 167, 0.16)'
                            : status === 'active'
                            ? 'rgba(109, 93, 251, 0.22)'
                            : 'rgba(255, 255, 255, 0.03)',
                        color:
                          status === 'done'
                            ? 'var(--if-success)'
                            : status === 'active'
                            ? 'var(--if-accent-secondary)'
                            : 'var(--if-text-muted)',
                        border:
                          status === 'done'
                            ? '1.5px solid var(--if-success-glow)'
                            : status === 'active'
                            ? '1.5px solid var(--if-accent-glow)'
                            : '1.5px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      {status === 'done' ? (
                        <CheckIcon size={12} />
                      ) : status === 'active' ? (
                        <span className="if-spinner" style={{ width: '10px', height: '10px' }} />
                      ) : (
                        idx + 1
                      )}
                    </div>

                    {/* Stage Label */}
                    <span
                      style={{
                        flex: 1,
                        color:
                          status === 'done'
                            ? '#ffffff'
                            : status === 'active'
                            ? '#ffffff'
                            : 'var(--if-text-muted)',
                        fontWeight: status === 'active' ? 600 : 450,
                      }}
                    >
                      {st.label}
                    </span>

                    {/* Active Message */}
                    {status === 'active' && stageMessage && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--if-accent-secondary)',
                          maxWidth: '180px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {stageMessage}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Cancel Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
              <button
                type="button"
                className="if-btn-secondary"
                onClick={() => {
                  if (activeProjectIdRef.current && window.flowApi?.cancelJob && activeJobIdRef.current) {
                    window.flowApi.cancelJob(activeProjectIdRef.current, activeJobIdRef.current).catch(() => {});
                  }
                  setIsGenerating(false);
                  setIsProgressModalOpen(false);
                  setProgressStage('idle');
                }}
                style={{ fontSize: '12px', padding: '7px 16px' }}
              >
                Cancel Generation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. LIGHTBOX PREVIEW MODAL */}
      {showPreviewModal && generatedResult && (
        <MediaPreviewModal
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          type="video"
          mediaUrl={formatAssetUrl(generatedResult.mediaPath)}
          mediaPath={generatedResult.mediaPath}
          title="Generated Video"
          promptText={generatedResult.prompt}
          thumbnailUrl={generatedResult.thumbnailPath ? formatAssetUrl(generatedResult.thumbnailPath) : undefined}
          metadata={{
            model: generatedResult.modelUsed,
            ratio: generatedResult.ratioUsed,
            duration: generatedResult.durationFormatted,
            watermarkCleaned: generatedResult.watermarkCleaned,
          }}
        />
      )}
    </div>
  );
};
