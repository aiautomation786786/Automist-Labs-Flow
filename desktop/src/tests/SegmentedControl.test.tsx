/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../renderer/components/SegmentedControl';

describe('SegmentedControl', () => {
  it('renders all options and highlights the selected option', () => {
    const options = [
      { value: '16:9', label: '16:9 Landscape' },
      { value: '9:16', label: '9:16 Portrait' },
    ];
    const handleChange = vi.fn();

    render(
      <SegmentedControl
        options={options}
        value="16:9"
        onChange={handleChange}
        ariaLabel="Aspect Ratio"
      />
    );

    const btn169 = screen.getByRole('radio', { name: /16:9 Landscape/i });
    const btn916 = screen.getByRole('radio', { name: /9:16 Portrait/i });

    expect(btn169.getAttribute('aria-checked')).toBe('true');
    expect(btn916.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(btn916);
    expect(handleChange).toHaveBeenCalledWith('9:16');
  });

  it('renders badges and respects disabled state', () => {
    const options = [
      { value: 'original', label: 'Original' },
      { value: '2k', label: '2K Upscaled', badge: 'HD' },
      { value: 'disabled_opt', label: 'Disabled', disabled: true },
    ];
    const handleChange = vi.fn();

    render(
      <SegmentedControl
        options={options}
        value="original"
        onChange={handleChange}
      />
    );

    expect(screen.getByText('HD')).toBeDefined();
    const disabledBtn = screen.getByRole('radio', { name: /Disabled/i });
    expect(disabledBtn.hasAttribute('disabled')).toBe(true);

    fireEvent.click(disabledBtn);
    expect(handleChange).not.toHaveBeenCalled();
  });
});
