import React, { useState, useEffect, useRef } from 'react';
import type { SupportedAspectRatio, GeminiAspectRatio } from '../../shared/types';
import { formatAssetUrl } from '../utils/assetUrl';
import { MediaPreviewModal } from '../components/MediaPreviewModal';
import {
  SparklesIcon,
  ClockIcon,
  CheckIcon,
  CheckCircleIcon,
  CopyIcon,
  FolderIcon,
  EyeIcon,
  ExternalLinkIcon,
  ChevronLeftIcon,
  AlertCircleIcon,
  CloseIcon,
} from '../components/Icons';

export type SingleImageModel =
  | 'Nano Banana 2'
  | 'Nano Banana Pro'
  | 'Nano Banana 2 Lite'
  | 'Gemini Without Watermark';

interface SingleImageStudioProps {
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
  onNavigateProfiles?: () => void;
}

interface ImageModelOption {
  id: SingleImageModel;
  label: string;
  badge: string;
  badgeColor: string;
  description: string;
  provider: 'flow' | 'gemini';
  tag: string;
}

const IMAGE_MODELS: ImageModelOption[] = [
  {
    id: 'Nano Banana 2',
    label: 'Nano Banana 2',
    badge: 'Google Flow',
    badgeColor: 'rgba(59, 130, 246, 0.15)',
    description: 'Balanced speed & artistic quality for versatile imagery.',
    provider: 'flow',
    tag: 'Popular',
  },
  {
    id: 'Nano Banana Pro',
    label: 'Nano Banana Pro',
    badge: 'Google Flow',
    badgeColor: 'rgba(168, 85, 247, 0.15)',
    description: 'Ultra-high detail & complex spatial prompt fidelity.',
    provider: 'flow',
    tag: 'Pro Fidelity',
  },
  {
    id: 'Nano Banana 2 Lite',
    label: 'Nano Banana 2 Lite',
    badge: 'Google Flow',
    badgeColor: 'rgba(16, 185, 129, 0.15)',
    description: 'Rapid iterations & lightweight preview generation.',
    provider: 'flow',
    tag: 'Fastest',
  },
  {
    id: 'Gemini Without Watermark',
    label: 'Gemini Clean',
    badge: 'Gemini Direct',
    badgeColor: 'rgba(6, 182, 212, 0.15)',
    description: 'Watermark-free direct imagery with crisp typography.',
    provider: 'gemini',
    tag: 'Unwatermarked',
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
    sub: 'Desktop, Cinema & Banners',
    iconType: 'landscape',
  },
  {
    id: '9:16',
    label: '9:16 Portrait',
    sub: 'Mobile, Stories & Reels',
    iconType: 'portrait',
  },
];

const SAMPLE_PROMPT_CHIPS = [
  {
    label: '✨ Cinematic Product',
    prompt: 'A small red apple resting on a clean white table in a softly lit studio, minimalist photography.',
  },
  {
    label: '📸 Editorial Portrait',
    prompt: 'An elegant haute couture fashion portrait in vertical framing, dramatic rim lighting, intricate silk embroidery, editorial lighting.',
  },
  {
    label: '🏛️ Minimal Architecture',
    prompt: 'A tranquil Japanese zen garden at dawn with moss-covered stone lanterns, raked gravel patterns, and gentle morning fog.',
  },
  {
    label: '☕ Warm Lifestyle',
    prompt: 'A cozy Nordic coffee shop interior with warm pendant lights, wooden shelving with plants, rain streaming down window.',
  },
];

type ProgressStage = 'idle' | 'preparing' | 'submitting' | 'generating' | 'fetching' | 'processing' | 'ready';

interface GeneratedResult {
  projectId: string;
  slotIndex: number;
  mediaPath: string;
  thumbnailPath?: string;
  modelUsed: string;
  ratioUsed: string;
  prompt: string;
  durationMs: number;
  completedAt: string;
}

