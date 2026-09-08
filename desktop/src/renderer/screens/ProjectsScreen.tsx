import React, { useState, useEffect } from 'react';
import type { ProjectEntity } from '../../shared/types';
import { PlusIcon, FolderIcon, TrashIcon, PlayIcon } from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';

interface ProjectsScreenProps {
  onOpenProject: (projectId: string) => void;
  onNavigateNewProject: () => void;
}

export const ProjectsScreen: React.FC<ProjectsScreenProps> = ({
  onOpenProject,
  onNavigateNewProject,
}) => {
  const [projects, setProjects] = useState<ProjectEntity[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<ProjectEntity | null>(null);

  const loadProjects = async () => {
    try {
      setLoading(true);
      if (window.flowApi) {
        const list = await window.flowApi.listProjects();
        setProjects(list);
      }
    } catch (err) {
      console.error('Failed to load projects', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleDeleteConfirm = async () => {
    if (!projectToDelete || !window.flowApi) return;
    try {
      await window.flowApi.deleteProject(projectToDelete.projectId);
      setProjectToDelete(null);
      await loadProjects();
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.campaignTag && p.campaignTag.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Projects</h1>
          <p style={{ marginTop: '4px' }}>Manage and monitor batch generation campaigns</p>
        </div>
        <button className="btn-primary" onClick={onNavigateNewProject}>
          <PlusIcon size={16} />
          New Project
        </button>
      </div>

      {/* Search and filter toolbar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search projects by name or tag..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: '400px' }}
        />
      </div>

      {/* Projects List or Empty State */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading projects...
        </div>
      ) : filteredProjects.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '48px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <FolderIcon size={36} style={{ color: 'var(--text-muted)' }} />
          <h3>{searchQuery ? 'No matching projects found' : 'No projects yet'}</h3>
          <p style={{ maxWidth: '380px' }}>
            {searchQuery
              ? 'Try changing your search terms.'
              : 'Create your first project to begin batch generation across multiple Google Flow profiles.'}
          </p>
          {!searchQuery && (
            <button className="btn-primary" onClick={onNavigateNewProject} style={{ marginTop: '8px' }}>
              <PlusIcon size={16} />
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filteredProjects.map((p) => {
            const total = (p.stats?.totalImages || 0) + (p.stats?.totalVideos || 0);
            const completed = (p.stats?.completedImages || 0) + (p.stats?.completedVideos || 0);
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
            const updatedDate = new Date(p.updatedAt).toLocaleDateString();

            return (
              <div
                key={p.projectId}
                className="card"
                style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  boxShadow: 'var(--shadow-sm)',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
                      {p.name}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {p.settings?.generationMode && (
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: p.settings.generationMode.includes('image') ? 'var(--info-image-bg)' : 'var(--info-video-bg)',
                            color: p.settings.generationMode.includes('image') ? 'var(--info-image)' : 'var(--info-video)',
                            border: `1px solid ${p.settings.generationMode.includes('image') ? 'var(--info-image-border)' : 'var(--info-video-border)'}`,
                            textTransform: 'capitalize',
                          }}
                        >
                          {p.settings.generationMode.replace('_', ' ')}
                        </span>
                      )}
                      {p.campaignTag && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Tag: {p.campaignTag}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`badge badge-${p.status === 'completed' ? 'completed' : p.status === 'running' ? 'running' : 'draft'}`}
                  >
                    {p.status}
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
                  <span>{p.stats.totalImages} images</span>
                  <span>·</span>
                  <span>{p.stats.totalVideos} videos</span>
                  {p.settings?.videoModel && (
                    <>
                      <span>·</span>
                      <span>{p.settings.videoModel}</span>
                    </>
                  )}
                </div>

                {/* Progress bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                    <span>Progress: {completed} / {total} slots</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{percent}%</span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--bg-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${percent}%`,
                        height: '100%',
                        backgroundColor: p.status === 'completed' ? 'var(--success)' : 'var(--primary)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Modified: {updatedDate}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => setProjectToDelete(p)}
                      title="Delete project"
                    >
                      <TrashIcon size={12} />
                      Delete
                    </button>
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => onOpenProject(p.projectId)}
                    >
                      <PlayIcon size={12} />
                      Open
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={projectToDelete !== null}
        title="Delete Project"
        message={
          projectToDelete?.status === 'running'
            ? `WARNING: "${projectToDelete?.name}" is currently generating! Deleting will cancel all in-flight generation jobs, close active automation tabs, and permanently delete all output media files from disk. Are you sure?`
            : `Are you sure you want to delete "${projectToDelete?.name}"? All associated generated media, thumbnails, and slot records will be permanently deleted from disk.`
        }
        confirmLabel="Delete Project"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setProjectToDelete(null)}
      />
    </div>
  );
};
