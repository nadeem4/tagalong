/**
 * Tests for ScoutMark: Bean's still tile beside lines Scout starts.
 * Covers the still frame and the optional animated clip. Runs on jsdom with no host bridge.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoutMark } from './scout-mark';

const IDLE = { src: 'fake://idle.webp', frames: 36, fps: 12, loop: true };

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

  it('draws Bean still when given the strip', () => {
    render(<ScoutMark clip={IDLE} />);
    expect(screen.getByTestId('bean-clip').style.backgroundPosition).toBe('0px 0px');
  });
});
