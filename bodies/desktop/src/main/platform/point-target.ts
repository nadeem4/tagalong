/**
 * Where point_at's ring goes: an element's or a rectangle's screen pixels mapped to one display's
 * local DIP. Contains answerPointAt and the two mapping helpers.
 */

import type { ScreenPointAtParams, ScreenPointAtResult } from '@tagalong/protocol';

import type { FindElementAnswer } from './find-element';
import type { WindowBounds } from './index';

/** What `screen.getAllDisplays()` gives, narrowed: bounds are DIP. */
export interface PointDisplay {
  id: number;
  bounds: WindowBounds;
  scaleFactor: number;
}

/** Where the ring goes: a display, its number as the window list numbers it, a local DIP rect. */
export interface PointTarget {
  displayId: number;
  /** 1-based, in `getAllDisplays()` order, the same "screen 2" the window list prints. */
  screen: number;
  /** Device-independent pixels, relative to the display's top-left corner. */
  rect: WindowBounds;
}

/** Trims a DIP rect on the virtual desktop to one display and makes it local to it. */
function onDisplay(
  rect: WindowBounds,
  displays: readonly PointDisplay[],
  index: number,
): PointTarget | null {
  const display = displays[index];
  if (display === undefined) return null;
  const b = display.bounds;
  const left = Math.max(rect.x, b.x);
  const top = Math.max(rect.y, b.y);
  const right = Math.min(rect.x + rect.width, b.x + b.width);
  const bottom = Math.min(rect.y + rect.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return {
    displayId: display.id,
    screen: index + 1,
    rect: {
      x: Math.round(left - b.x),
      y: Math.round(top - b.y),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    },
  };
}

/**
 * UI Automation's screen pixels to a display and a DIP rect. `toDip` is
 * `screen.screenToDipRect(null, rect)` on Windows, which knows each monitor's scale; the
 * display that holds most of the rect gets the ring.
 */
export function screenRectToTarget(
  rect: WindowBounds,
  displays: readonly PointDisplay[],
  toDip: (rect: WindowBounds) => WindowBounds,
): PointTarget | null {
  const dip = toDip(rect);
  let best: PointTarget | null = null;
  for (let index = 0; index < displays.length; index++) {
    const target = onDisplay(dip, displays, index);
    if (target === null) continue;
    if (
      best === null ||
      target.rect.width * target.rect.height > best.rect.width * best.rect.height
    ) {
      best = target;
    }
  }
  return best;
}

/** look_closer's convention, inverted: the display's own pixels divided by its scale. */
export function displayRectToTarget(
  displayId: number,
  rect: WindowBounds,
  displays: readonly PointDisplay[],
): PointTarget | null {
  const index = displays.findIndex((display) => display.id === displayId);
  const display = displays[index];
  if (display === undefined) return null;
  const s = display.scaleFactor;
  return onDisplay(
    {
      x: display.bounds.x + rect.x / s,
      y: display.bounds.y + rect.y / s,
      width: rect.width / s,
      height: rect.height / s,
    },
    displays,
    index,
  );
}

export interface PointAtDeps {
  findElement: (params: { windowId: string; name: string }) => Promise<FindElementAnswer>;
  displays: () => readonly PointDisplay[];
  toDip: (rect: WindowBounds) => WindowBounds;
  /** Draws the ring. Only draws: nothing is moved, pressed or typed. */
  show: (ring: PointTarget & { label: string }) => void;
}

/** Answers `screen.pointAt`: find the place, turn it into a ring, draw it. */
export async function answerPointAt(
  deps: PointAtDeps,
  params: ScreenPointAtParams,
): Promise<ScreenPointAtResult> {
  let target: PointTarget | null;
  if ('windowId' in params) {
    const found = await deps.findElement({ windowId: params.windowId, name: params.name });
    if (!found.found) {
      return {
        shown: false,
        ...(found.blocked === undefined ? {} : { blocked: found.blocked }),
        notes: found.notes,
      };
    }
    target = screenRectToTarget(found.rect, deps.displays(), deps.toDip);
  } else {
    target = displayRectToTarget(params.displayId, params.rect, deps.displays());
  }
  if (target === null) {
    return { shown: false, notes: ['That place is not on any screen right now.'] };
  }
  deps.show({ ...target, label: params.label ?? '' });
  return { shown: true, screen: target.screen };
}