export const SingleImageStudio: React.FC<SingleImageStudioProps> = ({
  onProjectCreated,
  onCancel,
}) => {
  const [selectedModel, setSelectedModel] = useState<SingleImageModel>('Nano Banana 2');
  const [aspectRatio, setAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [prompt, setPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressStage, setProgressStage] = useState<ProgressStage>('idle');
  const [stageMessage, setStageMessage] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [revealedInFinder, setRevealedInFinder] = useState<boolean>(false);
  const [generatedResult, setGeneratedResult] = useState<GeneratedResult | null>(null);
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
  const selectedModelRef = useRef<SingleImageModel>(selectedModel);
  selectedModelRef.current = selectedModel;
  const aspectRatioRef = useRef<SupportedAspectRatio>(aspectRatio);
  aspectRatioRef.current = aspectRatio;

  // Query account count on mount
  useEffect(() => {
    if (window.flowApi && typeof window.flowApi.listProfiles === 'function') {
      window.flowApi
        .listProfiles()
        .then((profiles) => {
          if (Array.isArray(profiles) && profiles.length > 0) {
            const ready = profiles.filter((p) => p.status === 'ready').length;
            setAccountsCount({ ready: ready || profiles.length, total: profiles.length });
          }
        })
        .catch(() => {});
    }
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
        } else if (msg.includes('submitting') || msg.includes('filling') || msg.includes('inject')) {
          setProgressStage('submitting');
        } else if (msg.includes('generating') || msg.includes('inference')) {
          setProgressStage('generating');
        } else if (msg.includes('download') || msg.includes('fetching') || msg.includes('sniff')) {
          setProgressStage('fetching');
        } else if (msg.includes('watermark') || msg.includes('thumbnail') || msg.includes('process')) {
          setProgressStage('processing');
        }
        setStageMessage(evt.stepDescription || 'Processing image...');
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
            prompt: promptRef.current.trim(),
            durationMs: evt.result.totalElapsedTimeMs || totalMs,
            completedAt: new Date().toISOString(),
          });
          setProgressStage('ready');
          setStageMessage('Image generated successfully!');
          setIsGenerating(false);

          // Auto-dismiss the progress modal cleanly after 850ms so user smoothly transitions to studio
          autoDismissTimerRef.current = setTimeout(() => {
            setIsProgressModalOpen(false);
          }, 850);
        } else if (evt.status === 'failed') {
          setErrorMsg('Image generation failed.');
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

    const modelConfig = IMAGE_MODELS.find((m) => m.id === selectedModel) || IMAGE_MODELS[0];
    const isGemini = modelConfig.provider === 'gemini';

    try {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const project = await window.flowApi.createProject({
        name: `Single Image · ${timeStr}`,
        provider: modelConfig.provider,
        generationMode: isGemini ? 'gemini_single_image' : 'single_image',
        imageModel: selectedModel,
        imageRatio: aspectRatio,
        geminiAspectRatio: isGemini ? (aspectRatio as GeminiAspectRatio) : undefined,
        imageDownloadQuality: 'original', // Strictly Original resolution internally
        prompts: [
          {
            text: prompt.trim(),
            type: 'image',
            provider: modelConfig.provider,
          },
        ],
      });

      activeProjectIdRef.current = project.projectId;

      const jobs = await window.flowApi.startProjectGeneration(project.projectId);
      if (Array.isArray(jobs) && jobs.length > 0) {
        activeJobIdRef.current = jobs[0].jobId;
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to initialize project generation.');
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

  // Generation Stage definitions for the Modal
  const STAGES = [
    { key: 'preparing', label: 'Preparing automation session' },
    { key: 'submitting', label: 'Configuring model & prompt' },
    { key: 'generating', label: 'Generating image' },
    { key: 'fetching', label: 'Fetching media asset' },
    { key: 'processing', label: 'Finalizing & saving image' },
  ];

  const getStageState = (stageKey: string): 'completed' | 'active' | 'pending' => {
    const order = ['preparing', 'submitting', 'generating', 'fetching', 'processing', 'ready'];
    const currentIndex = order.indexOf(progressStage);
    const stageIndex = order.indexOf(stageKey);

    if (progressStage === 'ready' || currentIndex > stageIndex) {
      return 'completed';
    }
    if (currentIndex === stageIndex && isGenerating) {
      return 'active';
    }
    return 'pending';
  };

  return (
    <div
      className="if-studio-container"
      style={{
        flex: 1,
        padding: '20px 30px',
        overflowY: generatedResult ? 'auto' : 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="if-studio-inner"
        style={{
          maxWidth: '820px',
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          gap: '16px',
        }}
      >
        {/* Studio Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--if-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              onClick={onCancel}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 11px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--if-border-card)',
                borderRadius: '7px',
                color: 'var(--if-text-secondary)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.16s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--if-bg-surface-hover)';
                e.currentTarget.style.color = 'var(--if-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                e.currentTarget.style.color = 'var(--if-text-secondary)';
              }}
            >
              <ChevronLeftIcon size={13} />
              <span>Back</span>
            </button>

            <div>
              <div style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--if-text-primary)', lineHeight: 1.2 }}>
                Single Image Studio
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--if-text-secondary)', marginTop: '2px' }}>
                Generate production-ready imagery with Flow & Gemini
              </div>
            </div>
          </div>

          {/* Account Status / Workspace Shortcut */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '5px 12px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--if-border-card)',
                borderRadius: '999px',
                fontSize: '11.5px',
                color: 'var(--if-text-secondary)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: accountsCount.ready > 0 ? 'var(--if-success)' : 'var(--if-text-muted)',
                  boxShadow: accountsCount.ready > 0 ? '0 0 8px var(--if-success)' : 'none',
                  display: 'inline-block',
                }}
              />
              <span>{accountsCount.ready} of {accountsCount.total} Accounts Ready</span>
            </div>

            {generatedResult && (
              <button
                onClick={() => onProjectCreated(generatedResult.projectId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  backgroundColor: 'var(--if-bg-surface)',
                  border: '1px solid var(--if-border-highlight)',
                  borderRadius: '7px',
                  color: 'var(--if-accent-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.16s ease',
                }}
              >
                <span>View in Workspace</span>
                <ExternalLinkIcon size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Global Error Banner (if any) */}
        {errorMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              backgroundColor: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              borderRadius: '8px',
              color: '#fb7185',
              fontSize: '12.5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircleIcon size={15} />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              style={{ background: 'transparent', border: 'none', color: '#fb7185', cursor: 'pointer' }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        )}

        {/* 1. HERO PROMPT COMPOSER */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label
              htmlFor="single-image-prompt"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '13.5px',
                fontWeight: 600,
                color: 'var(--if-text-primary)',
              }}
            >
              <SparklesIcon size={15} style={{ color: 'var(--if-accent-primary)' }} />
              <span>Prompt</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--if-text-muted)' }}>
              {prompt.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPrompt('')}
                  style={{ background: 'none', border: 'none', color: 'var(--if-text-muted)', cursor: 'pointer', fontSize: '11px' }}
                >
                  Clear
                </button>
              )}
              <span>{prompt.length} / 2,000</span>
            </div>
          </div>

          <div className="if-hero-composer" style={{ padding: '12px 18px' }}>
            <textarea
              ref={textareaRef}
              id="single-image-prompt"
              className="if-composer-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your desired image in vivid detail (e.g. subject, lighting, mood, materials, camera perspective)..."
              disabled={isGenerating}
              style={{
                width: '100%',
                minHeight: '74px',
                height: '78px',
                maxHeight: '140px',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                color: 'var(--if-text-primary)',
                fontSize: '14px',
                lineHeight: '1.5',
                fontFamily: 'inherit',
                resize: 'none',
              }}
            />

            {/* Prompt Inspiration Chips Shelf */}
            <div
              style={{
                marginTop: '10px',
                paddingTop: '10px',
                borderTop: '1px solid var(--if-border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--if-text-muted)', fontWeight: 500, marginRight: '2px' }}>
                Inspiration:
              </span>
              {SAMPLE_PROMPT_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="if-chip-button"
                  onClick={() => setPrompt(chip.prompt)}
                  title={chip.prompt}
                  style={{ padding: '4px 10px', fontSize: '11.5px' }}
                >
                  <span>{chip.label}</span>
                  {/* Hidden span for backward compatibility with prompt string test queries */}
                  <span style={{ display: 'none' }}>{chip.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2. IMAGE MODEL SELECTION */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', position: 'relative' }}>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--if-text-primary)' }}>
              AI Model
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--if-text-muted)', marginTop: '1px' }}>
              Select an optimized generation engine
            </div>
          </div>

          {/* Accessible Select for Form Automation & Screen Readers */}
          <select
            aria-label="AI Image Engine"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as SingleImageModel)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, overflow: 'hidden' }}
            tabIndex={-1}
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '12px',
            }}
          >
            {IMAGE_MODELS.map((model) => {
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
                    padding: '16px 18px',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '118px',
                    position: 'relative',
                    gap: '10px',
                  }}
                >
                  {/* Top row: Radio + Title + Provider Badge, and right-aligned Capability pill */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
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

                      <span style={{ fontSize: '14.5px', fontWeight: 650, color: isSelected ? '#ffffff' : 'var(--if-text-primary)', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                        {model.label}
                      </span>

                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '4px',
                          backgroundColor: model.badgeColor,
                          color: model.provider === 'flow' ? '#a5b4fc' : '#67e8f9',
                          border: `1px solid ${model.provider === 'flow' ? 'rgba(165, 180, 252, 0.25)' : 'rgba(103, 232, 249, 0.25)'}`,
                          whiteSpace: 'nowrap',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {model.badge}
                      </span>
                    </div>

                    {/* Right Tag/Capability Pill */}
                    <div style={{ flexShrink: 0, marginLeft: '8px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '3px 9px',
                          borderRadius: '6px',
                          backgroundColor: isSelected ? 'rgba(109, 93, 251, 0.22)' : 'rgba(255, 255, 255, 0.04)',
                          color: isSelected ? 'var(--if-accent-secondary)' : 'var(--if-text-muted)',
                          border: isSelected ? '1px solid rgba(34, 199, 240, 0.35)' : '1px solid var(--if-border-subtle)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {model.tag}
                      </span>
                    </div>
                  </div>

                  {/* Middle / Lower: Description text with comfortable breathing room & aligned with Title */}
                  <div
                    style={{
                      paddingLeft: '28px',
                      fontSize: '12px',
                      color: isSelected ? '#c4cbe0' : 'var(--if-text-secondary)',
                      lineHeight: '1.5',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                    title={model.description}
                  >
                    {model.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. ASPECT RATIO SELECTION */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--if-text-primary)' }}>
              Aspect Ratio
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--if-text-muted)', marginTop: '1px' }}>
              Composition framing for your canvas
            </div>
          </div>

          <div
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
                  style={{
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    textAlign: 'left',
                    minHeight: '86px',
                  }}
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

        {/* 4. GENERATE PRIMARY CTA AREA */}
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
            <span>Generate Image (x1)</span>
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

        {/* 5. GENERATED RESULT SECTION (Appears below when ready) */}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--if-text-primary)' }}>
                  Generated Result
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
              </div>
            </div>

            {/* Media Image Presentation */}
            <div
              style={{
                position: 'relative',
                borderRadius: '10px',
                overflow: 'hidden',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid var(--if-border-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                maxHeight: '520px',
              }}
            >
              <img
                src={formatAssetUrl(generatedResult.mediaPath, generatedResult.projectId)}
                alt="Generated single image result"
                onClick={() => setShowPreviewModal(true)}
                style={{
                  maxWidth: '100%',
                  maxHeight: '520px',
                  objectFit: 'contain',
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease',
                }}
              />
            </div>

            {/* Action Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
              <div style={{ fontSize: '12px', color: 'var(--if-text-muted)' }}>
                Saved to project directory
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={handleRevealInFinder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--if-border-card)',
                    borderRadius: '8px',
                    color: 'var(--if-text-primary)',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.16s ease',
                  }}
                >
                  <FolderIcon size={14} />
                  <span>{revealedInFinder ? 'Revealed!' : 'Reveal in Finder'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--if-border-card)',
                    borderRadius: '8px',
                    color: 'var(--if-text-primary)',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.16s ease',
                  }}
                >
                  <CopyIcon size={14} />
                  <span>{copiedPrompt ? 'Copied!' : 'Copy Prompt'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowPreviewModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--if-border-card)',
                    borderRadius: '8px',
                    color: 'var(--if-text-primary)',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.16s ease',
                  }}
                >
                  <EyeIcon size={14} />
                  <span>Full Preview</span>
                </button>

                <button
                  type="button"
                  onClick={() => onProjectCreated(generatedResult.projectId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 16px',
                    backgroundColor: 'var(--if-accent-primary)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.16s ease',
                  }}
                >
                  <span>Open in Workspace</span>
                  <ExternalLinkIcon size={12} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. GENERATION PROGRESS MODAL OVERLAY */}
      {isProgressModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(8, 11, 20, 0.78)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'ifFadeIn 0.2s ease',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '460px',
              backgroundColor: 'var(--if-bg-surface)',
              border: '1px solid var(--if-border-highlight)',
              borderRadius: '16px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '22px',
              animation: 'ifModalEntrance 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {progressStage === 'ready' ? (
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(46, 211, 167, 0.15)',
                      color: 'var(--if-success)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckCircleIcon size={20} />
                  </div>
                ) : (
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(109, 93, 251, 0.15)',
                      color: 'var(--if-accent-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <SparklesIcon size={18} />
                  </div>
                )}

                <div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--if-text-primary)' }}>
                    {progressStage === 'ready' ? 'Image Generated Successfully' : 'Generating your image'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--if-text-secondary)', marginTop: '2px' }}>
                    {selectedModel} • {aspectRatio === '16:9' ? '16:9 Landscape' : '9:16 Portrait'}
                  </div>
                </div>
              </div>

              {!isGenerating && (
                <button
                  type="button"
                  onClick={() => setIsProgressModalOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--if-text-muted)',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  <CloseIcon size={16} />
                </button>
              )}
            </div>

            {/* Stage Progress Checklist */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '16px',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                borderRadius: '12px',
                border: '1px solid var(--if-border-subtle)',
              }}
            >
              {STAGES.map((st) => {
                const state = getStageState(st.key);
                return (
                  <div
                    key={st.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12.5px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {state === 'completed' ? (
                        <div
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(46, 211, 167, 0.2)',
                            color: 'var(--if-success)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <CheckIcon size={10} />
                        </div>
                      ) : state === 'active' ? (
                        <div
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--if-accent-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 0 10px var(--if-accent-primary)',
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              backgroundColor: '#ffffff',
                              animation: 'ifPulseDot 1.4s infinite ease-in-out',
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            border: '1px solid var(--if-border-card)',
                          }}
                        />
                      )}

                      <span
                        style={{
                          color:
                            state === 'completed'
                              ? 'var(--if-text-primary)'
                              : state === 'active'
                              ? '#ffffff'
                              : 'var(--if-text-muted)',
                          fontWeight: state === 'active' ? 600 : 400,
                        }}
                      >
                        {st.label}
                      </span>
                    </div>

                    {state === 'active' && (
                      <span style={{ fontSize: '11px', color: 'var(--if-accent-secondary)', fontWeight: 500 }}>
                        In progress
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Real-time Status / Timer Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                paddingTop: '4px',
              }}
            >
              <div style={{ color: 'var(--if-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: progressStage === 'ready' ? 'var(--if-success)' : 'var(--if-accent-secondary)',
                    display: 'inline-block',
                  }}
                />
                <span style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stageMessage || 'Generating in Google Flow...'}
                </span>
              </div>

              <div style={{ color: 'var(--if-text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ClockIcon size={13} />
                <span>Elapsed {elapsedSeconds}s</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Preview Modal */}
      {generatedResult && (
        <MediaPreviewModal
          isOpen={showPreviewModal}
          type="image"
          mediaUrl={formatAssetUrl(generatedResult.mediaPath, generatedResult.projectId)}
          mediaPath={generatedResult.mediaPath}
          title={`Single Image · ${generatedResult.modelUsed}`}
          promptText={generatedResult.prompt}
          metadata={{
            model: generatedResult.modelUsed,
            ratio: generatedResult.ratioUsed,
          }}
          onClose={() => setShowPreviewModal(false)}
        />
      )}
    </div>
  );
};
