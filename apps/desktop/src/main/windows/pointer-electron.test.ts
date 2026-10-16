/** Tests for the pointer overlay's Electron windows. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The real overlay wiring against a fake Electron: window options, the global Esc, displays. */
const electron = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown, display: { id: number }) => void>();
  const windows: Array<{
    options: Record<string, unknown>;
    destroyed: boolean;
    calls: string[];
  }> = [];
  class FakeBrowserWindow {
    readonly record: (typeof windows)[number];
    readonly webContents = {
      once: (_event: string, run: () => void) => run(),
      send: (channel: string) => this.record.calls.push(`send:${channel}`),
    };
    constructor(options: Record<string, unknown>) {
      this.record = { options, destroyed: false, calls: [] };
      windows.push(this.record);
    }
    setIgnoreMouseEvents(ignore: boolean) {
      this.record.calls.push(`ignoreMouse:${ignore}`);
    }
    setContentProtection(on: boolean) {
      this.record.calls.push(`contentProtection:${on}`);
    }
    setAlwaysOnTop(flag: boolean, level: string) {
      this.record.calls.push(`onTop:${flag}:${level}`);
    }
    showInactive() {
      this.record.calls.push('showInactive');
    }
    show() {
      this.record.calls.push('show');
    }
    focus() {
      this.record.calls.push('focus');
    }
    hide() {
      this.record.calls.push('hide');
    }
    isDestroyed() {
      return this.record.destroyed;
    }
    destroy() {
      this.record.destroyed = true;
    }
  }
  return {
    listeners,
    windows,
    FakeBrowserWindow,
    globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
    displays: [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
    ],
  };
});

vi.mock('electron', () => ({
  BrowserWindow: electron.FakeBrowserWindow,
  globalShortcut: electron.globalShortcut,
  screen: {
    getAllDisplays: () => electron.displays,
    getPrimaryDisplay: () => electron.displays[0],
    on: (event: string, run: (event: unknown, display: { id: number }) => void) =>
      electron.listeners.set(event, run),
  },
}));
vi.mock('./page', () => ({ PRELOAD_PATH: 'preload.cjs', loadPage: vi.fn() }));

import { createPointerOverlay } from './pointer';

const ring = (displayId: number) => ({
  displayId,
  rect: { x: 1, y: 2, width: 3, height: 4 },
  label: 'Export',
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  electron.windows.length = 0;
  electron.listeners.clear();
  electron.globalShortcut.register.mockClear();
  electron.globalShortcut.unregister.mockClear();
});

describe('createPointerOverlay', () => {
  it('makes a click-through, unfocusable window over the whole display, shown without focus', async () => {
    const overlay = createPointerOverlay();
    overlay.show(ring(2));
    await flush();
    const [window] = electron.windows;
    expect(window?.options).toMatchObject({
      x: -1280,
      y: 0,
      width: 1280,
      height: 720,
      transparent: true,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
    });
    expect(window?.calls).toEqual(
      expect.arrayContaining([
        'ignoreMouse:true',
        'contentProtection:true',
        'onTop:true:screen-saver',
        'showInactive',
      ]),
    );
    expect(window?.calls).not.toContain('show');
    expect(window?.calls).not.toContain('focus');
    overlay.dispose();
  });

  it('registers the global Esc only while a ring shows, and lets go of it on quit', () => {
    const overlay = createPointerOverlay();
    expect(electron.globalShortcut.register).not.toHaveBeenCalled();
    overlay.show(ring(1));
    expect(electron.globalShortcut.register).toHaveBeenCalledWith('Escape', expect.any(Function));
    overlay.dispose();
    expect(electron.globalShortcut.unregister).toHaveBeenCalledWith('Escape');
    expect(electron.windows[0]?.destroyed).toBe(true);
  });

  it('lets go of Esc and the window when the showing display is removed or rescaled', () => {
    for (const event of ['display-removed', 'display-metrics-changed']) {
      electron.globalShortcut.unregister.mockClear();
      const overlay = createPointerOverlay();
      overlay.show(ring(2));
      electron.listeners.get(event)?.({}, { id: 2 });
      expect(electron.globalShortcut.unregister, event).toHaveBeenCalledWith('Escape');
      expect(electron.windows.at(-1)?.destroyed, event).toBe(true);
      overlay.dispose();
    }
  });

  it('still rings when Electron refuses the shortcut, and never unregisters it then', () => {
    electron.globalShortcut.register.mockImplementationOnce(() => {
      throw new Error('in use');
    });
    const overlay = createPointerOverlay();
    overlay.show(ring(1));
    overlay.hide();
    expect(electron.globalShortcut.unregister).not.toHaveBeenCalled();
    overlay.dispose();
  });
});
