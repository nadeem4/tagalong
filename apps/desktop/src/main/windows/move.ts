import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { crossesScale } from './position';
import type { Rect } from './position';

/**
 * Moves a window to `bounds`, in two passes when it lands on a display with another scale
 * factor (a laptop screen at 150% beside a monitor at 100%): the first pass puts it on the
 * right display, the second at the right place on it.
 */
export function moveWindow(window: BrowserWindow, bounds: Rect): void {
  const from = screen.getDisplayMatching(window.getBounds());
  const to = screen.getDisplayMatching(bounds);
  window.setBounds(bounds);
  if (crossesScale(from, to)) window.setBounds(bounds);
}
