import { describe, expect, it, vi } from 'vitest';

import { FakeClock } from '../awareness/fake-clock';
vi.mock('electron', () => ({
  BrowserWindow: undefined,
  globalShortcut: undefined,
  screen: undefined,
}));

import { POINTER_MS, PointerOverlay } from './pointer';
import type { PointerRing, RingWindow } from './pointer';

class FakeRingWindow implements RingWindow {
  ignoreMouse: boolean | null = null;
  contentProtected = false;
  onTop: string | null = null;
  rings: PointerRing[] = [];
  visible = false;
  destroyed = false;

  constructor(readonly displayId: number) {}
  setIgnoreMouseEvents(ignore: boolean): void {
    this.ignoreMouse = ignore;
  }
  setContentProtection(on: boolean): void {
    this.contentProtected = on;
  }
  setAlwaysOnTop(flag: boolean, level: 'screen-saver'): void {
    this.onTop = flag ? level : null;
  }
  ring(ring: PointerRing): void {
    this.rings.push(ring);
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function overlay() {
  const clock = new FakeClock(0);
  const windows: FakeRingWindow[] = [];
  const registered = new Map<string, () => void>();
  const pointer = new PointerOverlay({
    clock,
    createWindow: (displayId) => {
      const window = new FakeRingWindow(displayId);
      windows.push(window);
      return window;
    },
    shortcuts: {
      register: (key, run) => {
        registered.set(key, run);
        return true;
      },
      unregister: (key) => void registered.delete(key),
    },
  });
  return { pointer, clock, windows, registered };
}

const ring = (displayId: number, label = 'Export') => ({
  displayId,
  rect: { x: 10, y: 20, width: 30, height: 40 },
  label,
});

describe('PointerOverlay', () => {
  it('makes one window per display, created the first time it is needed', () => {
    const { pointer, windows } = overlay();
    expect(windows).toHaveLength(0);
    pointer.show(ring(1));
    pointer.show(ring(1, 'Again'));
    pointer.show(ring(2));
    expect(windows.map((window) => window.displayId)).toEqual([1, 2]);
  });

  it('makes each window click-through, on top and left out of screenshots', () => {
    const { pointer, windows } = overlay();
    pointer.show(ring(1));
    expect(windows[0]).toMatchObject({
      ignoreMouse: true,
      contentProtected: true,
      onTop: 'screen-saver',
    });
  });

  it('shows one ring at a time: a new one hides the last', () => {
    const { pointer, windows } = overlay();
    pointer.show(ring(1));
    pointer.show(ring(2));
    expect(windows.map((window) => window.visible)).toEqual([false, true]);
    expect(windows[1]?.rings).toEqual([{ rect: ring(2).rect, label: 'Export' }]);
  });

  it(`hides the ring after ${POINTER_MS / 1000} seconds`, async () => {
    const { pointer, clock, windows } = overlay();
    pointer.show(ring(1));
    await clock.advance(POINTER_MS - 1);
    expect(windows[0]?.visible).toBe(true);
    await clock.advance(1);
    expect(windows[0]?.visible).toBe(false);
  });

  it('listens for Esc only while the ring is visible, and Esc hides it', async () => {
    const { pointer, clock, windows, registered } = overlay();
    expect(registered.has('Escape')).toBe(false);
    pointer.show(ring(1));
    expect(registered.has('Escape')).toBe(true);
    registered.get('Escape')?.();
    expect(windows[0]?.visible).toBe(false);
    expect(registered.has('Escape')).toBe(false);

    pointer.show(ring(1));
    await clock.advance(POINTER_MS);
    expect(registered.has('Escape')).toBe(false);
  });

  it('keeps Esc registered once when a second ring replaces the first', () => {
    const { pointer, registered } = overlay();
    pointer.show(ring(1));
    pointer.show(ring(2));
    expect(registered.has('Escape')).toBe(true);
    pointer.hide();
    expect(registered.has('Escape')).toBe(false);
  });

  it('hides on a new turn, and a hide with nothing showing is harmless', () => {
    const { pointer, windows } = overlay();
    pointer.hide();
    pointer.show(ring(1));
    pointer.hide();
    expect(windows[0]?.visible).toBe(false);
  });

  it('destroys the window of a display that was removed', () => {
    const { pointer, windows, registered } = overlay();
    pointer.show(ring(2));
    pointer.displayRemoved(2);
    expect(windows[0]?.destroyed).toBe(true);
    expect(registered.has('Escape')).toBe(false);
    pointer.show(ring(2));
    expect(windows).toHaveLength(2);
  });

  it('leaves the ring and its Esc alone when a different display goes', () => {
    const { pointer, windows, registered } = overlay();
    pointer.show(ring(1));
    pointer.displayRemoved(2);
    expect(windows[0]).toMatchObject({ visible: true, destroyed: false });
    expect(registered.has('Escape')).toBe(true);
  });

  it('on quit, lets go of Esc, stops the timer and destroys every window', async () => {
    const { pointer, clock, windows, registered } = overlay();
    pointer.show(ring(1));
    pointer.show(ring(2));
    pointer.dispose();
    expect(registered.has('Escape')).toBe(false);
    expect(windows.map((window) => window.destroyed)).toEqual([true, true]);
    await clock.advance(POINTER_MS);
    expect(registered.has('Escape')).toBe(false);
    expect(windows.map((window) => window.visible)).toEqual([false, false]);
  });

  it('never unregisters an Esc it did not get', () => {
    const unregister = vi.fn();
    const pointer = new PointerOverlay({
      clock: new FakeClock(0),
      createWindow: (displayId) => new FakeRingWindow(displayId),
      shortcuts: { register: () => false, unregister },
    });
    pointer.show(ring(1));
    pointer.hide();
    pointer.dispose();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('still shows the ring when Esc cannot be registered', () => {
    const clock = new FakeClock(0);
    const window = new FakeRingWindow(1);
    const pointer = new PointerOverlay({
      clock,
      createWindow: () => window,
      shortcuts: { register: () => false, unregister: () => undefined },
    });
    pointer.show(ring(1));
    expect(window.visible).toBe(true);
  });
});
