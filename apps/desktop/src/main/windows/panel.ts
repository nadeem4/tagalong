import { BrowserWindow, screen } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

export const PANEL_WIDTH = 420;
export const PANEL_HEIGHT = 520;

/** Gap between the avatar and the panel so the pet is not covered by its own chat. */
const PANEL_GAP = 12;

export interface PanelWindowOptions {
  /** Focus loss must not close the panel mid-answer, so the caller says when a turn is live. */
  isStreaming: () => boolean;
}

/**
 * The chat panel: frameless, always on top, and deliberately easy to dismiss.
 *
 * Escape and focus loss both hide it rather than closing it, so reopening on the next
 * hotkey is instant and the conversation in the renderer survives.
 */
export function createPanelWindow(options: PanelWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setAlwaysOnTop(true, 'floating');

  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') window.hide();
  });

  window.on('blur', () => {
    if (!options.isStreaming()) window.hide();
  });

  loadPage(window, 'panel');
  return window;
}

/**
 * Puts the panel beside the avatar, flipping to its other side and clamping to the work
 * area so a pet docked at the right edge does not open a panel off screen.
 */
export function showPanelBeside(panel: BrowserWindow, avatar: BrowserWindow): void {
  const [avatarX, avatarY] = avatar.getPosition();
  const [avatarWidth] = avatar.getSize();
  const anchorX = avatarX ?? 0;
  const anchorY = avatarY ?? 0;
  const workArea = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY }).workArea;

  const toTheRight = anchorX + (avatarWidth ?? 0) + PANEL_GAP;
  const x =
    toTheRight + PANEL_WIDTH <= workArea.x + workArea.width
      ? toTheRight
      : anchorX - PANEL_WIDTH - PANEL_GAP;
  const y = Math.min(Math.max(anchorY, workArea.y), workArea.y + workArea.height - PANEL_HEIGHT);

  panel.setPosition(Math.max(x, workArea.x), y);
  panel.show();
  panel.focus();
}
