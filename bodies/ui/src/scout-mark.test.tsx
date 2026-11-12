/**
 * Tests for ScoutMark: Scout's still tile beside lines Scout starts.
 * Runs on jsdom with no host bridge.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoutMark } from './scout-mark';

describe('ScoutMark', () => {
  it('renders at 20px and is aria-hidden', () => {
    const { container } = render(<ScoutMark />);
    const mark = container.querySelector('.scout-mark') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.style.width).toBe('20px');
    expect(mark.style.height).toBe('20px');
  });

  it('takes a size', () => {
    const { container } = render(<ScoutMark size={48} />);
    expect((container.querySelector('.scout-mark') as HTMLElement).style.width).toBe('48px');
  });

  it("draws Scout's head inside the tile", () => {
    const { container } = render(<ScoutMark size={48} />);
    const glyph = container.querySelector('.scout-mark svg') as SVGElement;
    expect(glyph).not.toBeNull();
    expect(glyph.getAttribute('width')).toBe('39');
  });
});
