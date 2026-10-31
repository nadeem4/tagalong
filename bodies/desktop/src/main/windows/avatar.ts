/**
 * Scout's window: a transparent, frameless square on top of everything. Contains
 * createAvatarWindow.
 */

import { BrowserWindow, screen } from 'electron';
import { guardNavigation } from '../drop';
import { PRELOAD_PATH, loadPage } from './page';
import { AVATAR_SIZE, resolveAvatarPosition } from './position';
import type { Point, RememberedPosition } from './position';

interface AvatarWindowOptions {
  position: RememberedPosition;
  /** Called after the user drags the pet, so settings can remember where they left it. */
  onMoved: (position: Point) => void;
  /** False opens it hidden, for a launch that starts with the walkthrough. Default true. */
  show?: boolean;
}

/**
 * The pet itself: a transparent, frameless square that floats over everything.
 *
 * skipTaskbar keeps it out of Alt+Tab: it is an ornament on the desktop, not a window the
 * user manages. It is moved by IPC.dragAvatar, not a drag region, which would swallow its
 * clicks.
 */
export function createAvatarWindow(options: AvatarWindowOptions): BrowserWindow {
  // The screen the pet was left on, or for a pet never moved the one the person is using:
  // never simply the primary display, where a pet on a laptop's own screen goes unseen
  // by someone working on a monitor.
  const { x: savedX, y: savedY } = options.position;
  const near =
    savedX !== null && savedY !== null ? { x: savedX, y: savedY } : screen.getCursorScreenPoint();
  const { x, y } = resolveAvatarPosition(
    options.position,
    screen.getDisplayNearestPoint(near).workArea as {
      x: number;
      y: number;
      width: number;
      height: number;
    },
  );

  const window = new BrowserWindow({
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    show: options.show ?? true,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setAlwaysOnTop(true, 'floating');
  // Things are dropped on the pet: the figure stops the drop opening the file in this
  // window, and this is the backstop.
  guardNavigation(window.webContents);
  window.on('moved', () => {
    const [movedX, movedY] = window.getPosition();
    if (movedX !== undefined && movedY !== undefined) options.onMoved({ x: movedX, y: movedY });
  });

  loadPage(window, 'avatar');
  return window;
}
