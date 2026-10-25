/** Tests for capturing every display and blanking excluded ones. */

import { describe, expect, it, vi } from 'vitest';

import { createCanvas, pixelAt } from './canvas';
import type { Bitmap, Colour } from './canvas';
import { captureDisplaysWith } from './displays';
import type { DisplayImagePort, DisplayInfo, DisplaysCaptureDeps } from './displays';
import type { ActiveWindowInfo, WindowBounds } from './index';
import type { WindowEntry } from '@tagalong/protocol';

/** A window in the inventory captureDisplaysWith reads to decide what to blank. */
function entry(overrides: Partial<WindowEntry> = {}): WindowEntry {
  return {
    id: 'w-1',
    processName: 'Code.exe',
    title: 'a',
    state: 'background',
    browser: false,
    ...overrides,
  };
}

const RED: Colour = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: Colour = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: Colour = { r: 0, g: 0, b: 255, a: 255 };

const MAX = 1568;

function bounds(x: number, y: number, width: number, height: number): WindowBounds {
  return { x, y, width, height };
}

function info(id: number, at: WindowBounds, primary = false): DisplayInfo {
  return { id, bounds: at, scaleFactor: 1, primary };
}

/**
 * A capturer thumbnail of one flat colour, so a pixel in the finished composite says which
 * display it came from.
 */
function fakeImage(colour: Colour, width: number, height: number): DisplayImagePort {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (size) => fakeImage(colour, size.width, size.height),
    // The composite never crops; look_closer does, and it has its own tests in region.
    crop: (rect) => fakeImage(colour, rect.width, rect.height),
    toPNG: () => Buffer.from(`${colour.r}-${colour.g}-${colour.b}@${width}x${height}`),
    toBitmap: () => createCanvas(width, height, colour).data,
  };
}

interface Harness {
  deps: DisplaysCaptureDeps;
  /** Every bitmap handed to encodePng, in order: blocked panels first, composite last. */
  encoded: Bitmap[];
}

/**
 * The composite is the final encode of a capture — blocked placeholders are encoded as
 * they are built, before it. Indexing from the front picks up a placeholder whenever a
 * display is blocked, which is exactly the case the composite tests care about.
 */
function compositeOf(harnessed: Harness): Bitmap {
  const last = harnessed.encoded.at(-1);
  if (last === undefined) throw new Error('no bitmap was encoded');
  return last;
}

function harness(options: {
  displays: DisplayInfo[];
  sources: Array<{ displayId: number; colour: Colour; width: number; height: number }>;
  active?: ActiveWindowInfo | null;
  focusedDisplayId?: number;
  excludedProcessNames?: string[];
  /** The inventory captureDisplaysWith consults. Empty unless a test supplies one. */
  windows?: WindowEntry[];
}): Harness {
  const encoded: Bitmap[] = [];
  return {
    encoded,
    deps: {
      screen: {
        getAllDisplays: () => options.displays,
        getDisplayMatching: () => ({ id: options.focusedDisplayId ?? -1 }),
      },
      desktopCapturer: {
        getSources: () =>
          Promise.resolve(
            options.sources.map((source) => ({
              name: `Screen ${source.displayId}`,
              display_id: String(source.displayId),
              thumbnail: fakeImage(source.colour, source.width, source.height),
            })),
          ),
      },
      getActiveWindow: () => Promise.resolve(options.active ?? null),
      listWindows: () => Promise.resolve(options.windows ?? []),
      exclusions: {
        processNames: options.excludedProcessNames ?? [],
        titlePatterns: [],
      },
      encodePng: (bitmap) => {
        encoded.push(bitmap);
        return Buffer.from(`composite@${bitmap.width}x${bitmap.height}`);
      },
    },
  };
}

const THREE_ACROSS = [
  info(1, bounds(0, 0, 1920, 1080), true),
  info(2, bounds(1920, 0, 1920, 1080)),
  info(3, bounds(3840, 0, 1920, 1080)),
];

const THREE_SOURCES = [
  { displayId: 1, colour: RED, width: 1920, height: 1080 },
  { displayId: 2, colour: GREEN, width: 1920, height: 1080 },
  { displayId: 3, colour: BLUE, width: 1920, height: 1080 },
];

