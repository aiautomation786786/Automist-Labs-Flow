/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { SkillsScreen } from '../renderer/screens/SkillsScreen';
import type { SkillEntity } from '../shared/types';

describe('SkillsScreen React UI Component Tests', () => {
  const mockSkills: SkillEntity[] = [
    {
      id: 'skill_1',
      name: 'Cinematic Documentary',
      description: 'Documentary style with deep atmospheric visual prompts.',
      systemInstructions: 'Act as lead narrator.',
      writingStyle: 'Objective, profound, measured',
      promptGuidance: 'Cinematic 35mm film photography',
      channelCompatibility: ['doc', 'history'],
      enabled: true,
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    },
    {
      id: 'skill_2',
      name: 'Viral Explainer / Shorts',
      description: 'High retention, fast hook, punchy educational script.',
      systemInstructions: 'Deliver punchy hooks.',
      writingStyle: 'Conversational, energetic',
      promptGuidance: 'High contrast vibrant focal subject',
      channelCompatibility: ['shorts', 'tiktok'],
      enabled: true,
      createdAt: '2026-03-02T10:00:00.000Z',
      updatedAt: '2026-03-02T10:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).flowApi = {
      listSkills: vi.fn().mockResolvedValue(mockSkills),
      createSkill: vi.fn(),
      updateSkill: vi.fn(),
      deleteSkill: vi.fn().mockResolvedValue({ success: true }),
      importSkill: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. Renders SkillsScreen header, search, and skill cards', async () => {
    await act(async () => {
      render(<SkillsScreen />);
    });

    expect(await screen.findByText('Skills Library')).toBeTruthy();
    expect(screen.getByText('Phase 8')).toBeTruthy();
    expect(screen.getByText('Cinematic Documentary')).toBeTruthy();
    expect(screen.getByText('Viral Explainer / Shorts')).toBeTruthy();
    expect(screen.getByText(/2 skills available/i)).toBeTruthy();
  });

  it('2. Filters skills list when searching query', async () => {
    await act(async () => {
      render(<SkillsScreen />);
    });

    await screen.findByText('Cinematic Documentary');

    const searchInput = screen.getByPlaceholderText(/Search skills by name/i);
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Viral' } });
    });

    expect(screen.queryByText('Cinematic Documentary')).toBeNull();
    expect(screen.getByText('Viral Explainer / Shorts')).toBeTruthy();
  });

  it('3. Opens SkillModal when New Skill button is clicked', async () => {
    await act(async () => {
      render(<SkillsScreen />);
    });

    await screen.findByText('Skills Library');
    const newBtn = screen.getByRole('button', { name: /New Skill/i });
    act(() => {
      fireEvent.click(newBtn);
    });

    expect(await screen.findByText('Create New Skill')).toBeTruthy();
    expect(screen.getByText('1. Persona & Style')).toBeTruthy();
    expect(screen.getByText('2. Structure & Pacing')).toBeTruthy();
    expect(screen.getByText('3. Visual Prompting')).toBeTruthy();
  });

  it('4. Triggers deletion confirmation modal and deletes skill safely', async () => {
    await act(async () => {
      render(<SkillsScreen />);
    });

    await screen.findByText('Cinematic Documentary');
    const deleteButtons = screen.getAllByTitle('Delete Skill');
    expect(deleteButtons.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(deleteButtons[0]!);
    });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete Skill' })).toBeTruthy();
    expect(within(dialog).getByText(/Projects and media will never be deleted/i)).toBeTruthy();

    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete Skill' });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(window.flowApi!.deleteSkill).toHaveBeenCalledWith('skill_1');
    });
  });

  it('5. Invokes onNavigateVideoFactory with skillId when Use in Video is clicked', async () => {
    const onNavigateVideoFactory = vi.fn();
    await act(async () => {
      render(<SkillsScreen onNavigateVideoFactory={onNavigateVideoFactory} />);
    });

    await screen.findByText('Cinematic Documentary');
    const useBtns = screen.getAllByRole('button', { name: /Use in Video/i });
    expect(useBtns.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(useBtns[0]!);
    });
    expect(onNavigateVideoFactory).toHaveBeenCalledWith('skill_1');
  });
});
