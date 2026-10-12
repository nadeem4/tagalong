import { BrowserWindow, screen } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';
import { panelPosition } from './position';
import { IPC } from '../../shared/ipc';

export const PANEL_WIDTH = 420;
/** The full chat's height. The bubble asks for its own, which is usually far less. */
export const PANEL_HEIGHT = 520;
/** The bubble's first height, before it has measured itself. */
const BUBBLE_HEIGHT = 180;

export interface PanelWindowOptions {
  /** Focus loss must not close the panel mid-answer, so the caller says when a turn is live. */
  isStreaming: () => boolean;
}

/**
 * The companion's bubble, and the full chat behind it: frameless, transparent around the
 * bubble's rounded corners, always on top, and deliberately easy to dismiss.
 *
 * Escape and focus loss both hide it rather than closing it, so reopening on the next
 * hotkey is instant and the conversation in the renderer survives.
 */
export function createPanelWindow(options: PanelWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: PANEL_WIDTH,
    height: BUBBLE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
 * Puts the panel against the pet at its current size (see `panelPosition`) and tells the
 * bubble which side of the pet it is on, so its tail points at the pet.
 */
export function placePanel(panel: BrowserWindow, avatar: BrowserWindow): void {
  const pet = avatar.getBounds();
  const [width = PANEL_WIDTH, height = BUBBLE_HEIGHT] = panel.getSize();
  const workArea = screen.getDisplayNearestPoint({ x: pet.x, y: pet.y }).workArea;
  const { x, y, side } = panelPosition(pet, { width, height }, workArea);
  panel.setPosition(x, y);
  panel.webContents.send(IPC.panelSideEvent, side);
}

/** Shows the panel beside the pet and gives it the keyboard, for a question. */
export function showPanelBeside(panel: BrowserWindow, avatar: BrowserWindow): void {
  placePanel(panel, avatar);
  panel.show();
  panel.focus();
}

/** Shows the panel beside the pet without taking the keyboard, for the hello. */
export function showPanelQuietly(panel: BrowserWindow, avatar: BrowserWindow): void {
  placePanel(panel, avatar);
  panel.showInactive();
}

/** The renderer measured its content: resize to it, keeping the bottom level with the pet. */
export function fitPanel(panel: BrowserWindow, avatar: BrowserWindow, height: number): void {
  const clamped = Math.round(Math.min(Math.max(height, 80), PANEL_HEIGHT));
  panel.setSize(PANEL_WIDTH, clamped);
  placePanel(panel, avatar);
}
