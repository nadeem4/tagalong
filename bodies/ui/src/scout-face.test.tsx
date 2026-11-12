/**
 * Tests for ScoutFace's fallback: with no WebGL2 (a VM, RDP, a blocklisted GPU) it draws the
 * still SVG head instead of the live mascot, so the dock never crashes the avatar window.
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supported = vi.hoisted(() => ({ value: true }));
const warm = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => ({ ready: () => {} }));

vi.mock('@tagalong/mascot', async (original) => ({
  ...(await original<typeof import('@tagalong/mascot')>()),
  isSupported: () => supported.value,
  warm,
}));
vi.mock('@tagalong/mascot/react', () => ({
  Mascot: ({ onReady }: { onReady?: () => void }) => {
    live.ready = onReady ?? (() => {});
    return <div data-testid="live-mascot" />;
  },
}));

import { scout } from './mascot/scout';
import { ScoutFace } from './scout-face';

beforeEach(() => {
  warm.mockClear();
});

describe('ScoutFace', () => {
  it('draws the live mascot when WebGL2 is there', () => {
    supported.value = true;
    const { queryByTestId } = render(<ScoutFace spec={scout} mood="idle" />);
    expect(queryByTestId('live-mascot')).not.toBeNull();
  });

  it('falls back to the still head, without building a context, when WebGL2 is missing', () => {
    supported.value = false;
    const { queryByTestId, container } = render(<ScoutFace spec={scout} mood="working" />);
    expect(queryByTestId('live-mascot')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(warm).not.toHaveBeenCalled();
  });

  it('does not build the shader while rendering, only after mount', () => {
    supported.value = true;
    const spec = { ...scout };
    render(<ScoutFace spec={spec} mood="idle" />);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('shows the still head from the first render, never a blank box, and swaps once the live frame is drawn', () => {
    supported.value = true;
    const { queryByTestId, container, getByTestId } = render(
      <ScoutFace spec={scout} mood="idle" />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(getByTestId('scout-face')).not.toHaveAttribute('data-live');
    act(() => live.ready());
    expect(getByTestId('scout-face')).toHaveAttribute('data-live', 'ready');
    expect(queryByTestId('live-mascot')).not.toBeNull();
  });

  it('keeps the still head under the canvas until its fade-in ends, then removes it', () => {
    vi.useFakeTimers();
    supported.value = true;
    const { container } = render(<ScoutFace spec={scout} mood="idle" />);
    act(() => live.ready());
    expect(container.querySelector('svg')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('svg')).toBeNull();
    vi.useRealTimers();
  });

  it('starts over when the spec changes: the still head is back until the new one draws', () => {
    vi.useFakeTimers();
    supported.value = true;
    const { container, rerender, getByTestId } = render(<ScoutFace spec={scout} mood="idle" />);
    act(() => live.ready());
    act(() => {
      vi.advanceTimersByTime(250);
    });
    rerender(<ScoutFace spec={{ ...scout }} mood="idle" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(getByTestId('scout-face')).not.toHaveAttribute('data-live');
    vi.useRealTimers();
  });
});
