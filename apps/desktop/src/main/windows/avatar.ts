import { BrowserWindow, screen } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';
import { AVATAR_SIZE, resolveAvatarPosition } from './position';
import type { Point, RememberedPosition } from './position';

export interface AvatarWindowOptions {
  position: RememberedPosition;
  /** Called after the user drags the pet, so settings can remember where they left it. */
  onMoved: (position: Point) => void;
}

/**
 * The pet itself: a transparent, frameless square that floats over everything.
 *
 * skipTaskbar keeps it out of Alt+Tab — it is an ornament on the desktop, not a window
 * the user manages — and the renderer marks its body as a drag region so the whole pet
 * can be picked up and moved.
 */
export function createAvatarWindow(options: AvatarWindowOptions): BrowserWindow {
  const { x, y } = resolveAvatarPosition(
    options.position,
    screen.getPrimaryDisplay().workArea as { x: number; y: number; width: number; height: number },
  );

  const window = new BrowserWindow({
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
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
  window.on('moved', () => {
    const [movedX, movedY] = window.getPosition();
    if (movedX !== undefined && movedY !== undefined) options.onMoved({ x: movedX, y: movedY });
  });

  loadPage(window, 'avatar');
  return window;
}
