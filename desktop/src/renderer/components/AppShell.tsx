import React, { useState, useEffect, useMemo } from 'react';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { NewProjectScreen } from '../screens/NewProjectScreen';
import { GenerationStudioScreen, type GenerationMode } from '../screens/GenerationStudioScreen';
import { WorkspaceScreen } from '../screens/WorkspaceScreen';
import { ProfilesScreen } from '../screens/ProfilesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CreateVideoScreen } from '../screens/CreateVideoScreen';
import { ChannelsScreen } from '../screens/ChannelsScreen';
import { SkillsScreen } from '../screens/SkillsScreen';
import {
  FolderIcon,
  ImageIcon,
  VideoIcon,
  LayersIcon,
  ClapperboardIcon,
  SparklesIcon,
  UsersIcon,
  SettingsIcon,
  TvIcon,
} from './Icons';
import { InfinityFlowMark } from './InfinityFlowLogo';
import type { ProfileSessionSnapshot, VideoFactoryMode } from '../../shared/types';

type View =
  | { type: 'projects' }
  | { type: 'single_image' }
  | { type: 'single_video' }
  | { type: 'bulk_image' }
  | { type: 'bulk_video' }
  | { type: 'image_to_video' }
  | { type: 'bulk_image_to_video' }
  | { type: 'new_generation'; initialMode?: GenerationMode }
  | { type: 'new_project' }
  | { type: 'workspace'; projectId: string }
  | { type: 'create_video'; initialMode?: VideoFactoryMode; initialSkillId?: string }
  | { type: 'channels' }
  | { type: 'skills' }
  | { type: 'profiles' }
  | { type: 'settings' };

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
  badgeBg?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const AppShell: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>({ type: 'projects' });
  const [readyProfilesCount, setReadyProfilesCount] = useState<number>(0);

  // All-Pages-Mounted Architecture (ZBot §4 Parity):
  // Preserve screen instances in the DOM once visited so form state, wizard progress,
  // scroll position, and active event listeners are preserved across tab switches.
  const [visitedViews, setVisitedViews] = useState<Set<string>>(new Set(['projects']));
  const [activeWorkspaceProjectId, setActiveWorkspaceProjectId] = useState<string | null>(null);
  const [createVideoProps, setCreateVideoProps] = useState<{
    initialMode?: VideoFactoryMode;
    initialSkillId?: string;
  }>({});

  const isGenerationStudio =
    currentView.type === 'single_image' ||
    currentView.type === 'single_video' ||
    currentView.type === 'bulk_image' ||
    currentView.type === 'bulk_video' ||
    currentView.type === 'image_to_video' ||
    currentView.type === 'bulk_image_to_video' ||
    currentView.type === 'new_generation';

  const viewCategory = isGenerationStudio ? 'generation_studio' : currentView.type;

  useEffect(() => {
    setVisitedViews((prev) => {
      if (prev.has(viewCategory)) return prev;
      const next = new Set(prev);
      next.add(viewCategory);
      return next;
    });

    if (currentView.type === 'workspace') {
      setActiveWorkspaceProjectId(currentView.projectId);
    } else if (currentView.type === 'create_video') {
      setCreateVideoProps({
        initialMode: currentView.initialMode,
        initialSkillId: currentView.initialSkillId,
      });
    }
  }, [currentView, viewCategory]);

  useEffect(() => {
    const fetchProfilesStatus = async () => {
      if (!window.flowApi) return;
      try {
        const list = await window.flowApi.listProfiles();
        const readyCount = list.filter((p: ProfileSessionSnapshot) => p.status === 'ready').length;
        setReadyProfilesCount(readyCount);
      } catch (err) {
        console.error('Failed to query profiles status in AppShell', err);
      }
    };

    fetchProfilesStatus();
    if (window.flowApi) {
      const unsub = window.flowApi.onWorkerStatus(() => {
        fetchProfilesStatus();
      });
      return () => unsub();
    }
  }, []);

  const navSections: NavSection[] = useMemo(() => [
    {
      title: 'PROJECTS',
      items: [
        {
          id: 'projects',
          label: 'Projects',
          icon: <FolderIcon size={16} />,
          isActive: currentView.type === 'projects' || currentView.type === 'workspace',
          onClick: () => setCurrentView({ type: 'projects' }),
        },
      ],
    },
    {
      title: 'VIDEO FACTORY',
      items: [
        {
          id: 'create_video',
          label: 'Create Video',
          icon: <SparklesIcon size={16} />,
          isActive: currentView.type === 'create_video',
          onClick: () => setCurrentView({ type: 'create_video' }),
        },
        {
          id: 'channels',
          label: 'Channels',
          icon: <TvIcon size={16} />,
          isActive: currentView.type === 'channels',
          onClick: () => setCurrentView({ type: 'channels' }),
        },
      ],
    },
    {
      title: 'GOOGLE FLOW',
      items: [
        {
          id: 'single_image',
          label: 'Single Image',
          icon: <ImageIcon size={16} />,
          isActive: currentView.type === 'single_image' || (currentView.type === 'new_generation' && currentView.initialMode === 'single_image'),
          onClick: () => setCurrentView({ type: 'single_image' }),
        },
        {
          id: 'single_video',
          label: 'Single Video',
          icon: <VideoIcon size={16} />,
          isActive: currentView.type === 'single_video' || (currentView.type === 'new_generation' && currentView.initialMode === 'single_video'),
          onClick: () => setCurrentView({ type: 'single_video' }),
        },
        {
          id: 'bulk_image',
          label: 'Bulk Image',
          icon: <LayersIcon size={16} />,
          isActive: currentView.type === 'bulk_image' || (currentView.type === 'new_generation' && currentView.initialMode === 'bulk_image'),
          onClick: () => setCurrentView({ type: 'bulk_image' }),
        },
        {
          id: 'bulk_video',
          label: 'Bulk Video',
          icon: <ClapperboardIcon size={16} />,
          isActive: currentView.type === 'bulk_video' || (currentView.type === 'new_generation' && currentView.initialMode === 'bulk_video'),
          onClick: () => setCurrentView({ type: 'bulk_video' }),
        },
        {
          id: 'image_to_video',
          label: 'Image to Video',
          icon: <VideoIcon size={16} />,
          isActive: currentView.type === 'image_to_video' || (currentView.type === 'new_generation' && currentView.initialMode === 'image_to_video'),
          onClick: () => setCurrentView({ type: 'image_to_video' }),
        },
        {
          id: 'bulk_image_to_video',
          label: 'Bulk Image to Video',
          icon: <ClapperboardIcon size={16} />,
          isActive: currentView.type === 'bulk_image_to_video' || (currentView.type === 'new_generation' && currentView.initialMode === 'bulk_image_to_video'),
          onClick: () => setCurrentView({ type: 'bulk_image_to_video' }),
        },
      ],
    },
    {
      title: 'MANAGEMENT',
      items: [
        {
          id: 'profiles',
          label: 'Flow Accounts',
          icon: <UsersIcon size={16} />,
          isActive: currentView.type === 'profiles',
          onClick: () => setCurrentView({ type: 'profiles' }),
        },
        {
          id: 'settings',
          label: 'Settings',
          icon: <SettingsIcon size={16} />,
          isActive: currentView.type === 'settings',
          onClick: () => setCurrentView({ type: 'settings' }),
        },
      ],
    },
  ], [currentView]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-app)' }}>
      {/* Sidebar Navigation */}
      <nav
        style={{
          width: '236px',
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Brand Header */}
        <div
          style={{
            padding: '18px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--infinity-glow, 0 0 15px rgba(99, 102, 241, 0.35))',
              flexShrink: 0,
            }}
          >
            <InfinityFlowMark size={24} />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.15, letterSpacing: '0.03em' }}>
              INFINITY{' '}
              <span
                style={{
                  background: 'var(--infinity-gradient, linear-gradient(135deg, #06b6d4 0%, #6366f1 50%, #8b5cf6 100%))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                FLOW
              </span>
            </div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '2px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              AI Video Automation
            </div>
          </div>
        </div>

        {/* Navigation Sections */}
        <div style={{ padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
          {navSections.map((sec) => (
            <div key={sec.title} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  color: 'var(--text-muted)',
                  padding: '4px 10px 6px',
                  textTransform: 'uppercase',
                }}
              >
                {sec.title}
              </div>
              {sec.items.map((item) => {
                const active = item.isActive;
                return (
                  <button
                    key={item.id}
                    data-testid={`nav-item-${item.id}`}
                    onClick={item.onClick}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '8px 12px 8px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: active ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                      color: active ? '#ffffff' : 'var(--text-secondary)',
                      fontWeight: active ? 600 : 500,
                      border: active ? '1px solid rgba(99, 102, 241, 0.28)' : '1px solid transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {active && (
                      <span
                        style={{
                          position: 'absolute',
                          left: '0px',
                          top: '6px',
                          bottom: '6px',
                          width: '3px',
                          borderRadius: '0 2px 2px 0',
                          backgroundColor: 'var(--primary)',
                          boxShadow: '0 0 6px var(--primary)',
                        }}
                      />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color: active ? 'var(--primary)' : 'var(--text-muted)' }}>
                        {item.icon}
                      </span>
                      <span style={{ fontSize: '13px' }}>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1.5px 6px',
                          borderRadius: '4px',
                          color: item.badgeColor,
                          backgroundColor: item.badgeBg,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Footer: Flow Accounts Readiness & Build Metadata */}
        <div
          style={{
            padding: '14px 16px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            onClick={() => setCurrentView({ type: 'profiles' })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
            }}
            title="Click to manage Flow Accounts"
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: readyProfilesCount > 0 ? 'var(--success)' : 'var(--warning)',
                boxShadow: readyProfilesCount > 0 ? '0 0 6px var(--success)' : 'none',
              }}
            />
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {readyProfilesCount > 0
                ? `${readyProfilesCount} ${readyProfilesCount === 1 ? 'Account' : 'Accounts'} Ready`
                : 'No Accounts Ready'}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)' }}>
            <span>Infinity Flow</span>
            <span>v1.0.0 · x64</span>
          </div>
        </div>
      </nav>

      {/* Main Content Viewport */}
      <main style={{ flex: 1, height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-app)', position: 'relative' }}>
        {visitedViews.has('projects') && (
          <div
            data-testid="view-container-projects"
            style={{
              display: currentView.type === 'projects' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <ProjectsScreen
              onOpenProject={(projectId) => setCurrentView({ type: 'workspace', projectId })}
              onNavigateNewProject={() => setCurrentView({ type: 'single_image' })}
            />
          </div>
        )}

        {visitedViews.has('generation_studio') && (
          <div
            data-testid="view-container-generation-studio"
            style={{
              display: isGenerationStudio ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <GenerationStudioScreen
              key={
                currentView.type === 'new_generation'
                  ? currentView.initialMode || 'single_image'
                  : currentView.type
              }
              initialMode={
                currentView.type === 'single_image'
                  ? 'single_image'
                  : currentView.type === 'single_video'
                  ? 'single_video'
                  : currentView.type === 'bulk_image'
                  ? 'bulk_image'
                  : currentView.type === 'bulk_video'
                  ? 'bulk_video'
                  : currentView.type === 'image_to_video'
                  ? 'image_to_video'
                  : currentView.type === 'bulk_image_to_video'
                  ? 'bulk_image_to_video'
                  : currentView.type === 'new_generation'
                  ? currentView.initialMode || 'single_image'
                  : 'single_image'
              }
              onProjectCreated={(projectId) => setCurrentView({ type: 'workspace', projectId })}
              onCancel={() => setCurrentView({ type: 'projects' })}
              onNavigateProfiles={() => setCurrentView({ type: 'profiles' })}
            />
          </div>
        )}

        {visitedViews.has('new_project') && (
          <div
            data-testid="view-container-new-project"
            style={{
              display: currentView.type === 'new_project' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <NewProjectScreen
              onProjectCreated={(projectId) => setCurrentView({ type: 'workspace', projectId })}
              onCancel={() => setCurrentView({ type: 'projects' })}
              onNavigateProfiles={() => setCurrentView({ type: 'profiles' })}
            />
          </div>
        )}

        {activeWorkspaceProjectId && visitedViews.has('workspace') && (
          <div
            data-testid="view-container-workspace"
            style={{
              display: currentView.type === 'workspace' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <WorkspaceScreen
              key={`workspace-${activeWorkspaceProjectId}`}
              projectId={activeWorkspaceProjectId}
              onBackToProjects={() => setCurrentView({ type: 'projects' })}
            />
          </div>
        )}

        {visitedViews.has('profiles') && (
          <div
            data-testid="view-container-profiles"
            style={{
              display: currentView.type === 'profiles' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <ProfilesScreen />
          </div>
        )}

        {visitedViews.has('create_video') && (
          <div
            data-testid="view-container-create-video"
            style={{
              display: currentView.type === 'create_video' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <CreateVideoScreen
              initialMode={createVideoProps.initialMode}
              initialSkillId={createVideoProps.initialSkillId}
              onProjectCreated={(projectId) => setCurrentView({ type: 'workspace', projectId })}
              onCancel={() => setCurrentView({ type: 'projects' })}
            />
          </div>
        )}

        {visitedViews.has('channels') && (
          <div
            data-testid="view-container-channels"
            style={{
              display: currentView.type === 'channels' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <ChannelsScreen
              onOpenProject={(projectId) => setCurrentView({ type: 'workspace', projectId })}
              onNavigateVideoFactory={() => setCurrentView({ type: 'create_video' })}
            />
          </div>
        )}

        {visitedViews.has('skills') && (
          <div
            data-testid="view-container-skills"
            style={{
              display: currentView.type === 'skills' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <SkillsScreen
              onNavigateVideoFactory={(skillId) =>
                setCurrentView({ type: 'create_video', initialMode: 'from_skill', initialSkillId: skillId })
              }
            />
          </div>
        )}

        {visitedViews.has('settings') && (
          <div
            data-testid="view-container-settings"
            style={{
              display: currentView.type === 'settings' ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <SettingsScreen />
          </div>
        )}
      </main>
    </div>
  );
};

