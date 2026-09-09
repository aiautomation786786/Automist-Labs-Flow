import React, { useState, useMemo } from 'react';
import type {
  SupportedAspectRatio,
} from '../../shared/types';
import { PromptParser } from '../../shared/PromptParser';
import { SUPPORTED_IMAGE_MODELS, getImageModelConfig } from '../../shared/image-models';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  ImageIcon,
  VideoIcon,
  LayersIcon,
  ClapperboardIcon,
  SparklesIcon,
  ClockIcon,
} from '../components/Icons';

export type GenerationMode = 'single_image' | 'single_video' | 'bulk_image' | 'bulk_video';

interface GenerationStudioScreenProps {
  initialMode?: GenerationMode;
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
  onNavigateProfiles: () => void;
}

const SAMPLE_IMAGE_PROMPTS = [
  'A small red apple resting on a clean white table in a softly lit studio, minimalist photography.',
  'A vibrant blue ceramic coffee mug on a rustic wooden desk with warm morning sunlight streaming through a window.',
  'A succulent plant in a sleek white ceramic pot, bright daylight, hyper-detailed natural textures.',
  'A vintage leather notebook and brass fountain pen on dark walnut wood, cinematic warm lighting.',
];

const SAMPLE_VIDEO_PROMPTS = [
  'A small red apple resting on a clean white table in a softly lit studio, with a gentle cinematic camera push-in and realistic natural movement.',
  'A blue ceramic coffee mug on a wooden desk, morning sunlight streaming through a window, subtle steam rising gently.',
  'A green succulent plant in a white ceramic pot, bright studio lighting, delicate cinematic camera orbit.',
  'A crystal glass of water with ice cubes melting slowly, soft reflections and realistic fluid refractions.',
];

