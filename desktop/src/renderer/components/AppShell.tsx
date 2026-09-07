import React, { useState } from 'react';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { NewProjectScreen } from '../screens/NewProjectScreen';
import { WorkspaceScreen } from '../screens/WorkspaceScreen';
import { ProfilesScreen } from '../screens/ProfilesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { FolderIcon, PlusIcon, UsersIcon, SettingsIcon } from './Icons';

type View =
  | { type: 'projects' }
  | { type: 'new_project' }
  | { type: 'workspace'; projectId: string }
  | { type: 'profiles' }
  | { type: 'settings' };

export const AppShell: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>({ type: 'projects' });

  const navItems = [
    {
      id: 'projects',
      label: 'Projects',
      icon: <FolderIcon size={16} />,
      isActive: currentView.type === 'projects' || currentView.type === 'workspace',
      onClick: () => setCurrentView({ type: 'projects' }),
    },
    {
      id: 'new_project',
      label: 'New Project',
      icon: <PlusIcon size={16} />,
      isActive: currentView.type === 'new_project',
      onClick: () => setCurrentView({ type: 'new_project' }),
    },
    {
      id: 'profiles',
      label: 'Profiles',
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
  ];

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar Navigation */}
      <nav
        style={{
          width: '220px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Brand */}
        <div
          style={{
            padding: '18px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              backgroundColor: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            F
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', lineHeight: 1.2 }}>Google Flow</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Desktop Manager</div>
          </div>
        </div>

        {/* Nav Links */}
        <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={item.onClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: item.isActive ? 'var(--primary-subtle)' : 'transparent',
                color: item.isActive ? 'var(--primary)' : 'var(--text-secondary)',
                fontWeight: item.isActive ? 600 : 500,
                border: 'none',
                textAlign: 'left',
                justifyContent: 'flex-start',
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* Bottom meta / system info */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-color)', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div>Automist Labs · v1.0.0</div>
          <div>Windows x64 Native</div>
        </div>
      </nav>

      {/* Main Content Viewport */}
      <main style={{ flex: 1, height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-app)' }}>
        {currentView.type === 'projects' && (
          <ProjectsScreen
            onOpenProject={(projectId) => setCurrentView({ type: 'workspace', projectId })}
            onNavigateNewProject={() => setCurrentView({ type: 'new_project' })}
          />
        )}

        {currentView.type === 'new_project' && (
          <NewProjectScreen
            onProjectCreated={(projectId) => setCurrentView({ type: 'workspace', projectId })}
            onCancel={() => setCurrentView({ type: 'projects' })}
            onNavigateProfiles={() => setCurrentView({ type: 'profiles' })}
          />
        )}

        {currentView.type === 'workspace' && (
          <WorkspaceScreen
            projectId={currentView.projectId}
            onBackToProjects={() => setCurrentView({ type: 'projects' })}
          />
        )}

        {currentView.type === 'profiles' && <ProfilesScreen />}

        {currentView.type === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
};
