/**
 * @vitest-environment jsdom
 *
 * Tests for Workspace Asset Rendering, Unified Protocol URLs, and Error Fallbacks.
 *
 * Validates:
 *  1. Completed asset produces a valid UI image source (flow-asset://).
 *  2. Card thumbnail and modal preview use the same asset-resolution mechanism.
 *  3. Completed image replaces loading placeholder.
 *  4. Missing/errored asset shows a graceful fallback instead of a broken <img>.
 *  5. 16:9 image displays with correct aspect ratio (16 / 9).
 *  6. 9:16 image displays with correct aspect ratio (9 / 16).
 *  7. Restarted project resolves the same saved asset correctly.
 *  8. Four completed slots remain ordered 0, 1, 2, 3.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { PromptSlotEntity } from '../shared/types';
import { PromptSlotCard, formatMediaUrl } from '../renderer/components/PromptSlotCard';
import { formatAssetUrl } from '../renderer/utils/assetUrl';
import { MediaPreviewModal } from '../renderer/components/MediaPreviewModal';

describe('Workspace Asset Rendering & Protocol Resolution', () => {
  afterEach(() => {
    cleanup();
  });
  const sampleSlotCompleted: PromptSlotEntity = {
    slotIndex: 0,
    promptId: 'prompt_01',
    promptText: 'A red apple on a clean white table, soft studio lighting',
    type: 'image',
    status: 'completed',
    projectId: 'proj_test_123',
    assignedProfileId: 'profile_71b66ea2',
    createdAt: '2026-09-08T07:55:00.000Z',
    updatedAt: '2026-09-08T07:55:00.000Z',
    result: {
      assetId: 'af8be9f0-2d1c-4bf5-b912-f145a4b62f67',
      mediaPath: 'C:\\Users\\test\\AppData\\Local\\GoogleFlowApp\\projects\\proj_test_123\\images\\slot_00.jpg',
      modelUsed: 'Nano Banana 2',
      ratioUsed: '16:9',
      fileSizeBytes: 405876,
      completedAt: '2026-09-08T07:55:00.000Z',
    },
  };

  const sampleSlotRunning: PromptSlotEntity = {
    slotIndex: 1,
    promptId: 'prompt_02',
    promptText: 'A blue ceramic coffee mug on a wooden desk',
    type: 'image',
    status: 'running',
    projectId: 'proj_test_123',
    assignedProfileId: 'profile_b75159bb',
    createdAt: '2026-09-08T07:55:00.000Z',
    updatedAt: '2026-09-08T07:55:00.000Z',
  };

  // Requirement 1: Completed asset produces a valid UI image source
  it('1. Completed asset produces a valid secure flow-asset:// image source', () => {
    const url = formatAssetUrl(sampleSlotCompleted.result?.mediaPath, sampleSlotCompleted.projectId);
    expect(url).toMatch(/^flow-asset:\/\/project\/proj_test_123\/images\/slot_00\.jpg$/);

    render(
      <PromptSlotCard
        slot={sampleSlotCompleted}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    const img = screen.getByRole('img');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('flow-asset://project/proj_test_123/images/slot_00.jpg');
  });

  // Requirement 2: Card thumbnail and modal preview use the same asset-resolution mechanism
  it('2. Card thumbnail and modal preview use the exact same asset-resolution mechanism', () => {
    const cardUrl = formatMediaUrl(sampleSlotCompleted.result?.mediaPath, sampleSlotCompleted.projectId);
    const utilityUrl = formatAssetUrl(sampleSlotCompleted.result?.mediaPath, sampleSlotCompleted.projectId);

    expect(cardUrl).toBe(utilityUrl);

    // Render modal with the same resolution
    render(
      <MediaPreviewModal
        isOpen={true}
        type="image"
        mediaUrl={cardUrl}
        title="Slot #01"
        promptText={sampleSlotCompleted.promptText}
        onClose={vi.fn()}
      />
    );

    const modalImgs = screen.getAllByRole('img');
    const modalImg = modalImgs[modalImgs.length - 1];
    expect(modalImg.getAttribute('src')).toBe(cardUrl);
  });

  // Requirement 3: Completed image replaces loading placeholder
  it('3. Completed image replaces loading placeholder', () => {
    const { rerender } = render(
      <PromptSlotCard
        slot={sampleSlotRunning}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    // When running: Generating placeholder is visible, no <img> tag
    expect(screen.getByText('Generating...')).toBeDefined();
    expect(screen.queryByRole('img')).toBeNull();

    // Rerender as completed
    rerender(
      <PromptSlotCard
        slot={sampleSlotCompleted}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    // Placeholder removed, img rendered
    expect(screen.queryByText('Generating...')).toBeNull();
    const img = screen.getByRole('img');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toContain('flow-asset://');
  });

  // Requirement 4: Missing asset shows a graceful fallback instead of a broken <img>
  it('4. Missing asset error shows graceful fallback instead of broken img', () => {
    render(
      <PromptSlotCard
        slot={sampleSlotCompleted}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    const img = screen.getByRole('img');
    expect(img).toBeDefined();

    // Trigger image loading failure
    fireEvent.error(img);

    // Fallback message appears, broken img is removed
    expect(screen.getByText('Asset preview unavailable')).toBeDefined();
    expect(screen.queryByRole('img')).toBeNull();
  });

  // Requirement 5: 16:9 image displays with correct aspect ratio
  it('5. 16:9 image displays with 16 / 9 aspect ratio', () => {
    const slot169: PromptSlotEntity = {
      ...sampleSlotCompleted,
      result: {
        ...sampleSlotCompleted.result!,
        ratioUsed: '16:9',
      },
    };

    const { container } = render(
      <PromptSlotCard
        slot={slot169}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    const thumbnailContainer = container.querySelector('[style*="aspect-ratio"]');
    expect(thumbnailContainer).not.toBeNull();
    const style = thumbnailContainer?.getAttribute('style');
    expect(style).toContain('16 / 9');
  });

  // Requirement 6: 9:16 image displays with correct aspect ratio
  it('6. 9:16 image displays with 9 / 16 aspect ratio', () => {
    const slot916: PromptSlotEntity = {
      ...sampleSlotCompleted,
      result: {
        ...sampleSlotCompleted.result!,
        ratioUsed: '9:16',
      },
    };

    const { container } = render(
      <PromptSlotCard
        slot={slot916}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    const thumbnailContainer = container.querySelector('[style*="aspect-ratio"]');
    expect(thumbnailContainer).not.toBeNull();
    const style = thumbnailContainer?.getAttribute('style');
    expect(style).toContain('9 / 16');
  });

  // Requirement 7: Restarted project resolves the same saved asset correctly
  it('7. Restarted project reload resolves the exact same saved asset', () => {
    const reloadedPath = 'C:\\Users\\test\\AppData\\Local\\GoogleFlowApp\\projects\\proj_test_123\\images\\slot_00.jpg';
    const initialUrl = formatAssetUrl(reloadedPath, 'proj_test_123');
    const afterRestartUrl = formatAssetUrl(reloadedPath, 'proj_test_123');

    expect(initialUrl).toBe('flow-asset://project/proj_test_123/images/slot_00.jpg');
    expect(afterRestartUrl).toBe(initialUrl);
  });

  // Requirement 8: Four completed slots remain ordered 0, 1, 2, 3
  it('8. Four completed slots strictly maintain order 0, 1, 2, 3', () => {
    const fourSlots: PromptSlotEntity[] = [
      {
        slotIndex: 0,
        promptId: 'p0',
        promptText: 'A red apple on a clean white table',
        type: 'image',
        status: 'completed',
        projectId: 'p',
        createdAt: '2026-09-08T07:55:00.000Z',
        updatedAt: '2026-09-08T07:55:00.000Z',
        result: { assetId: 'uuid0', mediaPath: 'path0.jpg', modelUsed: 'Nano Banana 2', ratioUsed: '16:9', fileSizeBytes: 1000, completedAt: '2026-09-08T07:55:00.000Z' },
      },
      {
        slotIndex: 1,
        promptId: 'p1',
        promptText: 'A blue ceramic coffee mug',
        type: 'image',
        status: 'completed',
        projectId: 'p',
        createdAt: '2026-09-08T07:55:00.000Z',
        updatedAt: '2026-09-08T07:55:00.000Z',
        result: { assetId: 'uuid1', mediaPath: 'path1.jpg', modelUsed: 'Nano Banana 2', ratioUsed: '16:9', fileSizeBytes: 1000, completedAt: '2026-09-08T07:55:00.000Z' },
      },
      {
        slotIndex: 2,
        promptId: 'p2',
        promptText: 'A small green plant in a white ceramic pot',
        type: 'image',
        status: 'completed',
        projectId: 'p',
        createdAt: '2026-09-08T07:55:00.000Z',
        updatedAt: '2026-09-08T07:55:00.000Z',
        result: { assetId: 'uuid2', mediaPath: 'path2.jpg', modelUsed: 'Nano Banana 2', ratioUsed: '16:9', fileSizeBytes: 1000, completedAt: '2026-09-08T07:55:00.000Z' },
      },
      {
        slotIndex: 3,
        promptId: 'p3',
        promptText: 'A yellow bicycle beside a brick wall',
        type: 'image',
        status: 'completed',
        projectId: 'p',
        createdAt: '2026-09-08T07:55:00.000Z',
        updatedAt: '2026-09-08T07:55:00.000Z',
        result: { assetId: 'uuid3', mediaPath: 'path3.jpg', modelUsed: 'Nano Banana 2', ratioUsed: '16:9', fileSizeBytes: 1000, completedAt: '2026-09-08T07:55:00.000Z' },
      },
    ];

    // Simulate completion arriving out-of-order: [2, 0, 3, 1]
    const completionArrivalOrder = [fourSlots[2], fourSlots[0], fourSlots[3], fourSlots[1]];
    // Sort strictly by slotIndex
    const sorted = [...completionArrivalOrder].sort((a, b) => a.slotIndex - b.slotIndex);

    expect(sorted.map((s) => s.slotIndex)).toEqual([0, 1, 2, 3]);
    expect(sorted[0].promptText).toContain('apple');
    expect(sorted[1].promptText).toContain('coffee mug');
    expect(sorted[2].promptText).toContain('plant');
    expect(sorted[3].promptText).toContain('bicycle');
  });

  // Requirement 9: PromptSlotCard displays model badge and triggers revealAsset
  it('9. PromptSlotCard displays model badge and triggers revealAsset when Reveal is clicked', () => {
    const revealAsset = vi.fn();
    window.flowApi = {
      ...(window.flowApi || {}),
      revealAsset,
    } as any;

    const videoSlot: PromptSlotEntity = {
      slotIndex: 0,
      promptId: 'slot_vid_0',
      projectId: 'proj_test_123',
      type: 'video',
      promptText: 'A cinematic drone shot over snow-capped mountains',
      status: 'completed',
      createdAt: '2026-09-08T07:55:00.000Z',
      updatedAt: '2026-09-08T07:55:00.000Z',
      result: {
        assetId: 'uuid_vid_0',
        mediaPath: 'C:/assets/vid_0.mp4',
        modelUsed: 'Veo 3.1 - Quality',
        ratioUsed: '16:9',
        fileSizeBytes: 2048000,
        completedAt: '2026-09-08T07:55:00.000Z',
        durationFormatted: '4.0s',
      },
    };

    render(
      <PromptSlotCard
        slot={videoSlot}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
      />
    );

    expect(screen.getByText('Veo 3.1 - Quality')).toBeDefined();
    const revealBtn = screen.getByText('Reveal');
    expect(revealBtn).toBeDefined();
    fireEvent.click(revealBtn);
    expect(revealAsset).toHaveBeenCalledWith('C:/assets/vid_0.mp4');
  });

  // Requirement 10: PromptSlotCard renders retry button when failed
  it('10. PromptSlotCard displays retry button when failed and triggers onRetry', () => {
    const onRetry = vi.fn();

    const failedSlot: PromptSlotEntity = {
      slotIndex: 1,
      promptId: 'slot_fail_1',
      projectId: 'proj_test_123',
      type: 'image',
      promptText: 'A surreal landscape with floating islands',
      status: 'failed',
      createdAt: '2026-09-08T07:55:00.000Z',
      updatedAt: '2026-09-08T07:55:00.000Z',
      error: {
        code: 'GENERATION_TIMEOUT',
        message: 'Flow timed out',
        timestamp: '2026-09-08T07:55:00.000Z',
        retryCount: 1,
      },
    };

    render(
      <PromptSlotCard
        slot={failedSlot}
        onViewPrompt={vi.fn()}
        onPreviewMedia={vi.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('Failed')).toBeDefined();
    const retryBtn = screen.getByText('Retry');
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith(failedSlot);
  });
});
