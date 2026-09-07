/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from '../renderer/components/ConfirmModal';
import { FullPromptModal } from '../renderer/components/FullPromptModal';
import { MediaPreviewModal } from '../renderer/components/MediaPreviewModal';

describe('UI Modals', () => {
  describe('ConfirmModal', () => {
    it('renders title, message, and handles confirm/cancel clicks', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmModal
          isOpen={true}
          title="Delete Project?"
          message="This cannot be undone."
          confirmLabel="Yes, Delete"
          isDanger={true}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Delete Project?')).toBeDefined();
      expect(screen.getByText('This cannot be undone.')).toBeDefined();

      fireEvent.click(screen.getByText('Yes, Delete'));
      expect(onConfirm).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <ConfirmModal
          isOpen={false}
          title="Delete Project?"
          message="This cannot be undone."
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('FullPromptModal', () => {
    it('renders full prompt text and slot information', () => {
      const onClose = vi.fn();
      const promptText = 'Cinematic close-up portrait of a cyberpunk hacker in neon rain';

      render(
        <FullPromptModal
          isOpen={true}
          slotIndex={2}
          promptText={promptText}
          type="image"
          onClose={onClose}
        />
      );

      expect(screen.getByText(/Slot #03/i)).toBeDefined();
      expect(screen.getByText(promptText)).toBeDefined();

      fireEvent.click(screen.getByText('Close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('MediaPreviewModal', () => {
    it('renders image lightbox preview when media is an image', () => {
      const onClose = vi.fn();

      render(
        <MediaPreviewModal
          isOpen={true}
          type="image"
          mediaUrl="flow-asset://C:/appdata/projects/p1/assets/img_0.png"
          title="Slot #01 Preview"
          onClose={onClose}
        />
      );

      expect(screen.getByText('Slot #01 Preview')).toBeDefined();
      const img = screen.getByAltText('Slot #01 Preview') as HTMLImageElement;
      expect(img).toBeDefined();
      expect(img.src).toContain('flow-asset://');

      fireEvent.click(screen.getByText('Close Preview'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders video player when media is a video', () => {
      render(
        <MediaPreviewModal
          isOpen={true}
          type="video"
          mediaUrl="flow-asset://C:/appdata/projects/p1/assets/vid_1.mp4"
          title="Slot #02 Preview"
          onClose={() => {}}
        />
      );

      expect(screen.getByText('Slot #02 Preview')).toBeDefined();
      const video = document.querySelector('video');
      expect(video).toBeDefined();
      expect(video?.getAttribute('src')).toContain('flow-asset://');
    });
  });
});
