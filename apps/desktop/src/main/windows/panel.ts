import { BrowserWindow, screen } from 'electron';
import { guardNavigation } from '../drop';
import { PRELOAD_PATH, loadPage } from './page';
import { hidesOnBlur } from './bubble-focus';
import { moveWindow } from './move';
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
  /** The pet's window: focus moving there (a click or a drag on the pet) keeps the bubble. */
  pet: () => BrowserWindow | null;
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

  // Whether an answer is streaming is read at the blur itself: a fast answer can finish
  // before the check below, and a blur during an answer must still not hide it. Where the
  // focus went is only known a moment later, once it has settled on the new window.
  window.on('blur', () => {
    const streaming = options.isStreaming();
    setTimeout(() => {
      const focused = BrowserWindow.getFocusedWindow();
      const pet = options.pet();
      const focusWentToPet = focused !== null && pet !== null && focused === pet;
      if (hidesOnBlur({ streaming, focusWentToPet, focusedAgain: window.isFocused() })) {
        window.hide();
      }
    }, 60);
  });

  // A file dropped on the bubble instead of the pet must not open in it either.
  guardNavigation(window.webContents);
  loadPage(window, 'panel');
  return window;
}

/**
 * Puts the panel against the pet at its current size (see `panelPosition`) and tells the
 * bubble which side of the pet it is on, so its tail points at the pet.
 */
export function placePanel(
  panel: BrowserWindow,
  avatar: BrowserWindow,
  height: number = panel.getSize()[1] ?? BUBBLE_HEIGHT,
): void {
  const pet = avatar.getBounds();
  const workArea = screen.getDisplayNearestPoint({ x: pet.x, y: pet.y }).workArea;
  const { x, y, side } = panelPosition(pet, { width: PANEL_WIDTH, height }, workArea);
  moveWindow(panel, { x, y, width: PANEL_WIDTH, height });
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
  placePanel(panel, avatar, Math.round(Math.min(Math.max(height, 80), PANEL_HEIGHT)));
}
