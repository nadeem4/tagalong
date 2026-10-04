import { describe, expect, it } from 'vitest';
import { FrameRing } from './frame-ring';
import type { Moment } from './frame-ring';

const MINUTE = 60_000;

function moment(at: number, displayIds: number[] = [1]): Moment {
  return {
    at,
    frames: displayIds.map((displayId) => ({
      displayId,
      png: Buffer.from(`frame-${displayId}-${at}`),
      width: 640,
      height: 360,
      displayWidth: 1920,
      displayHeight: 1080,
    })),
    windows: [],
  };
}

describe('FrameRing', () => {
  it('keeps exactly the window it was given and evicts anything older', () => {
    const ring = new FrameRing(10 * MINUTE);
    for (let at = 0; at <= 15 * MINUTE; at += 5_000) ring.push(moment(at));

    // Ten minutes at one frame every five seconds, plus the frame at the boundary.
    expect(ring.size).toBe(121);
    expect(ring.oldest()?.at).toBe(5 * MINUTE);
    expect(ring.newest()?.at).toBe(15 * MINUTE);
  });

  it('evicts on demand, so a quiet buffer does not keep stale frames forever', () => {
    const ring = new FrameRing(MINUTE);
    ring.push(moment(0));
    ring.push(moment(30_000));
    ring.evict(75_000);
    expect(ring.size).toBe(1);
    ring.evict(200_000);
    expect(ring.size).toBe(0);
  });

  it('shrinking the window takes effect at once', () => {
    const ring = new FrameRing(10 * MINUTE);
    for (let at = 0; at <= 10 * MINUTE; at += MINUTE) ring.push(moment(at));
    ring.setWindow(2 * MINUTE);
    expect(ring.oldest()?.at).toBe(8 * MINUTE);
  });

  it('finds the moment nearest a time, on either side of it', () => {
    const ring = new FrameRing(10 * MINUTE);
    for (const at of [0, 5_000, 10_000, 15_000]) ring.push(moment(at));
    expect(ring.nearest(6_000)?.at).toBe(5_000);
    expect(ring.nearest(8_000)?.at).toBe(10_000);
    expect(ring.nearest(-50_000)?.at).toBe(0);
    expect(ring.nearest(99_000)?.at).toBe(15_000);
  });

  it('skips moments that have no frame of the display asked for', () => {
    const ring = new FrameRing(10 * MINUTE);
    ring.push(moment(0, [1, 2]));
    ring.push(moment(5_000, [1]));
    expect(ring.nearest(5_000, 2)?.at).toBe(0);
    expect(ring.nearest(5_000, 3)).toBeUndefined();
  });

  it('can limit the search to moments before a time', () => {
    const ring = new FrameRing(10 * MINUTE);
    for (const at of [0, 5_000, 10_000]) ring.push(moment(at));
    expect(ring.nearest(9_000, undefined, { before: 10_000 })?.at).toBe(5_000);
  });

  it('clears to empty', () => {
    const ring = new FrameRing(MINUTE);
    ring.push(moment(0));
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.nearest(0)).toBeUndefined();
  });
});
