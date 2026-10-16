/**
 * The pointer overlay: one click-through window per display that draws point_at's ring, for six
 * seconds or until Escape. Contains createPointerOverlay and PointerOverlay.
 */

import { BrowserWindow, globalShortcut, screen } from 'electron';

import type { Clock } from '../awareness/clock';
import { systemClock } from '../awareness/clock';
import type { WindowBounds } from '../platform/index';
import { IPC } from '../../shared/ipc';
import type { PointerRing } from '../../shared/ipc';
import { PRELOAD_PATH, loadPage } from './page';

export type { PointerRing };

/** How long a ring stays before it goes by itself. Not a setting. */
export const POINTER_MS = 6_000;

/** Only listened for while a ring shows, and never sent: Tagalong presses no keys. */
const DISMISS_KEY = 'Escape';

/** One display's overlay window, narrowed to what the overlay does with it. */
export interface RingWindow {
  setIgnoreMouseEvents(ignore: boolean): void;
  setContentProtection(on: boolean): void;
  setAlwaysOnTop(flag: boolean, level: 'screen-saver'): void;
  /** Draws the ring and shows the window without taking focus. */
  ring(ring: PointerRing): void;
  hide(): void;
  destroy(): void;
}

export interface PointerOverlayDeps {
  createWindow: (displayId: number) => RingWindow;
  shortcuts: {
    register(accelerator: string, run: () => void): boolean;
    unregister(accelerator: string): void;
  };
  clock: Clock;
}

/**
 * Point, don't click: one click-through overlay per display that only draws a ring. Nothing
 * here moves the mouse, clicks or types. One ring at a time; it goes after six seconds, on
 * Esc, or when the next turn starts.
 */
export class PointerOverlay {
  readonly #deps: PointerOverlayDeps;
  readonly #windows = new Map<number, RingWindow>();
  #showing: number | null = null;
  #timer: unknown = null;
  #escape = false;

  constructor(deps: PointerOverlayDeps) {
    this.#deps = deps;
  }

  show(ring: { displayId: number; rect: WindowBounds; label: string }): void {
    this.hide();
    const window = this.#windowFor(ring.displayId);
    window.ring({ rect: ring.rect, label: ring.label });
    this.#showing = ring.displayId;
    this.#timer = this.#deps.clock.setTimeout(() => this.hide(), POINTER_MS);
    // A ring that cannot be dismissed with Esc still goes by itself.
    this.#escape = this.#deps.shortcuts.register(DISMISS_KEY, () => this.hide());
  }

  hide(): void {
    if (this.#timer !== null) this.#deps.clock.clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#escape) this.#deps.shortcuts.unregister(DISMISS_KEY);
    this.#escape = false;
    if (this.#showing !== null) this.#windows.get(this.#showing)?.hide();
    this.#showing = null;
  }

  displayRemoved(displayId: number): void {
    if (this.#showing === displayId) this.hide();
    this.#windows.get(displayId)?.destroy();
    this.#windows.delete(displayId);
  }

  dispose(): void {
    this.hide();
    for (const window of this.#windows.values()) window.destroy();
    this.#windows.clear();
  }

  #windowFor(displayId: number): RingWindow {
    const existing = this.#windows.get(displayId);
    if (existing !== undefined) return existing;
    const window = this.#deps.createWindow(displayId);
    window.setIgnoreMouseEvents(true);
    // Scout's own screenshots never show the ring.
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    this.#windows.set(displayId, window);
    return window;
  }
}

/** A hidden, full-bounds, transparent window over one display that draws the ring. */
function electronRingWindow(bounds: WindowBounds): RingWindow {
  const window = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const ready = new Promise<void>((resolve) =>
    window.webContents.once('did-finish-load', () => resolve()),
  );
  loadPage(window, 'pointer');
  let wanted = false;
  return {
    setIgnoreMouseEvents: (ignore) => window.setIgnoreMouseEvents(ignore),
    setContentProtection: (on) => window.setContentProtection(on),
    setAlwaysOnTop: (flag, level) => window.setAlwaysOnTop(flag, level),
    ring: (ring) => {
      wanted = true;
      void ready.then(() => {
        if (!wanted || window.isDestroyed()) return;
        window.webContents.send(IPC.pointerShow, ring);
        window.showInactive();
      });
    },
    hide: () => {
      wanted = false;
      if (!window.isDestroyed()) window.hide();
    },
    destroy: () => {
      wanted = false;
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

/** The overlay as the app uses it: real windows, the global Esc, displays that come and go. */
export function createPointerOverlay(): PointerOverlay {
  const overlay = new PointerOverlay({
    clock: systemClock,
    shortcuts: {
      register: (key, run) => {
        try {
          return globalShortcut.register(key, run);
        } catch {
          return false;
        }
      },
      unregister: (key) => globalShortcut.unregister(key),
    },
    createWindow: (displayId) => {
      const display =
        screen.getAllDisplays().find((candidate) => candidate.id === displayId) ??
        screen.getPrimaryDisplay();
      return electronRingWindow(display.bounds);
    },
  });
  screen.on('display-removed', (_event, display) => overlay.displayRemoved(display.id));
  // A display that moved or changed scale gets a fresh window at its new bounds next time.
  screen.on('display-metrics-changed', (_event, display) => overlay.displayRemoved(display.id));
  return overlay;
}
