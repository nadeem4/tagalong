import { describe, expect, it } from 'vitest';

import { parseWindowList, placeOnDisplays } from './window-list';
import type { RawWindow } from './window-list';
import type { WindowBounds } from './index';

/** One line of the helper's output, as it really comes back. */
function raw(overrides: Partial<RawWindow> = {}): RawWindow {
  return {
    handle: 132456,
    processName: 'Code.exe',
    title: 'window-list.ts — tagalong',
    minimized: false,
    foreground: false,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    ...overrides,
  };
}

const ONE = JSON.stringify([raw()]);

describe('parseWindowList', () => {
  it('reads the helper output into observed windows', () => {
    const [window] = parseWindowList(ONE);

    expect(window).toMatchObject({
      id: 'w-132456',
      processName: 'Code.exe',
      title: 'window-list.ts — tagalong',
      state: 'background',
    });
  });

  it('derives the three states from the two flags the helper reports', () => {
    const parsed = parseWindowList(
      JSON.stringify([
        raw({ handle: 1, foreground: true, minimized: false }),
        raw({ handle: 2, foreground: false, minimized: false }),
        raw({ handle: 3, foreground: false, minimized: true }),
      ]),
    );

    expect(parsed.map((w) => w.state)).toEqual(['foreground', 'background', 'minimized']);
  });

  it('treats a minimized window as minimized even if it claims to be foreground', () => {
    // Windows briefly reports both during a minimize animation. Minimized is the safer
    // reading: it is the state the user cannot see, which is what the pet is told about.
    const [window] = parseWindowList(JSON.stringify([raw({ foreground: true, minimized: true })]));
    expect(window?.state).toBe('minimized');
  });

  it('accepts PowerShell collapsing a single-element array into one object', () => {
    // ConvertTo-Json unwraps a one-element array unless told not to. The helper passes
    // -Depth and an array wrapper, but a future edit that drops it should degrade rather
    // than return nothing.
    expect(parseWindowList(JSON.stringify(raw()))).toHaveLength(1);
  });

  it('returns nothing for empty output, which is what a timeout produces', () => {
    expect(parseWindowList('')).toEqual([]);
    expect(parseWindowList('   \n')).toEqual([]);
  });

  it('returns nothing rather than throwing on output that is not JSON', () => {
    // The helper shares stdout with whatever PowerShell decides to print. A broken read
    // must cost the inventory, not the whole ask.
    expect(parseWindowList('At line:1 char:1 + Add-Type ...')).toEqual([]);
  });

  it('skips a malformed entry and keeps the rest', () => {
    const parsed = parseWindowList(
      JSON.stringify([raw({ handle: 1 }), { nonsense: true }, raw({ handle: 3 })]),
    );
    expect(parsed.map((w) => w.id)).toEqual(['w-1', 'w-3']);
  });

  it('skips a window with no usable handle, which cannot be addressed later', () => {
    const parsed = parseWindowList(JSON.stringify([raw({ handle: 0 }), raw({ handle: 7 })]));
    expect(parsed.map((w) => w.id)).toEqual(['w-7']);
  });

  it('tolerates a missing title, because plenty of real windows have none', () => {
    const [window] = parseWindowList(JSON.stringify([{ ...raw(), title: null }]));
    expect(window?.title).toBe('');
  });

  it('skips a window with no process name, which nothing could be decided about', () => {
    // Every policy in the inventory keys off the process name: the exclusion match and
    // the browser flag both need it. An entry without one is not safely classifiable.
    expect(parseWindowList(JSON.stringify([{ ...raw(), processName: '' }]))).toEqual([]);
  });

  it('caps the number of windows it will return', () => {
    // A runaway enumeration must not put a thousand lines into a prompt.
    const many = Array.from({ length: 500 }, (_, index) => raw({ handle: index + 1 }));
    expect(parseWindowList(JSON.stringify(many)).length).toBeLessThanOrEqual(64);
  });
});

describe('placeOnDisplays', () => {
  const screen = {
    getDisplayMatching: (bounds: WindowBounds) => ({ id: bounds.x >= 1920 ? 2 : 1 }),
  };

  it('puts each window on the display its bounds fall in', () => {
    const placed = placeOnDisplays(
      parseWindowList(
        JSON.stringify([
          raw({ handle: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }),
          raw({ handle: 2, bounds: { x: 2000, y: 100, width: 800, height: 600 } }),
        ]),
      ),
      screen,
    );

    expect(placed.map((w) => w.displayId)).toEqual([1, 2]);
  });

  it('leaves a window unplaced rather than guessing when it has no real bounds', () => {
    // A minimized window reports an off-screen or zero rectangle on Windows. Claiming it
    // sits on display 1 would blank display 1 for an excluded minimized app, which is
    // both wrong and alarming.
    const placed = placeOnDisplays(
      parseWindowList(
        JSON.stringify([
          raw({ minimized: true, bounds: { x: -32000, y: -32000, width: 0, height: 0 } }),
        ]),
      ),
      screen,
    );

    expect(placed[0]?.displayId).toBeUndefined();
  });

  it('leaves a window unplaced when the screen lookup throws', () => {
    const throwing = {
      getDisplayMatching: () => {
        throw new Error('no display');
      },
    };
    const placed = placeOnDisplays(parseWindowList(ONE), throwing);
    expect(placed[0]?.displayId).toBeUndefined();
  });
});
