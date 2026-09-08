import React, { useState, useEffect, useMemo } from 'react';
import type {
  SupportedAspectRatio,
  ProfileSessionSnapshot,
} from '../../shared/types';
import { PromptParser } from '../../shared/PromptParser';

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
  onNavigateProfiles,
}) => {
  const [mode, setMode] = useState<GenerationMode>(initialMode);

  // Project Info
  const [projectName, setProjectName] = useState('');
  const [campaignTag, setCampaignTag] = useState('');

  // Prompts
  const [singlePrompt, setSinglePrompt] = useState('');
  const [bulkPromptsText, setBulkPromptsText] = useState('');

  // Common Settings
  const [aspectRatio, setAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [imageDownloadQuality, setImageDownloadQuality] = useState<'original' | '2k'>('original');

  // Video-Specific Settings
  const [videoModel, setVideoModel] = useState<'Omni 1.1 Flash' | 'Veo 3.1 - Quality' | 'Veo 3.1 - Fast' | 'Veo 3.1 - Lite'>('Veo 3.1 - Quality');
  const [omniResolution, setOmniResolution] = useState<'360p' | '720p'>('720p');
  const [omniDuration, setOmniDuration] = useState<'4s' | '6s' | '8s' | '10s'>('6s');
  const [videoDownloadQuality, setVideoDownloadQuality] = useState<'original' | '1080p'>('original');

  // Profiles
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(''); // For single modes
  const [selectedBulkProfileIds, setSelectedBulkProfileIds] = useState<Set<string>>(new Set()); // For bulk modes

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isImageMode = mode === 'single_image' || mode === 'bulk_image';
  const isBulkMode = mode === 'bulk_image' || mode === 'bulk_video';

  // Load profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      if (!window.flowApi) return;
      try {
        const list = await window.flowApi.listProfiles();
        setProfiles(list);

        // Default single profile to first ready profile or first available
        const ready = list.find((p) => p.status === 'ready');
        if (ready) {
          setSelectedProfileId(ready.profileId);
        } else if (list.length > 0) {
          setSelectedProfileId(list[0]!.profileId);
        }

        // Default bulk profiles to all enabled/ready profiles
        const allIds = new Set(list.map((p) => p.profileId));
        setSelectedBulkProfileIds(allIds);
      } catch (err) {
        console.error('Failed to load profiles', err);
      }
    };
    fetchProfiles();
  }, []);

  // Parse bulk prompts
  const parsedBulkPrompts = useMemo(() => {
    if (!isBulkMode) return [];
    return PromptParser.parseRawText(bulkPromptsText, isImageMode ? 'image' : 'video');
  }, [bulkPromptsText, isBulkMode, isImageMode]);

  const activePromptsCount = isBulkMode
    ? parsedBulkPrompts.length
    : singlePrompt.trim().length > 0 ? 1 : 0;

  // Sync mode whenever initialMode prop changes (e.g. from sidebar clicks)
  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
    }
  }, [initialMode]);

  // Set default project name on mode switch if unchanged
  useEffect(() => {
    const modeLabel = mode === 'single_image' ? 'Single Image' : mode === 'single_video' ? 'Single Video' : mode === 'bulk_image' ? 'Bulk Images' : 'Bulk Videos';
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setProjectName(`${modeLabel} - ${nowStr}`);
  }, [mode]);

  const handleApplySampleSinglePrompt = () => {
    const list = isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS;
    const random = list[Math.floor(Math.random() * list.length)]!;
    setSinglePrompt(random);
  };

  const handleApplySampleBulkPrompts = () => {
    const list = isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS;
    setBulkPromptsText(list.join('\n\n'));
  };

  const handleToggleBulkProfile = (profileId: string) => {
    const updated = new Set(selectedBulkProfileIds);
    if (updated.has(profileId)) {
      if (updated.size > 1) {
        updated.delete(profileId);
      }
    } else {
      updated.add(profileId);
    }
    setSelectedBulkProfileIds(updated);
  };

  const handleSelectAllReadyProfiles = () => {
    const readyIds = profiles.filter((p) => p.status === 'ready').map((p) => p.profileId);
    if (readyIds.length > 0) {
      setSelectedBulkProfileIds(new Set(readyIds));
    } else {
      setSelectedBulkProfileIds(new Set(profiles.map((p) => p.profileId)));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.flowApi) return;

    if (activePromptsCount === 0) {
      setErrorMsg(isBulkMode ? 'Please enter at least one prompt line.' : 'Please enter a prompt.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      // Build prompts list
      const promptsList: Array<{ text: string; type: 'image' | 'video' }> = isBulkMode
        ? parsedBulkPrompts.map((p) => ({ text: p.text, type: p.type }))
        : [{ text: singlePrompt.trim(), type: isImageMode ? 'image' : 'video' }];

      // Target profile IDs
      const selectedProfileIds = isBulkMode
        ? Array.from(selectedBulkProfileIds)
        : selectedProfileId ? [selectedProfileId] : undefined;

      const project = await window.flowApi.createProject({
        name: projectName.trim() || `${mode} project`,
        campaignTag: campaignTag.trim() || undefined,
        generationMode: mode,
        imageRatio: isImageMode ? aspectRatio : undefined,
        videoRatio: !isImageMode ? aspectRatio : undefined,
        imageDownloadQuality: isImageMode ? imageDownloadQuality : undefined,
        videoDownloadQuality: !isImageMode ? videoDownloadQuality : undefined,
        videoModel: !isImageMode ? videoModel : undefined,
        videoResolution: !isImageMode ? (videoModel.includes('Omni') ? omniResolution : '720p') : undefined,
        videoDuration: !isImageMode && videoModel.includes('Omni') ? omniDuration : undefined,
        selectedProfileIds,
        prompts: promptsList,
      });

      // Automatically enqueue and start generation
      await window.flowApi.startProjectGeneration(project.projectId);

      onProjectCreated(project.projectId);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
      {/* Studio Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Generation Studio
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Compose, configure, and execute image and video generations with Google Flow
        </p>
      </div>

      {/* 4-Mode Selector Tabs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginBottom: '24px',
        }}
      >
        {[
          { id: 'single_image', label: 'Single Image', desc: '1 Image · Nano Banana 2', icon: '🖼️' },
          { id: 'single_video', label: 'Single Video', desc: '1 Video · Veo 3.1 or Omni', icon: '🎬' },
          { id: 'bulk_image', label: 'Bulk Images', desc: 'Multi-prompt parallel images', icon: '📚' },
          { id: 'bulk_video', label: 'Bulk Videos', desc: 'Multi-prompt parallel videos', icon: '🎥' },
        ].map((tab) => {
          const isActive = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id as GenerationMode)}
              style={{
                background: isActive ? 'var(--primary-gradient)' : 'var(--bg-card)',
                color: isActive ? '#ffffff' : 'var(--text-primary)',
                border: isActive ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isActive ? '0 4px 14px rgba(99, 102, 241, 0.35)' : 'var(--shadow-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '18px' }}>{tab.icon}</span>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{tab.label}</span>
              </div>
              <div style={{ fontSize: '12px', opacity: isActive ? 0.9 : 0.65 }}>
                {tab.desc}
              </div>
            </button>
          );
        })}
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
            marginBottom: '20px',
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

      {/* Main Composer Form */}
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Left Column: Prompts & Project Metadata */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Project Details Card */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px', color: 'var(--text-primary)' }}>
                Project Information
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Project Name *
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter project name..."
                    required
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Campaign Tag (Optional)
                  </label>
                  <input
                    type="text"
                    value={campaignTag}
                    onChange={(e) => setCampaignTag(e.target.value)}
                    placeholder="e.g. Q4 Studio Test"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Prompt Input Card */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {isBulkMode ? 'Bulk Prompts' : 'Prompt'}
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {isBulkMode
                      ? 'Enter multiple prompts separated by newlines (1 permanent slot per line)'
                      : `Enter the prompt for this ${isImageMode ? 'image' : 'video'} generation`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={isBulkMode ? handleApplySampleBulkPrompts : handleApplySampleSinglePrompt}
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                >
                  Insert Sample
                </button>
              </div>

              {!isBulkMode ? (
                <div>
                  <textarea
                    value={singlePrompt}
                    onChange={(e) => setSinglePrompt(e.target.value)}
                    placeholder={
                      isImageMode
                        ? 'e.g. A small red apple resting on a clean white table in a softly lit studio...'
                        : 'e.g. A small red apple resting on a clean white table, gentle cinematic camera push-in...'
                    }
                    rows={6}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>Quantity: exactly x1</span>
                    <span>{singlePrompt.length} characters</span>
                  </div>
                </div>
              ) : (
                <div>
                  <textarea
                    value={bulkPromptsText}
                    onChange={(e) => setBulkPromptsText(e.target.value)}
                    placeholder="Enter one prompt per line...&#10;&#10;Prompt 1 -> Slot #01&#10;Prompt 2 -> Slot #02&#10;Prompt 3 -> Slot #03"
                    rows={8}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      resize: 'vertical',
                      fontFamily: 'monospace',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="badge badge-queued" style={{ fontSize: '11px' }}>
                        {parsedBulkPrompts.length} Slots Assigned
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Permanent slot mapping (0 .. {Math.max(0, parsedBulkPrompts.length - 1)})
                      </span>
                    </div>
                  </div>

                  {/* Live Slot Breakdown Preview for Bulk */}
                  {parsedBulkPrompts.length > 0 && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '10px 12px',
                        backgroundColor: 'var(--bg-input)',
                        borderRadius: 'var(--radius-sm)',
                        maxHeight: '140px',
                        overflowY: 'auto',
                        fontSize: '12px',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      {parsedBulkPrompts.map((p, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            gap: '8px',
                            padding: '4px 0',
                            borderBottom: '1px solid var(--border-subtle)',
                          }}
                        >
                          <span style={{ fontWeight: 700, color: 'var(--primary)', width: '36px', fontFamily: 'var(--font-mono)' }}>
                            #{String(idx + 1).padStart(2, '0')}
                          </span>
                          <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Model, Generation, Export, and Account Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Model & Generation Controls Card */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px', color: 'var(--text-primary)' }}>
                Model & Generation Settings
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Model Selection */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    {isImageMode ? 'Image Model' : 'Video Model'}
                  </label>
                  {isImageMode ? (
                    <div
                      style={{
                        padding: '9px 12px',
                        backgroundColor: 'var(--info-image-bg)',
                        border: '1px solid var(--info-image-border)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--info-image)' }}>
                        Nano Banana 2
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--info-image)', fontWeight: 500 }}>
                        Active Default
                      </span>
                    </div>
                  ) : (
                    <select
                      value={videoModel}
                      onChange={(e) => setVideoModel(e.target.value as any)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        fontSize: '13px',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="Veo 3.1 - Quality">Veo 3.1 - Quality (High Fidelity)</option>
                      <option value="Veo 3.1 - Fast">Veo 3.1 - Fast (Rapid Generation)</option>
                      <option value="Veo 3.1 - Lite">Veo 3.1 - Lite (Lightweight)</option>
                      <option value="Omni 1.1 Flash">Omni 1.1 Flash (Multimodal & Fast)</option>
                    </select>
                  )}
                </div>

                {/* Aspect Ratio */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Aspect Ratio
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {(['16:9', '9:16'] as SupportedAspectRatio[]).map((r) => {
                      const isSel = aspectRatio === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setAspectRatio(r)}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border-color)'}`,
                            backgroundColor: isSel ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-surface)',
                            color: isSel ? '#ffffff' : 'var(--text-secondary)',
                            fontWeight: isSel ? 600 : 500,
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          {r === '16:9' ? '16:9 (Landscape)' : '9:16 (Portrait)'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Video Duration (Contextual: Only for Omni Flash) */}
                {!isImageMode && (
                  <div>
                    {videoModel.includes('Omni') && (
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          Generation Resolution
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          {(['720p', '360p'] as const).map((r) => {
                            const isSel = omniResolution === r;
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setOmniResolution(r)}
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: 'var(--radius-sm)',
                                  border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border-color)'}`,
                                  backgroundColor: isSel ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-surface)',
                                  color: isSel ? '#ffffff' : 'var(--text-secondary)',
                                  fontWeight: isSel ? 600 : 500,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                }}
                              >
                                {r}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Duration
                    </label>
                    {videoModel.includes('Omni') ? (
                      <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                          {(['4s', '6s', '8s', '10s'] as const).map((d) => {
                            const isSel = omniDuration === d;
                            return (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setOmniDuration(d)}
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: 'var(--radius-sm)',
                                  border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border-color)'}`,
                                  backgroundColor: isSel ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-surface)',
                                  color: isSel ? '#ffffff' : 'var(--text-secondary)',
                                  fontWeight: isSel ? 600 : 500,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                }}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Omni 1.1 Flash live duration controls
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '9px 12px',
                          backgroundColor: 'var(--bg-surface)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-color)',
                          fontSize: '12px',
                          color: 'var(--text-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>Native Flow Duration</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--primary)' }}>
                          {videoModel.includes('Quality') ? '4.0s' : '8.0s'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Final Export / Download Quality (NO 4K!) */}
                <div style={{ paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Export / Download Resolution
                  </label>
                  {isImageMode ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {[
                        { id: 'original', label: 'Original (Native)' },
                        { id: '2k', label: '2K Upscaled' },
                      ].map((q) => {
                        const isSel = imageDownloadQuality === q.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => setImageDownloadQuality(q.id as any)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border-color)'}`,
                              backgroundColor: isSel ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-surface)',
                              color: isSel ? '#ffffff' : 'var(--text-secondary)',
                              fontWeight: isSel ? 600 : 500,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {q.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {[
                        { id: 'original', label: 'Original (Native)' },
                        { id: '1080p', label: '1080p Upscaled' },
                      ].map((q) => {
                        const isSel = videoDownloadQuality === q.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => setVideoDownloadQuality(q.id as any)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border-color)'}`,
                              backgroundColor: isSel ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-surface)',
                              color: isSel ? '#ffffff' : 'var(--text-secondary)',
                              fontWeight: isSel ? 600 : 500,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {q.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Account / Profile Selection Card */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {isBulkMode ? 'Account Scheduling' : 'Target Account'}
                </h3>
                {isBulkMode && (
                  <button
                    type="button"
                    onClick={handleSelectAllReadyProfiles}
                    style={{ fontSize: '11px', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Select Ready
                  </button>
                )}
              </div>

              {profiles.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  No Flow profiles configured.{' '}
                  <button
                    type="button"
                    onClick={onNavigateProfiles}
                    style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Manage Profiles
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {profiles.map((p) => {
                    const isReady = p.status === 'ready';
                    const isSelected = isBulkMode
                      ? selectedBulkProfileIds.has(p.profileId)
                      : selectedProfileId === p.profileId;

                    return (
                      <div
                        key={p.profileId}
                        onClick={() => {
                          if (isBulkMode) {
                            handleToggleBulkProfile(p.profileId);
                          } else {
                            setSelectedProfileId(p.profileId);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                          backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-surface)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <input
                            type={isBulkMode ? 'checkbox' : 'radio'}
                            checked={isSelected}
                            onChange={() => {}}
                            style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                          />
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                              {p.displayName}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {p.detectedEmail || 'No account linked'}
                            </div>
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: isReady ? 'var(--success-bg)' : 'var(--bg-subtle)',
                            color: isReady ? 'var(--success)' : 'var(--text-muted)',
                            border: `1px solid ${isReady ? 'var(--success-border)' : 'var(--border-color)'}`,
                            fontWeight: 600,
                          }}
                        >
                          {isReady ? 'Ready' : p.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {isBulkMode && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.4 }}>
                  ✓ Multi-account parallel scheduling enabled. Jobs dispatch concurrently across selected ready profiles.
                </div>
              )}
            </div>

            {/* Launch Actions */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onCancel}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={isSubmitting || activePromptsCount === 0}
                style={{ flex: 2, padding: '10px 16px', fontWeight: 600 }}
              >
                {isSubmitting ? (
                  'Starting Generation...'
                ) : isBulkMode ? (
                  `Generate ${activePromptsCount} ${isImageMode ? 'Images' : 'Videos'}`
                ) : (
                  `Generate ${isImageMode ? 'Image' : 'Video'} (x1)`
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
