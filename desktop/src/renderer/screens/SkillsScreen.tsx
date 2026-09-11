import React, { useState, useEffect, useMemo } from 'react';
import type { SkillEntity } from '../../shared/types';
import {
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  UploadIcon,
  SparklesIcon,
  RefreshIcon,
} from '../components/Icons';
import { SkillModal } from '../components/SkillModal';
import { ConfirmModal } from '../components/ConfirmModal';

interface SkillsScreenProps {
  onNavigateVideoFactory?: (skillId?: string) => void;
}

export const SkillsScreen: React.FC<SkillsScreenProps> = ({
  onNavigateVideoFactory,
}) => {
  const [skills, setSkills] = useState<SkillEntity[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillEntity | null>(null);
  const [skillToDelete, setSkillToDelete] = useState<SkillEntity | null>(null);
  const [notification, setNotification] = useState<{ message: string; isError?: boolean } | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadSkills = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (window.flowApi?.listSkills) {
        const list = await window.flowApi.listSkills();
        setSkills(list || []);
      }
    } catch (err) {
      console.error('Failed to load skills', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadSkills(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadSkills(false);
  }, []);

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.writingStyle && s.writingStyle.toLowerCase().includes(q)) ||
        (s.promptGuidance && s.promptGuidance.toLowerCase().includes(q))
    );
  }, [skills, searchQuery]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!window.flowApi?.importSkill) throw new Error('API not initialized');
      let imported: SkillEntity;
      if (file.name.endsWith('.skill') || file.name.endsWith('.zip') || file.name.toLowerCase().endsWith('.pdf')) {
        const buffer = await file.arrayBuffer();
        imported = await window.flowApi.importSkill(buffer, file.name);
      } else {
        const text = await file.text();
        imported = await window.flowApi.importSkill(text, file.name);
      }
      setNotification({ message: `Successfully imported skill "${imported.name}"` });
      setTimeout(() => setNotification(null), 4000);
      loadSkills();
    } catch (err: any) {
      setNotification({ message: `Import failed: ${err.message}`, isError: true });
      setTimeout(() => setNotification(null), 6000);
    } finally {
      e.target.value = '';
    }
  };

  const handleDeleteConfirm = async () => {
    if (!skillToDelete) return;
    try {
      if (!window.flowApi?.deleteSkill) throw new Error('API not initialized');
      await window.flowApi.deleteSkill(skillToDelete.id);
      setNotification({ message: `Deleted skill "${skillToDelete.name}"` });
      setTimeout(() => setNotification(null), 4000);
      setSkillToDelete(null);
      loadSkills();
    } catch (err: any) {
      setNotification({ message: `Failed to delete skill: ${err.message}`, isError: true });
      setTimeout(() => setNotification(null), 6000);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top Header */}
      <div
        style={{
          padding: '24px 32px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Skills Library
              </h1>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Configure AI narrative rules, style rulebooks, and visual prompt directives for autonomous video production.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh"
              aria-label="Refresh skills"
              style={{ padding: '8px 12px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <RefreshIcon size={14} className={isRefreshing ? 'spin' : undefined} />
            </button>
            <label
              className="btn-secondary"
              style={{
                padding: '8px 14px',
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <UploadIcon size={14} /> Import Skill
              <input
                type="file"
                accept=".md,.txt,.json,.skill,.zip,.pdf"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
            </label>

            <button
              type="button"
              onClick={() => {
                setEditingSkill(null);
                setIsModalOpen(true);
              }}
              className="btn-primary"
              style={{
                padding: '8px 16px',
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#10b981',
                borderColor: '#10b981',
              }}
            >
              <PlusIcon size={14} /> New Skill
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills by name, description, writing style, or prompt guidance..."
            style={{
              flex: 1,
              maxWidth: '520px',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-subtle)',
              color: 'var(--text-primary)',
              fontSize: '13px',
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {filteredSkills.length} {filteredSkills.length === 1 ? 'skill' : 'skills'} available
          </span>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          style={{
            margin: '12px 32px 0 32px',
            padding: '10px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: notification.isError ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            border: `1px solid ${notification.isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            color: notification.isError ? 'var(--danger, #ef4444)' : '#10b981',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {notification.isError ? <AlertCircleIcon size={15} /> : <CheckCircleIcon size={15} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Skills Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: '13px' }}>
            Loading skills...
          </div>
        ) : filteredSkills.length === 0 ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              border: '1px dashed var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--bg-surface)',
              maxWidth: '600px',
              margin: '32px auto',
            }}
          >
            <SparklesIcon size={32} style={{ color: '#10b981', opacity: 0.8, marginBottom: '12px' }} />
            <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {searchQuery ? 'No matching skills found' : 'No skills in library'}
            </h3>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              {searchQuery
                ? 'Try a different search query or clear the filter.'
                : 'Create your first skill or import a ZBot skill bundle.'}
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: '20px',
            }}
          >
            {filteredSkills.map((skill) => (
              <div
                key={skill.id}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                  transition: 'border-color 0.15s ease',
                }}
              >
                {/* Card Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, marginRight: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {skill.name}
                      </h3>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          backgroundColor: skill.enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(156, 163, 175, 0.15)',
                          color: skill.enabled ? '#10b981' : 'var(--text-muted)',
                        }}
                      >
                        {skill.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {skill.description && (
                      <p
                        style={{
                          margin: '4px 0 0 0',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          lineHeight: 1.4,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {skill.description}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSkill(skill);
                        setIsModalOpen(true);
                      }}
                      className="btn-secondary"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      title="Delete Skill"
                      onClick={() => setSkillToDelete(skill)}
                      className="btn-secondary"
                      style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--danger, #ef4444)' }}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>

                {/* Directives Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  {skill.writingStyle && (
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Style:</strong> {skill.writingStyle}
                    </div>
                  )}

                  {skill.promptGuidance && (
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--text-secondary)',
                        backgroundColor: 'var(--bg-subtle)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        lineHeight: 1.35,
                      }}
                    >
                      <strong style={{ color: '#10b981' }}>Prompt Directive:</strong>{' '}
                      <span
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {skill.promptGuidance}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card Bottom / Action */}
                <div
                  style={{
                    paddingTop: '10px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Created {new Date(skill.createdAt).toLocaleDateString()}
                  </span>

                  <button
                    type="button"
                    onClick={() => onNavigateVideoFactory?.(skill.id)}
                    className="btn-primary"
                    style={{
                      padding: '5px 12px',
                      fontSize: '11.5px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      backgroundColor: '#10b981',
                      borderColor: '#10b981',
                    }}
                  >
                    <SparklesIcon size={12} /> Use in Video
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit / Create Modal */}
      <SkillModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSkill(null);
        }}
        onSaved={() => loadSkills()}
        initialSkill={editingSkill}
      />

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={Boolean(skillToDelete)}
        title="Delete Skill"
        message={`Are you sure you want to delete "${skillToDelete?.name}"? Projects and media will never be deleted.`}
        confirmLabel="Delete Skill"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setSkillToDelete(null)}
      />
    </div>
  );
};
