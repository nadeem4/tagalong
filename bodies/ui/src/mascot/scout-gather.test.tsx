/** Tests for ScoutGather: one frame loop only while needed, none for reduced motion. */

import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoutGather } from './scout-gather';

let now = 0;
let frames: FrameRequestCallback[] = [];

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
}

// Run the queued frames once, `ms` later.
function tick(ms: number) {
  now += ms;
  const run = frames;
  frames = [];
  act(() => run.forEach((f) => f(now)));
}

beforeEach(() => {
  now = 0;
  frames = [];
  stubReducedMotion(false);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const ctx = new Proxy(
    { getImageData: () => ({ data: new Uint8ClampedArray(96 * 96 * 4) }) } as Record<
      string,
      unknown
    >,
    { get: (o, k: string) => (k in o ? o[k] : () => {}), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ScoutGather', () => {
  it('runs no frame loop when idle', () => {
    render(<ScoutGather state="idle" size={96} />);
    expect(frames).toHaveLength(0);
  });

  it('loops while starting and stops after the ready fade', () => {
    const { rerender } = render(<ScoutGather state="starting" size={96} />);
    expect(frames).toHaveLength(1);
    tick(16);
    expect(frames).toHaveLength(1);
    rerender(<ScoutGather state="ready" size={96} />);
    for (let i = 0; i < 150; i++) tick(16);
    expect(frames).toHaveLength(0);
  });

  it('draws no loop for reduced motion', () => {
    stubReducedMotion(true);
    const { container, rerender } = render(<ScoutGather state="starting" size={96} />);
    expect(frames).toHaveLength(0);
    rerender(<ScoutGather state="ready" size={96} />);
    expect(frames).toHaveLength(0);
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
