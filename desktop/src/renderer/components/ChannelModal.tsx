import React, { useState, useEffect } from 'react';
import type {
  ChannelEntity,
  SupportedAspectRatio,
  MotionStyle,
  TransitionStyle,
} from '../../shared/types';
import { FolderIcon, AlertCircleIcon } from './Icons';

interface ChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (channel: ChannelEntity) => void;
  initialChannel?: ChannelEntity | null;
}

export const ChannelModal: React.FC<ChannelModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialChannel,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Destinations
  const [outputDir, setOutputDir] = useState('');
  const [shortsOutputDir, setShortsOutputDir] = useState('');
  const [longsOutputDir, setLongsOutputDir] = useState('');

  // Rulebook
  const [narrationStyle, setNarrationStyle] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [titleStyle, setTitleStyle] = useState('');
  const [tone, setTone] = useState('');
  const [contentRestrictions, setContentRestrictions] = useState('');
  const [promptGuidelines, setPromptGuidelines] = useState('');
  const [rawMarkdown, setRawMarkdown] = useState('');

  // Presets
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [defaultVoiceId, setDefaultVoiceId] = useState('en-US-ChristopherNeural');
  const [defaultMotionStyle, setDefaultMotionStyle] = useState<MotionStyle>('breathe');
  const [defaultSubtitleStyle, setDefaultSubtitleStyle] = useState('bottom_glass');
  const [defaultTransitionStyle, setDefaultTransitionStyle] = useState<TransitionStyle>('hard_cut');

  const [activeTab, setActiveTab] = useState<'general' | 'rulebook' | 'destinations' | 'presets'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialChannel) {
      setName(initialChannel.name || '');
      setDescription(initialChannel.description || '');
      setEnabled(initialChannel.enabled ?? true);
      setOutputDir(initialChannel.outputDir || '');
      setShortsOutputDir(initialChannel.shortsOutputDir || '');
      setLongsOutputDir(initialChannel.longsOutputDir || '');

      setNarrationStyle(initialChannel.rulebook?.narrationStyle || '');
      setVisualStyle(initialChannel.rulebook?.visualStyle || '');
      setTitleStyle(initialChannel.rulebook?.titleStyle || '');
      setTone(initialChannel.rulebook?.tone || '');
      setContentRestrictions(initialChannel.rulebook?.contentRestrictions || '');
      setPromptGuidelines(initialChannel.rulebook?.promptGuidelines || '');
      setRawMarkdown(initialChannel.rulebook?.rawMarkdown || '');

      setDefaultAspectRatio(initialChannel.defaultAspectRatio || '16:9');
      setDefaultVoiceId(initialChannel.defaultVoiceId || 'en-US-ChristopherNeural');
      setDefaultMotionStyle(initialChannel.defaultMotionStyle || 'breathe');
      setDefaultSubtitleStyle(initialChannel.defaultSubtitleStyle || 'bottom_glass');
      setDefaultTransitionStyle(initialChannel.defaultTransitionStyle || 'hard_cut');
    } else {
      setName('');
      setDescription('');
      setEnabled(true);
      setOutputDir('');
      setShortsOutputDir('');
      setLongsOutputDir('');
      setNarrationStyle('');
      setVisualStyle('');
      setTitleStyle('');
      setTone('');
      setContentRestrictions('');
      setPromptGuidelines('');
      setRawMarkdown('');
      setDefaultAspectRatio('16:9');
      setDefaultVoiceId('en-US-ChristopherNeural');
      setDefaultMotionStyle('breathe');
      setDefaultSubtitleStyle('bottom_glass');
      setDefaultTransitionStyle('hard_cut');
    }
    setError(null);
    setActiveTab('general');
  }, [initialChannel, isOpen]);

  if (!isOpen) return null;

  const handleBrowseDir = async (setter: (val: string) => void) => {
    try {
      const selected = await window.flowApi?.selectOutputDir?.();
      if (selected) {
        setter(selected);
      }
    } catch (err) {
      console.error('Failed to select directory', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Channel name is required.');
      return;
    }

    setIsSaving(true);
    setError(null);

    const rulebook = {
      narrationStyle: narrationStyle.trim() || undefined,
      visualStyle: visualStyle.trim() || undefined,
      titleStyle: titleStyle.trim() || undefined,
      tone: tone.trim() || undefined,
      contentRestrictions: contentRestrictions.trim() || undefined,
      promptGuidelines: promptGuidelines.trim() || undefined,
      rawMarkdown: rawMarkdown.trim() || undefined,
    };

    try {
      if (initialChannel) {
        const updated = await window.flowApi?.updateChannel?.(initialChannel.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          enabled,
          outputDir: outputDir.trim() || undefined,
          shortsOutputDir: shortsOutputDir.trim() || undefined,
          longsOutputDir: longsOutputDir.trim() || undefined,
          rulebook,
          defaultAspectRatio,
          defaultVoiceId,
          defaultMotionStyle,
          defaultSubtitleStyle,
          defaultTransitionStyle,
        });
        if (updated) onSaved(updated);
      } else {
        const created = await window.flowApi?.createChannel?.({
          name: name.trim(),
          description: description.trim() || undefined,
          enabled,
          outputDir: outputDir.trim() || undefined,
          shortsOutputDir: shortsOutputDir.trim() || undefined,
          longsOutputDir: longsOutputDir.trim() || undefined,
          rulebook,
          defaultAspectRatio,
          defaultVoiceId,
          defaultMotionStyle,
          defaultSubtitleStyle,
          defaultTransitionStyle,
        });
        if (created) onSaved(created);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save channel');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface, #1e1e24)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '700px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          color: 'var(--text-primary, #fff)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color, #333)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700 }}>
              {initialChannel ? 'Edit Channel & Rulebook' : 'New Channel Setup'}
            </span>
            {initialChannel && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}
              >
                {initialChannel.id}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #999)',
              fontSize: '20px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Tab Selector */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color, #333)',
            backgroundColor: 'rgba(0,0,0,0.2)',
            padding: '0 16px',
            gap: '8px',
          }}
        >
          {[
            { id: 'general', label: 'Identity' },
            { id: 'rulebook', label: 'Rulebook Guidelines' },
            { id: 'destinations', label: 'Output Folders' },
            { id: 'presets', label: 'Default Presets' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                color: activeTab === tab.id ? '#60a5fa' : '#aaa',
                fontWeight: activeTab === tab.id ? 600 : 400,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  marginBottom: '16px',
                  fontSize: '13px',
                }}
              >
                <AlertCircleIcon size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* TAB 1: GENERAL / IDENTITY */}
            {activeTab === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Channel Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Science Uncovered, Deep Ocean Mysteries"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '14px',
                    }}
                    required
                  />
                  <span style={{ fontSize: '11px', color: '#888', marginTop: '4px', display: 'block' }}>
                    Names must be unique across all active channels.
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Channel overview, target demographic, content niche..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '13px',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    id="channel-enabled"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  <label htmlFor="channel-enabled" style={{ fontSize: '13px', cursor: 'pointer' }}>
                    Channel active and eligible for project assignment & delivery
                  </label>
                </div>
              </div>
            )}

            {/* TAB 2: RULEBOOK GUIDELINES */}
            {activeTab === 'rulebook' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '4px' }}>
                  Define the stylistic and editorial guidelines for this channel. In Phase 7, these guidelines organize and document your channel persona; Phase 8 will consume them directly during autonomous script and prompt generation.
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Narration Style & Pacing
                  </label>
                  <input
                    type="text"
                    value={narrationStyle}
                    onChange={(e) => setNarrationStyle(e.target.value)}
                    placeholder="e.g. Documentary, suspenseful, fast-paced hook followed by measured exposition"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Visual Style & Aesthetics
                  </label>
                  <input
                    type="text"
                    value={visualStyle}
                    onChange={(e) => setVisualStyle(e.target.value)}
                    placeholder="e.g. Hyper-realistic cinematic 8k, volumetric underwater lighting, National Geographic style"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Tone
                    </label>
                    <input
                      type="text"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      placeholder="e.g. Mysterious, awe-inspiring"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Title Pattern
                    </label>
                    <input
                      type="text"
                      value={titleStyle}
                      onChange={(e) => setTitleStyle(e.target.value)}
                      placeholder="e.g. The Untold Mystery of [Subject]"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Content Restrictions & Negative Constraints
                  </label>
                  <input
                    type="text"
                    value={contentRestrictions}
                    onChange={(e) => setContentRestrictions(e.target.value)}
                    placeholder="e.g. No cartoonish characters, no low poly textures, avoid technical jargon"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Prompt Guidelines & Key Terms
                  </label>
                  <textarea
                    value={promptGuidelines}
                    onChange={(e) => setPromptGuidelines(e.target.value)}
                    placeholder="Keywords to include in prompts: macro detail, atmospheric fog, dusk lighting..."
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '13px',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Raw Markdown / Editorial Rulebook Notes
                  </label>
                  <textarea
                    value={rawMarkdown}
                    onChange={(e) => setRawMarkdown(e.target.value)}
                    placeholder="Paste comprehensive brand guidelines or markdown notes here..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>
            )}

            {/* TAB 3: OUTPUT DESTINATIONS */}
            {activeTab === 'destinations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Configure local folders for delivered videos. When a video is delivered, it is copied non-destructively with thumbnail and poster. If dedicated Shorts or Longs folders are set, videos route automatically based on their aspect ratio.
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Dedicated Shorts Output Directory (9:16)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={shortsOutputDir}
                      onChange={(e) => setShortsOutputDir(e.target.value)}
                      placeholder="e.g. D:\YouTube\Shorts\MyChannel"
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleBrowseDir(setShortsOutputDir)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        color: '#fff',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      <FolderIcon size={14} />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Dedicated Long-Form Output Directory (16:9)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={longsOutputDir}
                      onChange={(e) => setLongsOutputDir(e.target.value)}
                      placeholder="e.g. D:\YouTube\Longs\MyChannel"
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleBrowseDir(setLongsOutputDir)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        color: '#fff',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      <FolderIcon size={14} />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    General Output Directory (Fallback)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={outputDir}
                      onChange={(e) => setOutputDir(e.target.value)}
                      placeholder="e.g. D:\Exports\MyChannel (used if no ratio-specific folder set)"
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleBrowseDir(setOutputDir)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        color: '#fff',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      <FolderIcon size={14} />
                      <span>Browse</span>
                    </button>
                  </div>
                  <span style={{ fontSize: '11px', color: '#888', marginTop: '4px', display: 'block' }}>
                    If left blank, videos are saved to Infinity Flow's default app channel storage.
                  </span>
                </div>
              </div>
            )}

            {/* TAB 4: DEFAULT PRESETS */}
            {activeTab === 'presets' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Set default production parameters for videos assigned to this channel.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                      Default Aspect Ratio
                    </label>
                    <select
                      value={defaultAspectRatio}
                      onChange={(e) => setDefaultAspectRatio(e.target.value as SupportedAspectRatio)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    >
                      <option value="16:9">16:9 Landscape (YouTube)</option>
                      <option value="9:16">9:16 Portrait (Shorts / Reels / TikTok)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                      Default Motion Style
                    </label>
                    <select
                      value={defaultMotionStyle}
                      onChange={(e) => setDefaultMotionStyle(e.target.value as MotionStyle)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    >
                      <optgroup label="Smart Modes">
                        <option value="auto">AUTO (Anti-Repetition Rotation)</option>
                        <option value="ai_director">AI Director (Mood Adaptive)</option>
                      </optgroup>
                      <optgroup label="PRO Tier">
                        <option value="breathe">Breathe (Organic Breathing)</option>
                        <option value="zoom_in">Slow Push In (Dramatic Zoom)</option>
                        <option value="zoom_out">Slow Pull Out (Expansive Reveal)</option>
                        <option value="pan_left">Pan Left (Smooth Horizontal)</option>
                        <option value="pan_right">Pan Right (Smooth Horizontal)</option>
                        <option value="pan_up">Pan Up (Smooth Vertical)</option>
                        <option value="pan_down">Pan Down (Smooth Vertical)</option>
                        <option value="cinematic_dolly">Cinematic Dolly (Diagonal Drift)</option>
                        <option value="drift">Drift (Slow Atmospheric Float)</option>
                        <option value="parallax">Parallax (Compound Depth Motion)</option>
                      </optgroup>
                      <optgroup label="ULTRA Tier">
                        <option value="crash_zoom">Crash Zoom (High-Speed Snap)</option>
                        <option value="bullet_time">Bullet Time (Slow-Motion Matrix Pan)</option>
                        <option value="ken_burns">Ken Burns (Classic Documentary Pan+Zoom)</option>
                        <option value="whip_pan_left">Whip Pan Left (Kinetic Blur)</option>
                        <option value="whip_pan_right">Whip Pan Right (Kinetic Blur)</option>
                        <option value="snap_zoom">Snap Zoom (Instant Optical Focal Snap)</option>
                        <option value="dolly_zoom">Dolly Zoom (Vertigo Counter-Scale)</option>
                        <option value="shake">Camera Shake (Handheld Rumble)</option>
                        <option value="pulse">Pulse (Rhythmic Heartbeat Punch)</option>
                      </optgroup>
                      <optgroup label="Static">
                        <option value="none">None (Static Tripod Frame)</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                      Default Transition Style
                    </label>
                    <select
                      value={defaultTransitionStyle}
                      onChange={(e) => setDefaultTransitionStyle(e.target.value as TransitionStyle)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    >
                      <option value="hard_cut">Hard Cut</option>
                      <option value="cross_fade">Cross Fade (1.0s blend)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                      Default Subtitle Style
                    </label>
                    <select
                      value={defaultSubtitleStyle}
                      onChange={(e) => setDefaultSubtitleStyle(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color, #444)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                    >
                      <option value="bottom_glass">Bottom Glass</option>
                      <option value="solid_bar">Solid Bar</option>
                      <option value="neon_punch">Neon Punch</option>
                      <option value="cinema_yellow">Cinema Yellow</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    Default Voice ID (Edge TTS)
                  </label>
                  <select
                    value={defaultVoiceId}
                    onChange={(e) => setDefaultVoiceId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #444)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                  >
                    <option value="en-US-ChristopherNeural">Christopher (Male, Natural Narration)</option>
                    <option value="en-US-GuyNeural">Guy (Male, Conversational)</option>
                    <option value="en-US-JennyNeural">Jenny (Female, Warm & Clear)</option>
                    <option value="en-US-AriaNeural">Aria (Female, Expressive)</option>
                    <option value="en-GB-RyanNeural">Ryan (Male, British Professional)</option>
                    <option value="en-GB-SoniaNeural">Sonia (Female, British Narrative)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div
            style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--border-color, #333)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
              backgroundColor: 'rgba(0,0,0,0.15)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #444)',
                backgroundColor: 'transparent',
                color: '#ddd',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#2563eb',
                color: '#fff',
                fontWeight: 600,
                fontSize: '13px',
                cursor: isSaving ? 'wait' : 'pointer',
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? 'Saving...' : initialChannel ? 'Save Changes' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