describe('captureDisplaysWith', () => {
  it('returns one entry per display, carrying its geometry', async () => {
    const { deps } = harness({ displays: THREE_ACROSS, sources: THREE_SOURCES });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays).toHaveLength(3);
    expect(result.displays.map((display) => display.id)).toEqual([1, 2, 3]);
    expect(result.displays[0]?.primary).toBe(true);
    expect(result.displays[1]?.primary).toBe(false);
    expect(result.displays[0]?.bounds).toEqual(bounds(0, 0, 1920, 1080));
  });

  it('gives every display a PNG inside the long-side bound', async () => {
    const { deps } = harness({ displays: THREE_ACROSS, sources: THREE_SOURCES });

    const result = await captureDisplaysWith(deps, MAX);

    for (const display of result.displays) {
      expect(display.image).not.toBeNull();
      expect(Math.max(display.image?.width ?? 0, display.image?.height ?? 0)).toBeLessThanOrEqual(
        MAX,
      );
    }
  });

  it('marks the display holding the active window as the focused one', async () => {
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: 'Code.exe', title: 'displays.ts', bounds: bounds(2000, 100, 800, 600) },
      focusedDisplayId: 2,
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays.map((display) => display.focused)).toEqual([false, true, false]);
  });

  it('focuses nothing when Windows reports no foreground window', async () => {
    // A locked session, a UAC prompt on the secure desktop, or a full-screen game. The
    // capture still has to produce every display rather than bail.
    const { deps } = harness({ displays: THREE_ACROSS, sources: THREE_SOURCES, active: null });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays.every((display) => !display.focused)).toBe(true);
    expect(result.displays.every((display) => display.blocked === null)).toBe(true);
    expect(result.displays.every((display) => display.image !== null)).toBe(true);
  });

  it('blanks the focused display when its app is excluded, and says which rule refused', async () => {
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: '1Password.exe', title: 'Vault', bounds: bounds(2000, 100, 800, 600) },
      focusedDisplayId: 2,
      excludedProcessNames: ['1Password.exe'],
    });

    const result = await captureDisplaysWith(deps, MAX);
    const excluded = result.displays[1];

    expect(excluded?.blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
    // Still an image: a placeholder the pet can see and read, not a hole it has to guess at.
    expect(excluded?.image).not.toBeNull();
    expect(excluded?.image?.base64).not.toBe(result.displays[0]?.image?.base64);
  });

  it('still captures the other displays when one is blocked', async () => {
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: '1Password.exe', title: 'Vault', bounds: bounds(2000, 100, 800, 600) },
      focusedDisplayId: 2,
      excludedProcessNames: ['1Password.exe'],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays[0]?.blocked).toBeNull();
    expect(result.displays[2]?.blocked).toBeNull();
    expect(result.displays[0]?.image).not.toBeNull();
    expect(result.displays[2]?.image).not.toBeNull();
  });

  it('draws each display into its own slot of the composite', async () => {
    const harnessed = harness({ displays: THREE_ACROSS, sources: THREE_SOURCES });

    const result = await captureDisplaysWith(harnessed.deps, MAX);

    expect(result.composite).not.toBeNull();
    const canvas = compositeOf(harnessed);

    // Sample the middle of each third, clear of the id label in the corner.
    const third = Math.floor(canvas.width / 3);
    const midY = Math.floor(canvas.height / 2);
    expect(pixelAt(canvas, Math.floor(third * 0.5), midY)).toEqual(RED);
    expect(pixelAt(canvas, Math.floor(third * 1.5), midY)).toEqual(GREEN);
    expect(pixelAt(canvas, Math.floor(third * 2.5), midY)).toEqual(BLUE);
  });

  it('puts the blocked placeholder in the composite too, not just in the display image', async () => {
    // The composite is what gets attached by default. A placeholder that only reaches the
    // per-display image would leak the excluded screen through the picture the pet always
    // sees.
    const harnessed = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: '1Password.exe', title: 'Vault', bounds: bounds(2000, 100, 800, 600) },
      focusedDisplayId: 2,
      excludedProcessNames: ['1Password.exe'],
    });

    await captureDisplaysWith(harnessed.deps, MAX);
    const canvas = compositeOf(harnessed);

    const third = Math.floor(canvas.width / 3);
    const midY = Math.floor(canvas.height / 2);
    expect(pixelAt(canvas, Math.floor(third * 1.5), midY)).not.toEqual(GREEN);
    expect(pixelAt(canvas, Math.floor(third * 0.5), midY)).toEqual(RED);
  });

  it('survives a display the capturer has no source for', async () => {
    // Electron drops a source for a display it was not allowed to read, and the ids do not
    // always line up on Windows. One missing screen must not cost the other two.
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: [THREE_SOURCES[0] as (typeof THREE_SOURCES)[number], THREE_SOURCES[2]!],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays[1]?.image).toBeNull();
    expect(result.displays[0]?.image).not.toBeNull();
    expect(result.displays[2]?.image).not.toBeNull();
    expect(result.composite).not.toBeNull();
  });

  it('reports no displays and no composite on a session that has none', async () => {
    const { deps } = harness({ displays: [], sources: [] });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays).toEqual([]);
    expect(result.composite).toBeNull();
  });

  it('asks the capturer once, not once per display', async () => {
    // getSources is the expensive call: it wakes the compositor for every screen. Three
    // monitors must not mean three enumerations.
    const { deps } = harness({ displays: THREE_ACROSS, sources: THREE_SOURCES });
    const spy = vi.spyOn(deps.desktopCapturer, 'getSources');

    await captureDisplaysWith(deps, MAX);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('captureDisplaysWith, exclusions beyond the focused window', () => {
  const VAULT = { rule: 'processName', entry: '1Password.exe' } as const;

  it('blanks a display holding an excluded window that is not the focused one', async () => {
    // The gap this closes. Focus a document on display 1 while a password manager sits
    // open and visible on display 3; before this, display 3 was captured in full.
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: 'Code.exe', title: 'notes.md', bounds: bounds(0, 0, 800, 600) },
      focusedDisplayId: 1,
      windows: [
        entry({ id: 'w-1', displayId: 1 }),
        entry({ id: 'w-9', processName: '1Password.exe', displayId: 3, blocked: VAULT }),
      ],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays[2]?.blocked).toEqual(VAULT);
    expect(result.displays[2]?.focused).toBe(false);
    expect(result.displays[0]?.blocked).toBeNull();
  });

  it('puts the placeholder for that display in the composite as well', async () => {
    const harnessed = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: 'Code.exe', title: 'notes.md', bounds: bounds(0, 0, 800, 600) },
      focusedDisplayId: 1,
      windows: [entry({ id: 'w-9', processName: '1Password.exe', displayId: 3, blocked: VAULT })],
    });

    await captureDisplaysWith(harnessed.deps, MAX);
    const canvas = compositeOf(harnessed);
    const third = Math.floor(canvas.width / 3);
    const midY = Math.floor(canvas.height / 2);

    expect(pixelAt(canvas, Math.floor(third * 2.5), midY)).not.toEqual(BLUE);
    expect(pixelAt(canvas, Math.floor(third * 0.5), midY)).toEqual(RED);
  });

  it('does not blank a display whose only excluded window is minimized', async () => {
    // A minimized vault is not on screen. Blanking a monitor the user is working on
    // because something is hidden in the taskbar is a bug, not caution.
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      windows: [
        entry({
          id: 'w-9',
          processName: '1Password.exe',
          displayId: 2,
          state: 'minimized',
          blocked: VAULT,
        }),
      ],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays[1]?.blocked).toBeNull();
    expect(result.displays[1]?.image).not.toBeNull();
  });

  it('ignores an excluded window the host could not place on a display', async () => {
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      windows: [entry({ id: 'w-9', processName: '1Password.exe', blocked: VAULT })],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays.every((display) => display.blocked === null)).toBe(true);
  });

  it('still blanks the focused display when the enumeration comes back empty', async () => {
    // The fail-safe. PowerShell missing or blocked by policy must not silently remove the
    // foreground check, so it stays as a floor.
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      active: { appName: '1Password.exe', title: 'Vault', bounds: bounds(2000, 100, 800, 600) },
      focusedDisplayId: 2,
      excludedProcessNames: ['1Password.exe'],
      windows: [],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays[1]?.blocked).toEqual(VAULT);
  });

  it('names the entry that refused, not just that something did', async () => {
    const { deps } = harness({
      displays: THREE_ACROSS,
      sources: THREE_SOURCES,
      windows: [
        entry({
          id: 'w-9',
          processName: 'chrome.exe',
          displayId: 2,
          blocked: { rule: 'titlePattern', entry: '*Vault*' },
        }),
      ],
    });

    const result = await captureDisplaysWith(deps, MAX);

    expect(result.displays[1]?.blocked).toEqual({ rule: 'titlePattern', entry: '*Vault*' });
  });
});
