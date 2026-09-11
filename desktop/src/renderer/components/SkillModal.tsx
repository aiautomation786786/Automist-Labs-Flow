import React, { useState, useEffect } from 'react';
import type { SkillEntity, CreateSkillParams, UpdateSkillParams } from '../../shared/types';
import { AlertCircleIcon, UploadIcon } from './Icons';

interface SkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (skill: SkillEntity) => void;
  initialSkill?: SkillEntity | null;
}

export const SkillModal: React.FC<SkillModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialSkill,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [structureRequirements, setStructureRequirements] = useState('');
  const [sceneRequirements, setSceneRequirements] = useState('');
  const [promptGuidance, setPromptGuidance] = useState('');
  const [channelCompatibility, setChannelCompatibility] = useState('');
  const [rawMarkdown, setRawMarkdown] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [activeTab, setActiveTab] = useState<'instructions' | 'structure' | 'prompts' | 'markdown'>('instructions');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSkill) {
      setName(initialSkill.name || '');
      setDescription(initialSkill.description || '');
      setSystemInstructions(initialSkill.systemInstructions || '');
      setWritingStyle(initialSkill.writingStyle || '');
      setStructureRequirements(initialSkill.structureRequirements || '');
      setSceneRequirements(initialSkill.sceneRequirements || '');
      setPromptGuidance(initialSkill.promptGuidance || '');
      setChannelCompatibility((initialSkill.channelCompatibility || []).join(', '));
      setRawMarkdown(initialSkill.rawMarkdown || '');
      setEnabled(initialSkill.enabled ?? true);
    } else {
      setName('');
      setDescription('');
      setSystemInstructions('You are an expert scriptwriter and narrative director. Write evocative, fact-rich, beautifully paced scenes with cinematic visual descriptions.');
      setWritingStyle('Engaging, authoritative, crisp, evocative, zero fluff.');
      setStructureRequirements('Dynamic hook in Scene 1, deep context and tension in middle scenes, memorable resolution in final scene.');
      setSceneRequirements('15-25 words of narration per scene (~5-8 seconds per scene).');
      setPromptGuidance('Cinematic 35mm film photography, volumetric atmospheric lighting, shallow depth of field, photorealistic textures, 8k resolution, IMAX composition.');
      setChannelCompatibility('');
      setRawMarkdown('');
      setEnabled(true);
    }
    setError(null);
    setActiveTab('instructions');
  }, [initialSkill, isOpen]);

  if (!isOpen) return null;

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.endsWith('.skill') || file.name.endsWith('.zip') || file.name.toLowerCase().endsWith('.pdf')) {
        const buffer = await file.arrayBuffer();
        if (window.flowApi?.importSkill) {
          const imported = await window.flowApi.importSkill(buffer, file.name);
          setName(imported.name || '');
          setDescription(imported.description || '');
          setSystemInstructions(imported.systemInstructions || '');
          setWritingStyle(imported.writingStyle || '');
          setStructureRequirements(imported.structureRequirements || '');
          setSceneRequirements(imported.sceneRequirements || '');
          setPromptGuidance(imported.promptGuidance || '');
          setChannelCompatibility((imported.channelCompatibility || []).join(', '));
        }
      } else {
        const text = await file.text();
        if (window.flowApi?.importSkill) {
          const imported = await window.flowApi.importSkill(text, file.name);
          setName(imported.name || '');
          setDescription(imported.description || '');
          setSystemInstructions(imported.systemInstructions || '');
          setWritingStyle(imported.writingStyle || '');
          setStructureRequirements(imported.structureRequirements || '');
          setSceneRequirements(imported.sceneRequirements || '');
          setPromptGuidance(imported.promptGuidance || '');
          setChannelCompatibility((imported.channelCompatibility || []).join(', '));
        }
      }
    } catch (err: any) {
      setError(`Failed to import skill: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Skill Name is required');
      setActiveTab('instructions');
      return;
    }

    if (!systemInstructions.trim()) {
      setError('System Instructions are required');
      setActiveTab('instructions');
      return;
    }

    setIsSaving(true);
    setError(null);

    const compatArray = channelCompatibility
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    if (!window.flowApi?.updateSkill || !window.flowApi?.createSkill) {
      setError('API not initialized');
      setIsSaving(false);
      return;
    }

    try {
      let saved: SkillEntity;
      if (initialSkill) {
        const patch: UpdateSkillParams = {
          name: trimmedName,
          description: description.trim(),
          systemInstructions: systemInstructions.trim(),
          writingStyle: writingStyle.trim() || undefined,
          structureRequirements: structureRequirements.trim() || undefined,
          sceneRequirements: sceneRequirements.trim() || undefined,
          promptGuidance: promptGuidance.trim() || undefined,
          channelCompatibility: compatArray,
          rawMarkdown: rawMarkdown.trim() || undefined,
          enabled,
        };
        saved = await window.flowApi.updateSkill(initialSkill.id, patch);
      } else {
        const params: CreateSkillParams = {
          name: trimmedName,
          description: description.trim(),
          systemInstructions: systemInstructions.trim(),
          writingStyle: writingStyle.trim() || undefined,
          structureRequirements: structureRequirements.trim() || undefined,
          sceneRequirements: sceneRequirements.trim() || undefined,
          promptGuidance: promptGuidance.trim() || undefined,
          channelCompatibility: compatArray,
          rawMarkdown: rawMarkdown.trim() || undefined,
          enabled,
        };
        saved = await window.flowApi.createSkill(params);
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save skill');
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
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {initialSkill ? 'Edit Skill' : 'Create New Skill'}
            </h2>
            <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Configure AI narrative rules, pacing, writing style, and visual prompt guidance.
            </p>
          </div>

          <label
            className="btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: '11.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <UploadIcon size={13} /> Import File
            <input
              type="file"
              accept=".md,.txt,.json,.skill,.zip,.pdf"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </label>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            padding: '0 24px',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-subtle)',
            gap: '8px',
          }}
        >
          {[
            { id: 'instructions', label: '1. Persona & Style' },
            { id: 'structure', label: '2. Structure & Pacing' },
            { id: 'prompts', label: '3. Visual Prompting' },
            { id: 'markdown', label: '4. Raw Markdown' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: '10px 14px',
                  border: 'none',
                  borderBottom: isActive ? '2px solid #10b981' : '2px solid transparent',
                  backgroundColor: 'transparent',
                  color: isActive ? '#10b981' : 'var(--text-secondary)',
                  fontSize: '12.5px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Error Banner */}
        {error && (
          <div
            style={{
              margin: '16px 24px 0 24px',
              padding: '10px 14px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--danger, #ef4444)',
              fontSize: '12px',
            }}
          >
            <AlertCircleIcon size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Tab Content Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeTab === 'instructions' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Skill Name <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Cinematic Documentary, Viral Explainer / Shorts"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief summary of what kind of videos this skill produces"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  System Instructions (AI Persona & Core Directives) <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                </label>
                <textarea
                  rows={4}
                  value={systemInstructions}
                  onChange={(e) => setSystemInstructions(e.target.value)}
                  placeholder="Instructions for the AI model when acting under this skill..."
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    lineHeight: 1.4,
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Writing Style & Tone</label>
                <input
                  type="text"
                  value={writingStyle}
                  onChange={(e) => setWritingStyle(e.target.value)}
                  placeholder="e.g. Objective, profound, measured, evocative, rich sensory adjectives"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="skill-enabled"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="skill-enabled" style={{ fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Enable Skill for Video Creation
                </label>
              </div>
            </>
          )}

          {activeTab === 'structure' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Narrative Structure</label>
                <textarea
                  rows={3}
                  value={structureRequirements}
                  onChange={(e) => setStructureRequirements(e.target.value)}
                  placeholder="e.g. Dynamic hook in Scene 1, deep context and tension in middle scenes, philosophical resolution in final scene."
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    lineHeight: 1.4,
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Scene Pacing & Requirements</label>
                <input
                  type="text"
                  value={sceneRequirements}
                  onChange={(e) => setSceneRequirements(e.target.value)}
                  placeholder="e.g. 15-25 words of narration per scene (~5-8 seconds per scene)"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Channel Compatibility Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={channelCompatibility}
                  onChange={(e) => setChannelCompatibility(e.target.value)}
                  placeholder="e.g. documentary, history, science, shorts"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>
            </>
          )}

          {activeTab === 'prompts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Visual Prompt Guidance & Directives
              </label>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                Instructions given to Script AI to shape scene image prompts. Governed by Tier 2 precedence (overridden only by user instructions).
              </p>
              <textarea
                rows={7}
                value={promptGuidance}
                onChange={(e) => setPromptGuidance(e.target.value)}
                placeholder="e.g. Cinematic 35mm film photography, volumetric atmospheric lighting, shallow depth of field, photorealistic textures, 8k resolution, IMAX composition."
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '12.5px',
                  lineHeight: 1.4,
                  resize: 'vertical',
                }}
              />
            </div>
          )}

          {activeTab === 'markdown' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Raw Markdown / Frontmatter Configuration
              </label>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                Optional raw markdown representation matching ZBot SKILL.md specs.
              </p>
              <textarea
                rows={9}
                value={rawMarkdown}
                onChange={(e) => setRawMarkdown(e.target.value)}
                placeholder={`---\nname: "${name}"\nwritingstyle: "${writingStyle}"\n---\n# Directives\n${systemInstructions}`}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  lineHeight: 1.4,
                  resize: 'vertical',
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '7px 16px', fontSize: '12.5px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="btn-primary"
            style={{
              padding: '7px 20px',
              fontSize: '12.5px',
              backgroundColor: '#10b981',
              borderColor: '#10b981',
            }}
          >
            {isSaving ? 'Saving...' : initialSkill ? 'Save Changes' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  );
};
