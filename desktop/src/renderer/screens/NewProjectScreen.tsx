import React, { useState, useEffect, useMemo } from 'react';
import type {
  SupportedAspectRatio,
  ProcessingOrder,
  ProfileSessionSnapshot,
} from '../../shared/types';
import { PromptParser, type ParsedPromptEntry } from '../../shared/PromptParser';
import { FullPromptModal } from '../components/FullPromptModal';
import { EyeIcon } from '../components/Icons';

type ContentType = 'images_only' | 'videos_only' | 'images_and_videos';

interface NewProjectScreenProps {
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
  onNavigateProfiles: () => void;
}

export const NewProjectScreen: React.FC<NewProjectScreenProps> = ({
  onProjectCreated,
  onCancel,
  onNavigateProfiles,
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Project info
  const [projectName, setProjectName] = useState('');
  const [campaignTag, setCampaignTag] = useState('');

  // Step 2: Content
  const [contentType, setContentType] = useState<ContentType>('images_only');

  // Step 3: Generation Settings
  const [imageRatio, setImageRatio] = useState<SupportedAspectRatio>('16:9');
  const [processingOrder, setProcessingOrder] = useState<ProcessingOrder>('images_first');
  const [imageDownloadQuality, setImageDownloadQuality] = useState<'original' | '2k'>('original');
  const [videoDownloadQuality, setVideoDownloadQuality] = useState<'original' | '1080p' | '4k'>('original');

  // Step 4: Prompts
  const [imagePromptsText, setImagePromptsText] = useState('');
  const [videoPromptsText, setVideoPromptsText] = useState('');

  // Step 5: Profiles & Review
  const [profiles, setProfiles] = useState<ProfileSessionSnapshot[]>([]);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal inspection for review prompts
  const [inspectPrompt, setInspectPrompt] = useState<ParsedPromptEntry | null>(null);

  // Load profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      if (window.flowApi) {
        try {
          const list = await window.flowApi.listProfiles();
          setProfiles(list);
          // By default select all enabled profiles
          const ids = new Set(list.map((p) => p.profileId));
          setSelectedProfileIds(ids);
        } catch (e) {
          console.error('Failed to load profiles', e);
        }
      }
    };
    fetchProfiles();
  }, []);

  // Live prompt parsing
  const parsedImages = useMemo(() => {
    if (contentType === 'videos_only') return [];
    return PromptParser.parseRawText(imagePromptsText, 'image');
  }, [imagePromptsText, contentType]);

  const parsedVideos = useMemo(() => {
    if (contentType === 'images_only') return [];
    return PromptParser.parseRawText(videoPromptsText, 'video');
  }, [videoPromptsText, contentType]);

  const totalPromptsCount = parsedImages.length + parsedVideos.length;

  // Profile readiness calculation
  const selectedProfiles = profiles.filter((p) => selectedProfileIds.has(p.profileId));
  const readyProfiles = selectedProfiles.filter((p) => p.status === 'ready');
  const authRequiredProfiles = selectedProfiles.filter((p) => p.status === 'auth_required');

  // Step navigation guards
  const canProceedFromStep1 = projectName.trim().length > 0;
  const canProceedFromStep4 = totalPromptsCount > 0;

  const handleStartGeneration = async () => {
    if (totalPromptsCount === 0) {
      setErrorMsg('Please provide at least one valid prompt.');
      return;
    }

    if (!window.flowApi) return;

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const combined = PromptParser.combinePrompts(
        imagePromptsText,
        videoPromptsText,
        contentType
      );

      // Create persistent project in backend
      const project = await window.flowApi.createProject({
        name: projectName.trim(),
        campaignTag: campaignTag.trim() || undefined,
        imageRatio: contentType !== 'videos_only' ? imageRatio : undefined,
        processingOrder: contentType === 'images_and_videos' ? processingOrder : 'automatic',
        imageDownloadQuality,
        videoDownloadQuality,
        prompts: combined,
      });

      // Start scheduler execution
      await window.flowApi.startProjectGeneration(project.projectId);

      onProjectCreated(project.projectId);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '780px', margin: '0 auto', width: '100%', height: '100%', overflowY: 'auto' }}>
      {/* Wizard Step Progress Tracker */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          {[
            { num: 1, label: 'Project' },
            { num: 2, label: 'Content' },
            { num: 3, label: 'Settings' },
            { num: 4, label: 'Prompts' },
            { num: 5, label: 'Review & Start' },
          ].map((s) => {
            const isActive = currentStep === s.num;
            const isCompleted = currentStep > s.num;
            return (
              <div
                key={s.num}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: isActive || isCompleted ? 1 : 0.45,
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: isActive ? 'var(--primary)' : isCompleted ? 'var(--success-bg)' : 'var(--bg-hover)',
                    color: isActive ? 'var(--text-inverse)' : isCompleted ? 'var(--success)' : 'var(--text-secondary)',
                    border: isCompleted ? '1px solid var(--success-border)' : '1px solid var(--border-color)',
                  }}
                >
                  {s.num}
                </div>
                <span style={{ fontSize: '11px', fontWeight: isActive ? 600 : 400 }}>{s.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ height: '2px', backgroundColor: 'var(--border-color)', borderRadius: '1px' }}>
          <div
            style={{
              height: '100%',
              backgroundColor: 'var(--primary)',
              width: `${((currentStep - 1) / 4) * 100}%`,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </div>

      {/* STEP 1: Project Info */}
      {currentStep === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2>Step 1 — Project Details</h2>
            <p style={{ marginTop: '4px' }}>Name and categorize your batch generation campaign.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500 }}>Project Name *</label>
            <input
              type="text"
              placeholder="e.g. Cyberpunk Episode 01"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500 }}>Optional Campaign / Tag</label>
            <input
              type="text"
              placeholder="e.g. q3-marketing, sci-fi-series"
              value={campaignTag}
              onChange={(e) => setCampaignTag(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
            <button className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!canProceedFromStep1}
              onClick={() => setCurrentStep(2)}
            >
              Continue to Content &rarr;
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Content Type */}
      {currentStep === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2>Step 2 — Content Type</h2>
            <p style={{ marginTop: '4px' }}>Choose the type of media you plan to generate in this project.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[
              { id: 'images_only', label: 'Images Only', desc: 'Batch generate image slots using Nano Banana 2' },
              { id: 'videos_only', label: 'Videos Only', desc: 'Batch generate video slots using Veo 3.1' },
              { id: 'images_and_videos', label: 'Images + Videos', desc: 'Mix of both images and videos in one project' },
            ].map((opt) => (
              <div
                key={opt.id}
                onClick={() => setContentType(opt.id as ContentType)}
                style={{
                  padding: '16px',
                  backgroundColor: contentType === opt.id ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  border: `1px solid ${contentType === opt.id ? 'var(--primary)' : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{opt.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{opt.desc}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
            <button className="btn-secondary" onClick={() => setCurrentStep(1)}>
              &larr; Back
            </button>
            <button className="btn-primary" onClick={() => setCurrentStep(3)}>
              Continue to Settings &rarr;
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Generation Settings */}
      {currentStep === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2>Step 3 — Generation Settings</h2>
            <p style={{ marginTop: '4px' }}>Configure aspect ratio and execution dispatch rules.</p>
          </div>

          {contentType !== 'videos_only' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Image Aspect Ratio</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {(['16:9', '9:16'] as SupportedAspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={imageRatio === ratio ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setImageRatio(ratio)}
                    style={{ minWidth: '100px' }}
                  >
                    {ratio} {ratio === '16:9' ? '(Landscape)' : '(Portrait)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {contentType !== 'videos_only' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Image Download Quality</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[
                  { id: 'original', label: 'Original' },
                  { id: '2k', label: '2K Upscaled' },
                ].map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={imageDownloadQuality === q.id ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setImageDownloadQuality(q.id as 'original' | '2k')}
                    style={{ minWidth: '110px' }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {contentType !== 'images_only' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Video Download Quality</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[
                  { id: 'original', label: 'Original (Native)' },
                  { id: '1080p', label: '1080p Upscaled' },
                  { id: '4k', label: '4K Upscaled' },
                ].map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={videoDownloadQuality === q.id ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setVideoDownloadQuality(q.id as 'original' | '1080p' | '4k')}
                    style={{ minWidth: '130px' }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {contentType === 'images_and_videos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Processing Order</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[
                  { id: 'images_first', label: 'Images First' },
                  { id: 'videos_first', label: 'Videos First' },
                  { id: 'automatic', label: 'Automatic (FIFO)' },
                ].map((po) => (
                  <button
                    key={po.id}
                    type="button"
                    className={processingOrder === po.id ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setProcessingOrder(po.id as ProcessingOrder)}
                  >
                    {po.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
            <button className="btn-secondary" onClick={() => setCurrentStep(2)}>
              &larr; Back
            </button>
            <button className="btn-primary" onClick={() => setCurrentStep(4)}>
              Continue to Prompts &rarr;
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Prompts Input */}
      {currentStep === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h2>Step 4 — Prompt Input</h2>
            <p style={{ marginTop: '4px' }}>
              Enter one prompt per line. You can paste dozens of prompts at once. Exact order is strictly preserved.
            </p>
          </div>

          {contentType !== 'videos_only' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>IMAGE PROMPTS</label>
                <span style={{ fontSize: '12px', color: parsedImages.length > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                  Images: <strong>{parsedImages.length}</strong> prompts
                </span>
              </div>
              <textarea
                rows={7}
                placeholder="A futuristic city in the rain&#10;A flying hovercar crossing a suspension bridge&#10;Neon storefront reflection in puddle"
                value={imagePromptsText}
                onChange={(e) => setImagePromptsText(e.target.value)}
              />
            </div>
          )}

          {contentType !== 'images_only' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>VIDEO PROMPTS</label>
                <span style={{ fontSize: '12px', color: parsedVideos.length > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                  Videos: <strong>{parsedVideos.length}</strong> prompts
                </span>
              </div>
              <textarea
                rows={7}
                placeholder="Drone flying low over neon city alley&#10;Cinematic camera tilt revealing giant skyscraper"
                value={videoPromptsText}
                onChange={(e) => setVideoPromptsText(e.target.value)}
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
            <button className="btn-secondary" onClick={() => setCurrentStep(3)}>
              &larr; Back
            </button>
            <button
              className="btn-primary"
              disabled={!canProceedFromStep4}
              onClick={() => setCurrentStep(5)}
            >
              Review & Start ({totalPromptsCount} Prompts) &rarr;
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Review & Start (Integrated Profile Selector + Compact Previews) */}
      {currentStep === 5 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2>Step 5 — Review & Start</h2>
            <p style={{ marginTop: '4px' }}>Verify your generation batch and available profile workers before launching.</p>
          </div>

          {/* Batch Summary Card */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px',
              fontSize: '13px',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Project: </span>
              <strong>{projectName}</strong>
              {campaignTag && ` (${campaignTag})`}
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Total Prompts: </span>
              <strong>{totalPromptsCount}</strong> ({parsedImages.length} images, {parsedVideos.length} videos)
            </div>
            {contentType !== 'videos_only' && (
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Aspect Ratio: </span>
                <strong>{imageRatio}</strong>
              </div>
            )}
            {contentType === 'images_and_videos' && (
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Processing Order: </span>
                <strong>{processingOrder === 'images_first' ? 'Images First' : processingOrder === 'videos_first' ? 'Videos First' : 'Automatic'}</strong>
              </div>
            )}
          </div>

          {/* Profile Availability & Selection */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Google Flow Profiles</span>
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                <span>Selected: <strong>{selectedProfiles.length}</strong></span>
                <span style={{ color: 'var(--success)' }}>Ready: <strong>{readyProfiles.length}</strong></span>
                {authRequiredProfiles.length > 0 && (
                  <span style={{ color: 'var(--warning)' }}>Auth Required: <strong>{authRequiredProfiles.length}</strong></span>
                )}
              </div>
            </div>

            {profiles.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No Flow profiles configured yet.
                <button className="btn-secondary btn-sm" onClick={onNavigateProfiles} style={{ marginLeft: '10px' }}>
                  Add Profile
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {profiles.map((prof) => {
                  const isChecked = selectedProfileIds.has(prof.profileId);
                  return (
                    <label
                      key={prof.profileId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: isChecked ? 'var(--bg-subtle)' : 'transparent',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(selectedProfileIds);
                            if (e.target.checked) next.add(prof.profileId);
                            else next.delete(prof.profileId);
                            setSelectedProfileIds(next);
                          }}
                        />
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>{prof.displayName}</span>
                        {prof.detectedEmail && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({prof.detectedEmail})</span>
                        )}
                      </div>

                      <span className={`badge badge-${prof.status === 'ready' ? 'ready' : prof.status === 'auth_required' ? 'attention' : 'draft'}`}>
                        {prof.status === 'ready' ? 'Ready' : prof.status === 'auth_required' ? 'Sign-In Required' : prof.status}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* If zero ready profiles */}
            {readyProfiles.length === 0 && profiles.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px', backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>No selected profile is currently in "Ready" status. You can still start, and the scheduler will execute once Chrome connects.</span>
                <button className="btn-secondary btn-sm" onClick={onNavigateProfiles}>
                  Open Profiles
                </button>
              </div>
            )}
          </div>

          {/* Compact Prompt Preview List */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>
              Prompt Slots Preview (Exact 1-to-1 Order)
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
              {parsedImages.map((p, idx) => (
                <div
                  key={`img_${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    backgroundColor: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', overflow: 'hidden' }}>
                    <span style={{ fontWeight: 600, color: 'var(--primary)' }}>#{String(idx + 1).padStart(2, '0')}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {PromptParser.getPreview(p.text, 60)}
                    </span>
                  </div>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setInspectPrompt(p)}
                    title="Inspect complete prompt"
                  >
                    <EyeIcon size={12} />
                  </button>
                </div>
              ))}

              {parsedVideos.map((p, idx) => {
                const displayIndex = parsedImages.length + idx + 1;
                return (
                  <div
                    key={`vid_${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      backgroundColor: 'var(--bg-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', overflow: 'hidden' }}>
                      <span style={{ fontWeight: 600, color: '#7c3aed' }}>#{String(displayIndex).padStart(2, '0')} [Video]</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {PromptParser.getPreview(p.text, 60)}
                      </span>
                    </div>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => setInspectPrompt(p)}
                      title="Inspect complete prompt"
                    >
                      <EyeIcon size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {errorMsg && (
            <div style={{ color: 'var(--danger)', fontSize: '13px' }}>
              {errorMsg}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
            <button className="btn-secondary" onClick={() => setCurrentStep(4)} disabled={isSubmitting}>
              &larr; Back to Prompts
            </button>
            <button
              className="btn-primary"
              onClick={handleStartGeneration}
              disabled={isSubmitting || totalPromptsCount === 0}
              style={{ minWidth: '220px' }}
            >
              {isSubmitting
                ? 'Initializing...'
                : `Start Generation — ${totalPromptsCount} Prompts`}
            </button>
          </div>
        </div>
      )}

      {/* Full Prompt Inspection Modal inside Review */}
      {inspectPrompt && (
        <FullPromptModal
          isOpen={inspectPrompt !== null}
          promptText={inspectPrompt.text}
          type={inspectPrompt.type}
          onClose={() => setInspectPrompt(null)}
        />
      )}
    </div>
  );
};
