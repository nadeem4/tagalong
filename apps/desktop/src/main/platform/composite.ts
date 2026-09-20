import { fitWithin } from './downscale';
import type { WindowBounds } from './index';

/**
 * One display's place on the virtual desktop.
 *
 * `bounds` are Electron's own, in device-independent pixels, so a 4K monitor at 200% and a
 * 1080p monitor at 100% both report 1920x1080 and sit on the same coordinate grid. That is
 * what makes a composite laid out by geometry meaningful: it matches how the monitors are
 * actually arranged in front of the user, not how many pixels each one holds.
 */
export interface DisplayGeometry {
  id: number;
  bounds: WindowBounds;
}

/** Where one display's image goes inside the composite canvas. */
export interface CompositeSlot {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositeLayout {
  width: number;
  height: number;
  slots: CompositeSlot[];
}

/**
 * Arranges every display into one canvas that mirrors the physical monitor layout.
 *
 * The composite is a map, not a photograph: at a 1568 long side a three-monitor desktop
 * gives each monitor about 500 pixels, far too few to read. Its job is to let the pet see
 * how many screens there are and roughly what is on each, then fetch the one it wants at a
 * useful size with `look_at_display` or `look_closer`.
 *
 * Windows places the primary display at the origin and gives monitors to its left or above
 * it negative coordinates, so the bounding box is normalised before scaling — otherwise
 * those displays land outside the canvas.
 *
 * Each edge is rounded from its absolute scaled position rather than each slot being
 * rounded independently. Two rounded corners can disagree by a pixel and leave a seam
 * between monitors that touch, or push the rightmost slot past the canvas; deriving width
 * from `right - left` makes both impossible.
 *
 * The phase page asks for a composite "at most 1568 wide". This bounds the long side
 * instead, reusing `fitWithin`: a vertical monitor stack is tall rather than wide, and
 * bounding only the width would let it grow without limit.
 */
export function layoutComposite(displays: DisplayGeometry[], maxLongSide: number): CompositeLayout {
  // A locked or headless session really has no displays. The caller turns this into
  // "no composite" rather than an image with no pixels.
  if (displays.length === 0) return { width: 0, height: 0, slots: [] };

  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));

  const canvas = fitWithin(maxX - minX, maxY - minY, maxLongSide);
  const scaleX = canvas.width / (maxX - minX);
  const scaleY = canvas.height / (maxY - minY);

  const slots = displays.map((display) => {
    const left = Math.round((display.bounds.x - minX) * scaleX);
    const top = Math.round((display.bounds.y - minY) * scaleY);
    const right = Math.round((display.bounds.x + display.bounds.width - minX) * scaleX);
    const bottom = Math.round((display.bounds.y + display.bounds.height - minY) * scaleY);

    return {
      id: display.id,
      x: left,
      y: top,
      // A display narrow enough to scale below half a pixel still has to be drawable:
      // the protocol's image blocks require positive dimensions.
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  });

  return { width: canvas.width, height: canvas.height, slots };
}