export const GenerationStudioScreen: React.FC<GenerationStudioScreenProps> = ({
  initialMode = 'single_image',
  onProjectCreated,
  onCancel,
  onNavigateProfiles: _onNavigateProfiles,
}) => {
  const [mode] = useState<GenerationMode>(initialMode);
  const [projectName, setProjectName] = useState(() => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (initialMode === 'single_image') return `Single Image · ${time}`;
    if (initialMode === 'single_video') return `Single Video · ${time}`;
    if (initialMode === 'bulk_image') return `Bulk Images · ${time}`;
    return `Bulk Videos · ${time}`;
  });
  const [campaignTag, setCampaignTag] = useState('');

  // Prompts
  const [singlePrompt, setSinglePrompt] = useState('');
  const [bulkPromptsText, setBulkPromptsText] = useState('');

  // Common Settings
  const [aspectRatio, setAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [imageModel, setImageModel] = useState<string>('Nano Banana 2');
  const [imageDownloadQuality, setImageDownloadQuality] = useState<'original' | '2k'>('original');

  // Video-Specific Settings
  const [videoModel, setVideoModel] = useState<'Omni 1.1 Flash' | 'Veo 3.1 - Quality' | 'Veo 3.1 - Fast' | 'Veo 3.1 - Lite'>('Veo 3.1 - Quality');
  const [veoDuration, setVeoDuration] = useState<'4s' | '6s' | '8s'>('8s');
  const [omniResolution, setOmniResolution] = useState<'360p' | '720p'>('720p');
  const [omniDuration, setOmniDuration] = useState<'4s' | '6s' | '8s' | '10s'>('6s');
  const [videoDownloadQuality, setVideoDownloadQuality] = useState<'original' | '1080p'>('original');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isImageMode = mode === 'single_image' || mode === 'bulk_image';
  const isBulkMode = mode === 'bulk_image' || mode === 'bulk_video';

  const parsedBulkPrompts = useMemo(() => {
    if (!isBulkMode) return [];
    return PromptParser.parseRawText(bulkPromptsText, isImageMode ? 'image' : 'video');
  }, [bulkPromptsText, isBulkMode, isImageMode]);

  const activePromptsCount = isBulkMode
    ? parsedBulkPrompts.length
    : singlePrompt.trim().length > 0
    ? 1
    : 0;

  const handleApplySampleSinglePrompt = (sample?: string) => {
    if (sample) {
      setSinglePrompt(sample);
      return;
    }
    const list = isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS;
    const random = list[Math.floor(Math.random() * list.length)]!;
    setSinglePrompt(random);
  };

  const handleApplySampleBulkPrompts = () => {
    const list = isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS;
    const joined = list.join('\n\n');
    setBulkPromptsText(joined);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.flowApi) return;

    // Immediately parse live text for submission to ensure zero drop if user submits quickly
    const liveParsedBulk = isBulkMode
      ? PromptParser.parseRawText(bulkPromptsText, isImageMode ? 'image' : 'video')
      : [];
    const submissionPromptsCount = isBulkMode
      ? liveParsedBulk.length
      : singlePrompt.trim().length > 0
      ? 1
      : 0;

    if (submissionPromptsCount === 0) {
      setErrorMsg(isBulkMode ? 'Please enter at least one prompt line.' : 'Please enter a creative prompt.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const promptsList: Array<{ text: string; type: 'image' | 'video' }> = isBulkMode
        ? liveParsedBulk.map((p) => ({ text: p.text, type: p.type }))
        : [{ text: singlePrompt.trim(), type: isImageMode ? 'image' : 'video' }];

      const project = await window.flowApi.createProject({
        name: projectName.trim() || `${mode} project`,
        campaignTag: campaignTag.trim() || undefined,
        generationMode: mode,
        imageModel: isImageMode ? imageModel : undefined,
        imageRatio: isImageMode ? aspectRatio : undefined,
        videoRatio: !isImageMode ? aspectRatio : undefined,
        imageDownloadQuality: isImageMode ? imageDownloadQuality : undefined,
        videoDownloadQuality: !isImageMode ? videoDownloadQuality : undefined,
        videoModel: !isImageMode ? videoModel : undefined,
        videoResolution: !isImageMode ? (videoModel.includes('Omni') ? omniResolution : '720p') : undefined,
        videoDuration: !isImageMode
          ? videoModel === 'Veo 3.1 - Quality'
            ? '8s'
            : videoModel.includes('Omni')
            ? omniDuration
            : veoDuration
          : undefined,
        // No selectedProfileIds — the WorkerPool automatically picks an available account
        prompts: promptsList,
      });

      await window.flowApi.startProjectGeneration(project.projectId);
      onProjectCreated(project.projectId);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setIsSubmitting(false);
    }
  };


  return (
    <div className="studio-canvas">
      {/* Studio Header (Unboxed & Minimalist) */}
      <div className="studio-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isImageMode ? 'var(--info-image-bg)' : 'var(--info-video-bg)',
                color: isImageMode ? 'var(--info-image)' : 'var(--info-video)',
                border: `1px solid ${isImageMode ? 'var(--info-image-border)' : 'var(--info-video-border)'}`,
              }}
            >
              {mode === 'single_image' && <ImageIcon size={18} />}
              {mode === 'single_video' && <VideoIcon size={18} />}
              {mode === 'bulk_image' && <LayersIcon size={18} />}
              {mode === 'bulk_video' && <ClapperboardIcon size={18} />}
            </span>
            <h1 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {mode === 'single_image' && 'Single Image Studio'}
              {mode === 'single_video' && 'Single Video Studio'}
              {mode === 'bulk_image' && 'Bulk Image Studio'}
              {mode === 'bulk_video' && 'Bulk Video Studio'}
            </h1>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '999px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >
              {isImageMode ? imageModel : videoModel}
            </span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {mode === 'single_image' && 'Generate high-fidelity imagery with prompt styling and 2K upscale export'}
            {mode === 'single_video' && 'Generate cinematic motion with Veo 3.1 & Omni 1.1 with 1080p upscale export'}
            {mode === 'bulk_image' && 'High-throughput multi-prompt parallel image generation mapped across Flow accounts'}
            {mode === 'bulk_video' && 'Multi-scene parallel cinematic video generation dispatched across Flow accounts'}
          </p>
        </div>

        {/* Inline Project Name & Campaign Tag Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Project Name</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name..."
              style={{
                fontSize: '12.5px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                width: '180px',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Campaign Tag</span>
            <input
              type="text"
              value={campaignTag}
              onChange={(e) => setCampaignTag(e.target.value)}
              placeholder="e.g. Q4 Studio Test"
              style={{
                fontSize: '12.5px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                width: '130px',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
              }}
            />
          </div>
        </div>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-md)',
            color: '#fb7185',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            style={{ background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontWeight: 600 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Creative Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Creative Prompt Composer (Hero Element) */}
        <div className="prompt-hero-container">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SparklesIcon size={16} style={{ color: 'var(--primary)' }} />
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                {isBulkMode ? 'Batch Prompt Composer' : 'Creative Prompt Composer'}
              </span>
            </div>
            {isBulkMode ? (
              <button
                type="button"
                className="sample-chip"
                onClick={handleApplySampleBulkPrompts}
              >
                + Insert Sample Batch
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                {(isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS).slice(0, 2).map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="sample-chip"
                    onClick={() => handleApplySampleSinglePrompt(s)}
                    title={s}
                  >
                    + Sample #{idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!isBulkMode ? (
            <div>
              <textarea
                value={singlePrompt}
                onChange={(e) => setSinglePrompt(e.target.value)}
                placeholder={
                  isImageMode
                    ? 'Describe your desired image with artistic precision (e.g. A small red apple resting on a clean white table in a softly lit studio, minimalist photography...)'
                    : 'Describe camera movement and cinematography (e.g. A small red apple resting on a clean white table in a softly lit studio, with a gentle cinematic camera push-in...)'
                }
                rows={5}
                style={{
                  width: '100%',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '14.5px',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  padding: '4px 0',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                  marginTop: '8px',
                }}
              >
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span>Scope: <strong>1 item</strong></span>
                  <span>Engine: <strong style={{ color: 'var(--text-secondary)' }}>{isImageMode ? imageModel : videoModel}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {singlePrompt.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSinglePrompt('')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11.5px', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {singlePrompt.length} chars
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <textarea
                value={bulkPromptsText}
                onChange={(e) => setBulkPromptsText(e.target.value)}
                placeholder="Enter one creative prompt per line...&#10;&#10;Prompt 1 -> Slot #01&#10;Prompt 2 -> Slot #02&#10;Prompt 3 -> Slot #03"
                rows={7}
                style={{
                  width: '100%',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '13.5px',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                  fontFamily: 'var(--font-mono)',
                  padding: '4px 0',
                }}
              />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                  marginTop: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: parsedBulkPrompts.length > 0 ? 'var(--primary-subtle)' : 'var(--bg-subtle)',
                      color: parsedBulkPrompts.length > 0 ? '#a5b4fc' : 'var(--text-muted)',
                      border: `1px solid ${parsedBulkPrompts.length > 0 ? 'var(--primary-border)' : 'var(--border-color)'}`,
                    }}
                  >
                    {parsedBulkPrompts.length} {parsedBulkPrompts.length === 1 ? 'Slot' : 'Slots'} Assigned
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Permanent slot mapping (0 .. {Math.max(0, parsedBulkPrompts.length - 1)})
                  </span>
                </div>

                {bulkPromptsText.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setBulkPromptsText('')}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11.5px', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Live Scene / Slot Breakdown Preview */}
              {parsedBulkPrompts.length > 0 && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: 'var(--radius-sm)',
                    maxHeight: '120px',
                    overflowY: 'auto',
                    fontSize: '12px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {parsedBulkPrompts.slice(0, 30).map((p, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '3px 0',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--primary)', width: '60px', fontFamily: 'var(--font-mono)' }}>
                        {mode === 'bulk_video' ? `${String(idx + 1).padStart(2, '0')} Scene` : `#${String(idx + 1).padStart(2, '0')}`}
                      </span>
                      <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.text}
                      </span>
                    </div>
                  ))}
                  {parsedBulkPrompts.length > 30 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '6px 0', textAlign: 'center' }}>
                      + {parsedBulkPrompts.length - 30} more scenes assigned...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Unboxed Controls Row (Segmented Controls & Surfaces) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {/* Aspect Ratio & Model Block */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Aspect Ratio */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Aspect Ratio
              </label>
              <SegmentedControl<SupportedAspectRatio>
                options={[
                  { value: '16:9', label: '16:9 Landscape', icon: '📐' },
                  { value: '9:16', label: '9:16 Portrait', icon: '📱' },
                ]}
                value={aspectRatio}
                onChange={(val) => setAspectRatio(val)}
                fullWidth
              />
            </div>

            {/* Model Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isImageMode ? 'AI Image Engine' : 'AI Video Model'}
              </label>
              {isImageMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <select
                    aria-label="AI Image Engine"
                    value={imageModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setImageModel(newModel);
                      const config = getImageModelConfig(newModel);
                      if (!config.supports2k && imageDownloadQuality === '2k') {
                        setImageDownloadQuality('original');
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {SUPPORTED_IMAGE_MODELS.map((m) => (
                      <option key={m.id} value={m.displayName}>
                        {m.displayName} ({m.badge})
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {getImageModelConfig(imageModel).description}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <select
                    aria-label="AI Video Model"
                    value={videoModel}
                    onChange={(e) => setVideoModel(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="Veo 3.1 - Quality">Veo 3.1 - Quality (High Fidelity Cinema)</option>
                    <option value="Veo 3.1 - Fast">Veo 3.1 - Fast (Rapid Generation)</option>
                    <option value="Veo 3.1 - Lite">Veo 3.1 - Lite (Lightweight)</option>
                    <option value="Omni 1.1 Flash">Omni 1.1 Flash (Multimodal & Fast)</option>
                  </select>

                  {/* Context-Sensitive Duration & Resolution */}
                  {videoModel.includes('Omni') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Omni Duration
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Omni 1.1 Flash live duration controls
                        </span>
                      </div>
                      <SegmentedControl<'4s' | '6s' | '8s' | '10s'>
                        options={[
                          { value: '4s', label: '4s' },
                          { value: '6s', label: '6s' },
                          { value: '8s', label: '8s' },
                          { value: '10s', label: '10s' },
                        ]}
                        value={omniDuration}
                        onChange={(d) => setOmniDuration(d)}
                        size="sm"
                        fullWidth
                      />

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Omni Generation Resolution
                        </span>
                      </div>
                      <SegmentedControl<'360p' | '720p'>
                        options={[
                          { value: '360p', label: '360p' },
                          { value: '720p', label: '720p' },
                        ]}
                        value={omniResolution}
                        onChange={(r) => setOmniResolution(r)}
                        size="sm"
                        fullWidth
                      />
                    </div>
                  ) : videoModel === 'Veo 3.1 - Quality' ? (
                    /* Model-Specific Native Flow Duration (Veo Quality -> 8s Cinema Default) */
                    <div className="native-info-pill">
                      <ClockIcon size={14} />
                      <span>Native Flow Duration:</span>
                      <strong style={{ color: '#ffffff' }}>8s</strong>
                      <span style={{ opacity: 0.8, fontSize: '11px' }}>
                        (Cinema Quality Default)
                      </span>
                    </div>
                  ) : (
                    /* Veo 3.1 Fast & Lite -> Supported 4s, 6s, 8s Controls (Default 8s) */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Veo Duration
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Supported 4s, 6s, or 8s generation
                        </span>
                      </div>
                      <SegmentedControl<'4s' | '6s' | '8s'>
                        options={[
                          { value: '4s', label: '4s' },
                          { value: '6s', label: '6s' },
                          { value: '8s', label: '8s (Default)' },
                        ]}
                        value={veoDuration}
                        onChange={(d) => setVeoDuration(d)}
                        size="sm"
                        fullWidth
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Export Quality & Target Account Block */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Export Resolution (STRICT: NO 4K!) */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Export Resolution
              </label>
              {isImageMode ? (
                <SegmentedControl<'original' | '2k'>
                  options={[
                    { value: 'original', label: 'Original (Native)' },
                    {
                      value: '2k',
                      label: '2K Upscaled',
                      badge: !getImageModelConfig(imageModel).supports2k ? 'Unavailable' : 'HD',
                      disabled: !getImageModelConfig(imageModel).supports2k,
                    },
                  ]}
                  value={imageDownloadQuality}
                  onChange={(val) => setImageDownloadQuality(val)}
                  fullWidth
                />
              ) : (
                <SegmentedControl<'original' | '1080p'>
                  options={[
                    { value: 'original', label: 'Original (Native)' },
                    { value: '1080p', label: '1080p Upscaled', badge: 'FHD' },
                  ]}
                  value={videoDownloadQuality}
                  onChange={(val) => setVideoDownloadQuality(val)}
                  fullWidth
                />
              )}
            </div>

            {/* Automatic Account Dispatch */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Account Dispatch
              </label>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--primary-border)',
                  backgroundColor: 'var(--primary-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ fontSize: '16px' }}>⚡</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    Automatic Worker Dispatch
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {isBulkMode
                      ? 'Jobs are distributed across all ready accounts automatically. Multiple profiles run concurrently; same-profile jobs run sequentially.'
                      : 'The next available ready account is selected automatically. No manual selection needed.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Commanding Floating / Dock Action Bar */}
        <div className="action-bar-floating">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isBulkMode
                  ? `${activePromptsCount} ${isImageMode ? 'Images' : 'Videos'} Planned`
                  : `1 ${isImageMode ? 'Image' : 'Video'} Prepared`}
              </span>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                {isImageMode
                  ? `${imageModel} · ${aspectRatio} · ${imageDownloadQuality === '2k' ? '2K Upscale' : 'Original'}`
                  : `${videoModel} · ${aspectRatio} · ${videoDownloadQuality === '1080p' ? '1080p Upscale' : 'Original'}`}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
              style={{ padding: '10px 18px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-hero"
              disabled={isSubmitting || activePromptsCount === 0}
            >
              {isSubmitting ? (
                <span>Starting Generation...</span>
              ) : isBulkMode ? (
                <span>Generate {activePromptsCount} {isImageMode ? 'Images' : 'Videos'} in Parallel</span>
              ) : (
                <span>Generate {isImageMode ? 'Image' : 'Video'} (x1)</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
