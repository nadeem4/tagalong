import { describe, expect, it } from 'vitest';

import { layoutComposite } from './composite';
import type { CompositeLayout, CompositeSlot, DisplayGeometry } from './composite';

/** Electron reports display bounds in DIP, so sizes are comparable across scale factors. */
function display(id: number, x: number, y: number, width: number, height: number): DisplayGeometry {
  return { id, bounds: { x, y, width, height } };
}

/**
 * Throws rather than returning undefined, so a layout that drops a display fails on the
 * missing slot instead of on a confusing comparison against `undefined` further down.
 */
function slotOf(layout: CompositeLayout, id: number): CompositeSlot {
  const slot = layout.slots.find((candidate) => candidate.id === id);
  if (slot === undefined) throw new Error(`layout has no slot for display ${id}`);
  return slot;
}

const MAX = 1568;

describe('layoutComposite', () => {
  it('fills the canvas with a single display', () => {
    const layout = layoutComposite([display(1, 0, 0, 1920, 1080)], MAX);

    expect(layout).toEqual({
      width: 1568,
      height: 882,
      slots: [{ id: 1, x: 0, y: 0, width: 1568, height: 882 }],
    });
  });

  it('places two side-by-side displays in the order the geometry puts them', () => {
    const layout = layoutComposite(
      [display(1, 0, 0, 1920, 1080), display(2, 1920, 0, 1920, 1080)],
      MAX,
    );

    // A 3840x1080 virtual desktop scaled to a 1568 long side.
    expect(layout.width).toBe(1568);
    expect(layout.height).toBe(441);
    expect(layout.slots[0]).toEqual({ id: 1, x: 0, y: 0, width: 784, height: 441 });
    expect(layout.slots[1]).toEqual({ id: 2, x: 784, y: 0, width: 784, height: 441 });
  });

  it('normalises a display sitting to the left of the primary, where x is negative', () => {
    // Windows puts the primary at 0,0 and gives a monitor on its left a negative x.
    // Without normalisation that display lands outside the canvas entirely.
    const layout = layoutComposite(
      [display(1, 0, 0, 1920, 1080), display(2, -1920, 0, 1920, 1080)],
      MAX,
    );

    expect(slotOf(layout, 2).x).toBe(0);
    expect(slotOf(layout, 1).x).toBe(784);
  });

  it('normalises a display sitting above the primary, where y is negative', () => {
    const layout = layoutComposite(
      [display(1, 0, 0, 1920, 1080), display(2, 0, -1080, 1920, 1080)],
      MAX,
    );

    const above = slotOf(layout, 2);
    expect(above.y).toBe(0);
    expect(slotOf(layout, 1).y).toBe(above.height);
  });

  it('never upscales a virtual desktop that already fits', () => {
    // Upscaling would invent pixels and then bill the user for the invention, the same
    // reason fitWithin treats its bound as a ceiling.
    const layout = layoutComposite([display(1, 0, 0, 800, 600)], MAX);

    expect(layout).toEqual({
      width: 800,
      height: 600,
      slots: [{ id: 1, x: 0, y: 0, width: 800, height: 600 }],
    });
  });

  it('keeps every slot inside the canvas', () => {
    // Rounding each edge independently is what makes this safe: the right edge of the
    // rightmost display rounds to exactly the canvas width rather than one pixel past it.
    const layout = layoutComposite(
      [
        display(1, 0, 0, 2560, 1440),
        display(2, 2560, 200, 1920, 1080),
        display(3, -1080, -300, 1080, 1920),
      ],
      MAX,
    );

    for (const slot of layout.slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.width).toBeLessThanOrEqual(layout.width);
      expect(slot.y + slot.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it('leaves no seam between displays that touch', () => {
    const layout = layoutComposite(
      [display(1, 0, 0, 1920, 1080), display(2, 1920, 0, 2560, 1080)],
      MAX,
    );

    const first = slotOf(layout, 1);
    expect(first.x + first.width).toBe(slotOf(layout, 2).x);
  });

  it('gives a sliver of a display at least one pixel', () => {
    // A 1px-wide virtual display next to a 4K one scales below half a pixel. The protocol's
    // image blocks require positive dimensions, so rounding to zero would produce a slot
    // nothing could draw into.
    const layout = layoutComposite(
      [display(1, 0, 0, 3840, 2160), display(2, 3840, 0, 1, 2160)],
      MAX,
    );

    expect(slotOf(layout, 2).width).toBeGreaterThanOrEqual(1);
    expect(slotOf(layout, 2).height).toBeGreaterThanOrEqual(1);
  });

  it('reports an empty canvas when the host has no displays', () => {
    // Not an error: a locked or headless session really has nothing to lay out, and the
    // caller turns this into "no composite" rather than a broken image.
    expect(layoutComposite([], MAX)).toEqual({ width: 0, height: 0, slots: [] });
  });

  it('keeps each slot tied to its display id', () => {
    const layout = layoutComposite(
      [display(77, 1920, 0, 1920, 1080), display(12, 0, 0, 1920, 1080)],
      MAX,
    );

    expect(layout.slots.map((slot) => slot.id)).toEqual([77, 12]);
  });
});
