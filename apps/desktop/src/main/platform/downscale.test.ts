/** Tests for fitWithin. */

import { describe, expect, it } from 'vitest';
import { fitWithin } from './downscale';

/** What callers pass in production; the sizes below are chosen around it. */
const BOUND = 1568;

describe('fitWithin', () => {
  it('shrinks a landscape image by its width and keeps the aspect ratio', () => {
    expect(fitWithin(3840, 2160, BOUND)).toEqual({ width: 1568, height: 882 });
  });

  it('shrinks a portrait image by its height and keeps the aspect ratio', () => {
    expect(fitWithin(1080, 1920, BOUND)).toEqual({ width: 882, height: 1568 });
  });

  it('leaves an image whose long side is exactly the bound alone', () => {
    expect(fitWithin(BOUND, 900, BOUND)).toEqual({ width: BOUND, height: 900 });
    expect(fitWithin(900, BOUND, BOUND)).toEqual({ width: 900, height: BOUND });
  });

  it('never upscales an image that is already smaller than the bound', () => {
    expect(fitWithin(800, 600, BOUND)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1, 1, BOUND)).toEqual({ width: 1, height: 1 });
  });

  it('rounds a fractional result instead of truncating it', () => {
    // 1000 x 333 at half size is 500 x 166.5, which must land on 167, not 166.
    expect(fitWithin(1000, 333, 500)).toEqual({ width: 500, height: 167 });
    // 999 x 500 scaled to a 100 long side is 100 x 50.05.
    expect(fitWithin(999, 500, 100)).toEqual({ width: 100, height: 50 });
  });

  it('keeps a sliver of a window at one pixel rather than rounding it away', () => {
    // The protocol's screenshot block requires positive dimensions, so a rounded-to-zero
    // side would produce an image no snapshot could carry.
    expect(fitWithin(4000, 1, BOUND)).toEqual({ width: 1568, height: 1 });
    expect(fitWithin(1, 4000, BOUND)).toEqual({ width: 1, height: 1568 });
  });
});
