import React, { useState, useEffect, useMemo } from 'react';
import type {
  ProfileSessionSnapshot,
  GeminiAspectRatio,
  CreateProjectParams,
} from '../../shared/types';
import {
  SparklesIcon,
  ImageIcon,
  UploadIcon,
  TrashIcon,
  AlertCircleIcon,
  RefreshIcon,
} from '../components/Icons';
import { SegmentedControl } from '../components/SegmentedControl';

export type GeminiStudioMode =
  | 'text_to_video'
  | 'image_to_video'
  | 'bulk_text_to_video'
  | 'bulk_image_to_video';

interface GeminiVideoStudioScreenProps {
  initialMode?: GeminiStudioMode;
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
  onNavigateProfiles: () => void;
}

interface StagedImageItem {
  path: string;
  name: string;
}

/**
 * Natural numerical sort for file names (1.jpg, 2.jpg, 10.jpg).
 */
function naturalSortFiles(files: StagedImageItem[]): StagedImageItem[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}

export const GeminiVideoStudioScreen: React.FC<GeminiVideoStudioScreenProps> = ({
  initialMode = 'text_to_video',
  onProjectCreated,
  onCancel,
  onNavigateProfiles,
}) => {
  const [activeMode, setActiveMode] = useState<GeminiStudioMode>(initialMode);
  const [aspectRatio, setAspectRatio] = useState<GeminiAspectRatio>('16:9');
  const [projectName, setProjectName] = useState<string>('');

  // Single mode state
  const [singlePrompt, setSinglePrompt] = useState<string>('');
  const [singleImage, setSingleImage] = useState<StagedImageItem | null>(null);

  // Bulk mode state
  const [bulkPromptsText, setBulkPromptsText] = useState<string>('');
  const [bulkImages, setBulkImages] = useState<StagedImageItem[]>([]);

  // Profiles
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('all');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const loadProfiles = async () => {
    if (window.flowApi?.listProfiles) {
      try {
        const list = await window.flowApi.listProfiles();
        setProfiles(list);
      } catch (err) {
        console.error('Failed to load profiles in Gemini studio', err);
      }
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadProfiles();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load profiles
  useEffect(() => {
    loadProfiles();
  }, []);

  // Default project name generator
  useEffect(() => {
    const now = new Date();
    const formatted = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const modeLabel =
      activeMode === 'text_to_video'
        ? 'Gemini Text-to-Video'
        : activeMode === 'image_to_video'
        ? 'Gemini Image-to-Video'
        : activeMode === 'bulk_text_to_video'
        ? 'Gemini Bulk Video'
        : 'Gemini Bulk Image-to-Video';
    setProjectName(`${modeLabel} — ${formatted}`);
  }, [activeMode]);

  // Derived bulk prompt lines
  const bulkPromptLines = useMemo(() => {
    return bulkPromptsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }, [bulkPromptsText]);

  // Validation
  const validation = useMemo(() => {
    if (activeMode === 'text_to_video') {
      if (!singlePrompt.trim()) return { valid: false, message: 'Please enter a video prompt.' };
      return { valid: true };
    }

    if (activeMode === 'image_to_video') {
      if (!singleImage) return { valid: false, message: 'Please select a source image.' };
      if (!singlePrompt.trim()) return { valid: false, message: 'Please enter a motion prompt.' };
      return { valid: true };
    }

    if (activeMode === 'bulk_text_to_video') {
      if (bulkPromptLines.length === 0) return { valid: false, message: 'Please enter at least one prompt line.' };
      return { valid: true };
    }

    if (activeMode === 'bulk_image_to_video') {
      if (bulkImages.length === 0) return { valid: false, message: 'Please stage at least one source image.' };
      if (bulkPromptLines.length === 0) return { valid: false, message: 'Please provide prompt lines for the images.' };
      if (bulkImages.length !== bulkPromptLines.length) {
        return {
          valid: false,
          message: `Mismatch: ${bulkImages.length} images staged but ${bulkPromptLines.length} prompt lines provided. They must match 1-to-1.`,
        };
      }
      return { valid: true };
    }

    return { valid: false, message: 'Invalid configuration' };
  }, [activeMode, singlePrompt, singleImage, bulkPromptLines, bulkImages]);

  // File Handlers
  const handleSelectSingleImage = async () => {
    if (!window.flowApi?.selectImageFile) return;
    try {
      const filePath = await window.flowApi.selectImageFile();
      if (filePath) {
        const name = filePath.split(/[/\\]/).pop() || 'image.png';
        setSingleImage({ path: filePath, name });
      }
    } catch (err) {
      console.error('Error selecting image', err);
    }
  };

  const handleSelectBulkImages = async () => {
    if (!window.flowApi?.selectMultipleImageFiles) return;
    try {
      const paths = await window.flowApi.selectMultipleImageFiles();
      if (paths && paths.length > 0) {
        const newItems: StagedImageItem[] = paths.map((p) => ({
          path: p,
          name: p.split(/[/\\]/).pop() || 'image.png',
        }));
        setBulkImages((prev) => naturalSortFiles([...prev, ...newItems]));
      }
    } catch (err) {
      console.error('Error selecting bulk images', err);
    }
  };

  const handleRemoveBulkImage = (index: number) => {
    setBulkImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearBulkImages = () => {
    setBulkImages([]);
  };

  // Submit and Launch
  const handleSubmit = async () => {
    if (!validation.valid || isSubmitting || !window.flowApi) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let promptsPayload: Array<{ text: string; type: 'image' | 'video'; sourceImagePath?: string; provider?: 'gemini' }> = [];

      if (activeMode === 'text_to_video') {
        promptsPayload = [
          {
            text: singlePrompt.trim(),
            type: 'video',
            provider: 'gemini',
          },
        ];
      } else if (activeMode === 'image_to_video') {
        promptsPayload = [
          {
            text: singlePrompt.trim(),
            type: 'video',
            sourceImagePath: singleImage?.path,
            provider: 'gemini',
          },
        ];
      } else if (activeMode === 'bulk_text_to_video') {
        promptsPayload = bulkPromptLines.map((line) => ({
          text: line,
          type: 'video',
          provider: 'gemini',
        }));
      } else if (activeMode === 'bulk_image_to_video') {
        promptsPayload = bulkImages.map((img, idx) => ({
          text: bulkPromptLines[idx] || '',
          type: 'video',
          sourceImagePath: img.path,
          provider: 'gemini',
        }));
      }

      const selectedProfiles =
        selectedProfileId === 'all'
          ? undefined
          : [selectedProfileId];

      const createParams: CreateProjectParams = {
        name: projectName.trim() || 'Gemini Video Project',
        provider: 'gemini',
        videoRatio: aspectRatio,
        geminiAspectRatio: aspectRatio,
        generationMode:
          activeMode === 'text_to_video'
            ? 'gemini_text_to_video'
            : activeMode === 'image_to_video'
            ? 'gemini_image_to_video'
            : activeMode === 'bulk_text_to_video'
            ? 'gemini_bulk_text_to_video'
            : 'gemini_bulk_image_to_video',
        videoModel: 'Gemini Omni',
        videoResolution: '720p',
        selectedProfileIds: selectedProfiles,
        prompts: promptsPayload,
      };

      const project = await window.flowApi.createProject(createParams);
      await window.flowApi.startProjectGeneration(project.projectId);
      onProjectCreated(project.projectId);
    } catch (err) {
      console.error('Failed to create and start Gemini generation', err);
      setSubmitError((err as Error).message || 'Failed to start Gemini generation');
      setIsSubmitting(false);
    }
  };

  const readyProfiles = profiles.filter((p) => p.status === 'ready');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-app)',
        color: 'var(--text-primary)',
        overflowY: 'auto',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: '24px 32px 18px 32px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-card)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#3b82f6',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            <SparklesIcon size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Gemini Video Studio</h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(59, 130, 246, 0.18)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                }}
              >
                Gemini Omni / Veo
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              High-throughput standalone video generation powered by gemini.google.com
            </p>
          </div>
        </div>

        {/* Profile Status Badge & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh"
            aria-label="Refresh accounts"
            style={{ padding: '6px 10px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <RefreshIcon size={14} className={isRefreshing ? 'spin' : undefined} />
          </button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              fontSize: '12.5px',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: readyProfiles.length > 0 ? '#10b981' : '#f59e0b',
              }}
            />
            <span>
              {readyProfiles.length} of {profiles.length} Accounts Ready
            </span>
          </div>
          <button
            type="button"
            onClick={onNavigateProfiles}
            style={{
              fontSize: '12.5px',
              padding: '6px 12px',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Manage Accounts
          </button>
        </div>
      </div>

      {/* Main Form Body */}
      <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Mode Switcher */}
        <div style={{ marginBottom: '28px' }}>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            WORKFLOW MODE
          </label>
          <SegmentedControl
            options={[
              { value: 'text_to_video', label: 'Text to Video' },
              { value: 'image_to_video', label: 'Image to Video' },
              { value: 'bulk_text_to_video', label: 'Bulk Text to Video' },
              { value: 'bulk_image_to_video', label: 'Bulk Image to Video' },
            ]}
            value={activeMode}
            onChange={(val) => setActiveMode(val as GeminiStudioMode)}
          />
        </div>

        {/* Settings Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            marginBottom: '28px',
          }}
        >
          {/* Project Name */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              PROJECT NAME
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name..."
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '13.5px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Aspect Ratio Selector (Strictly 16:9 & 9:16 - NO 4K) */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              ASPECT RATIO / ORIENTATION
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  backgroundColor: aspectRatio === '16:9' ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-card)',
                  border: aspectRatio === '16:9' ? '1.5px solid #3b82f6' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: aspectRatio === '16:9' ? '#60a5fa' : 'var(--text-primary)',
                  fontWeight: aspectRatio === '16:9' ? 600 : 400,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Landscape (16:9)
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  backgroundColor: aspectRatio === '9:16' ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-card)',
                  border: aspectRatio === '9:16' ? '1.5px solid #3b82f6' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: aspectRatio === '9:16' ? '#60a5fa' : 'var(--text-primary)',
                  fontWeight: aspectRatio === '9:16' ? 600 : 400,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Portrait (9:16)
              </button>
            </div>
          </div>
        </div>

        {/* Profile Assignment Selection */}
        <div style={{ marginBottom: '28px' }}>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            GOOGLE ACCOUNT ASSIGNMENT
          </label>
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontSize: '13.5px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">Automatic Load Balancing across all eligible accounts</option>
            {profiles.map((p) => (
              <option key={p.profileId} value={p.profileId}>
                {p.displayName || p.profileId} ({p.detectedEmail || 'Google Account'}) — {p.status}
              </option>
            ))}
          </select>
        </div>

        {/* MODE 1: SINGLE TEXT-TO-VIDEO */}
        {activeMode === 'text_to_video' && (
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              VIDEO PROMPT
            </label>
            <textarea
              value={singlePrompt}
              onChange={(e) => setSinglePrompt(e.target.value)}
              placeholder="Describe your video in detail (e.g. A cinematic drone flyover of an ancient mossy castle shrouded in morning mist...)"
              rows={5}
              style={{
                width: '100%',
                padding: '14px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '14px',
                lineHeight: 1.5,
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* MODE 2: SINGLE IMAGE-TO-VIDEO */}
        {activeMode === 'image_to_video' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '28px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                SOURCE REFERENCE IMAGE
              </label>
              {singleImage ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <ImageIcon size={20} color="#3b82f6" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13.5px' }}>{singleImage.name}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {singleImage.path}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSingleImage(null)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <TrashIcon size={14} /> Remove
                  </button>
                </div>
              ) : (
                <div
                  onClick={handleSelectSingleImage}
                  style={{
                    padding: '28px',
                    border: '2px dashed var(--border-color)',
                    borderRadius: '10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    backgroundColor: 'rgba(255, 255, 255, 0.015)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <UploadIcon size={28} color="var(--text-secondary)" />
                  <p style={{ margin: '8px 0 4px 0', fontSize: '14px', fontWeight: 600 }}>
                    Click to select source image
                  </p>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Supports PNG, JPG, JPEG, WEBP
                  </span>
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                CAMERA & MOTION PROMPT
              </label>
              <textarea
                value={singlePrompt}
                onChange={(e) => setSinglePrompt(e.target.value)}
                placeholder="Describe the motion and camera animation (e.g. Slow cinematic zoom in, natural flowing water, soft ambient sunlight...)"
                rows={4}
                style={{
                  width: '100%',
                  padding: '14px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  lineHeight: 1.5,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* MODE 3: BULK TEXT-TO-VIDEO */}
        {activeMode === 'bulk_text_to_video' && (
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                BULK PROMPTS (ONE PER LINE)
              </label>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {bulkPromptLines.length} {bulkPromptLines.length === 1 ? 'Prompt' : 'Prompts'} Detected
              </span>
            </div>
            <textarea
              value={bulkPromptsText}
              onChange={(e) => setBulkPromptsText(e.target.value)}
              placeholder="Enter one video prompt per line:&#10;A futuristic hovercraft flying through a cyberpunk city&#10;A serene mountain stream with golden autumn leaves&#10;A cute red panda eating bamboo in the snow"
              rows={8}
              style={{
                width: '100%',
                padding: '14px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '13.5px',
                fontFamily: 'var(--font-mono, monospace)',
                lineHeight: 1.6,
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* MODE 4: BULK IMAGE-TO-VIDEO */}
        {activeMode === 'bulk_image_to_video' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '28px' }}>
            {/* Staged Images Section */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  SOURCE IMAGES (NATURALLY SORTED)
                </label>
                {bulkImages.length > 0 && (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={handleSelectBulkImages}
                      style={{ fontSize: '12px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      + Add More Images
                    </button>
                    <button
                      type="button"
                      onClick={handleClearBulkImages}
                      style={{ fontSize: '12px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Clear All
                    </button>
                  </div>
                )}
              </div>

              {bulkImages.length === 0 ? (
                <div
                  onClick={handleSelectBulkImages}
                  style={{
                    padding: '28px',
                    border: '2px dashed var(--border-color)',
                    borderRadius: '10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    backgroundColor: 'rgba(255, 255, 255, 0.015)',
                  }}
                >
                  <UploadIcon size={28} color="var(--text-secondary)" />
                  <p style={{ margin: '8px 0 4px 0', fontSize: '14px', fontWeight: 600 }}>
                    Click to select multiple source images
                  </p>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Files will be automatically sorted naturally (1.jpg, 2.jpg, 10.jpg)
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {bulkImages.map((img, idx) => (
                    <div
                      key={img.path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 12px',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: '6px',
                        fontSize: '12.5px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#3b82f6' }}>
                          #{String(idx + 1).padStart(2, '0')}
                        </span>
                        <span>{img.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveBulkImage(idx)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Matching Prompts Textarea */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  MATCHING MOTION PROMPTS (1-TO-1 WITH SORTED IMAGES)
                </label>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {bulkPromptLines.length} of {bulkImages.length} Prompts Provided
                </span>
              </div>
              <textarea
                value={bulkPromptsText}
                onChange={(e) => setBulkPromptsText(e.target.value)}
                placeholder="Enter one motion prompt per line corresponding to each sorted image:&#10;Line 1 -> Prompt for Image 1&#10;Line 2 -> Prompt for Image 2&#10;Line 3 -> Prompt for Image 3"
                rows={8}
                style={{
                  width: '100%',
                  padding: '14px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                  fontFamily: 'var(--font-mono, monospace)',
                  lineHeight: 1.6,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* Validation Warning / Error Banner */}
        {(!validation.valid && (singlePrompt || bulkPromptsText || bulkImages.length > 0)) && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
              color: '#f59e0b',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '24px',
            }}
          >
            <AlertCircleIcon size={18} />
            <span>{validation.message}</span>
          </div>
        )}

        {submitError && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '24px',
            }}
          >
            <AlertCircleIcon size={18} />
            <span>{submitError}</span>
          </div>
        )}

        {/* Action Button Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '14px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              padding: '10px 20px',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-secondary)',
              fontSize: '13.5px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!validation.valid || isSubmitting}
            style={{
              padding: '10px 28px',
              backgroundColor: validation.valid && !isSubmitting ? '#3b82f6' : 'rgba(59, 130, 246, 0.4)',
              border: 'none',
              borderRadius: '8px',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: validation.valid && !isSubmitting ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: validation.valid && !isSubmitting ? '0 4px 12px rgba(59, 130, 246, 0.35)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <SparklesIcon size={16} />
            {isSubmitting ? 'Launching Gemini Generation...' : 'Generate with Gemini'}
          </button>
        </div>
      </div>
    </div>
  );
};
