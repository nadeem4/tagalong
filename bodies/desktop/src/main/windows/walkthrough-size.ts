/**
 * How big the walkthrough window opens: 1040x680, but never more than the work area, so on a
 * small laptop screen (or a high Windows scale) the pinned footer stays on screen. Contains
 * walkthroughSize.
 */

import type { Rect } from './position';

export function walkthroughSize(workArea: Rect): { width: number; height: number } {
  return { width: Math.min(1040, workArea.width), height: Math.min(680, workArea.height) };
}
