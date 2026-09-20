import { describe, expect, it } from 'vitest';

import type { ObservedWindow } from '@tagalong/core';

import {
  attachTextCounts,
  countableHandles,
  parseWindowList,
  placeOnDisplays,
} from './window-list';

/**
 * The windows alone, for the many cases that care about what was parsed rather than
 * whether the enumeration failed.
 */
const windowsFrom = (stdout: string): ReturnType<typeof parseWindowList>['windows'] =>
  parseWindowList(stdout).windows;
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
    const [window] = windowsFrom(ONE);

    expect(window).toMatchObject({
      id: 'w-132456',
      processName: 'Code.exe',
      title: 'window-list.ts — tagalong',
      state: 'background',
    });
  });

  it('derives the three states from the two flags the helper reports', () => {
    const parsed = windowsFrom(
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
    const [window] = windowsFrom(JSON.stringify([raw({ foreground: true, minimized: true })]));
    expect(window?.state).toBe('minimized');
  });

  it('accepts PowerShell collapsing a single-element array into one object', () => {
    // ConvertTo-Json unwraps a one-element array unless told not to. The helper passes
    // -Depth and an array wrapper, but a future edit that drops it should degrade rather
    // than return nothing.
    expect(windowsFrom(JSON.stringify(raw()))).toHaveLength(1);
  });

  it('returns nothing for empty output, which is what a timeout produces', () => {
    expect(windowsFrom('')).toEqual([]);
    expect(windowsFrom('   \n')).toEqual([]);
  });

  it('returns nothing rather than throwing on output that is not JSON', () => {
    // The helper shares stdout with whatever PowerShell decides to print. A broken read
    // must cost the inventory, not the whole ask.
    expect(windowsFrom('At line:1 char:1 + Add-Type ...')).toEqual([]);
  });

  it('skips a malformed entry and keeps the rest', () => {
    const parsed = windowsFrom(
      JSON.stringify([raw({ handle: 1 }), { nonsense: true }, raw({ handle: 3 })]),
    );
    expect(parsed.map((w) => w.id)).toEqual(['w-1', 'w-3']);
  });

  it('skips a window with no usable handle, which cannot be addressed later', () => {
    const parsed = windowsFrom(JSON.stringify([raw({ handle: 0 }), raw({ handle: 7 })]));
    expect(parsed.map((w) => w.id)).toEqual(['w-7']);
  });

  it('tolerates a missing title, because plenty of real windows have none', () => {
    const [window] = windowsFrom(JSON.stringify([{ ...raw(), title: null }]));
    expect(window?.title).toBe('');
  });

  it('skips a window with no process name, which nothing could be decided about', () => {
    // Every policy in the inventory keys off the process name: the exclusion match and
    // the browser flag both need it. An entry without one is not safely classifiable.
    expect(windowsFrom(JSON.stringify([{ ...raw(), processName: '' }]))).toEqual([]);
  });

  it('caps the number of windows it will return', () => {
    // A runaway enumeration must not put a thousand lines into a prompt.
    const many = Array.from({ length: 500 }, (_, index) => raw({ handle: index + 1 }));
    expect(windowsFrom(JSON.stringify(many)).length).toBeLessThanOrEqual(64);
  });
});

describe('placeOnDisplays', () => {
  const screen = {
    getDisplayMatching: (bounds: WindowBounds) => ({ id: bounds.x >= 1920 ? 2 : 1 }),
  };

  it('puts each window on the display its bounds fall in', () => {
    const placed = placeOnDisplays(
      windowsFrom(
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
      windowsFrom(
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
    const placed = placeOnDisplays(windowsFrom(ONE), throwing);
    expect(placed[0]?.displayId).toBeUndefined();
  });
});

describe('countableHandles', () => {
  const observed = (id: string, processName: string, title = ''): ObservedWindow => ({
    id,
    processName,
    title,
    state: 'background',
  });

  it('offers every window the exclusion list allows', () => {
    const handles = countableHandles([observed('w-1', 'Code.exe'), observed('w-2', 'chrome.exe')], {
      processNames: [],
      titlePatterns: [],
    });

    expect(handles).toEqual([1, 2]);
  });

  it('leaves out an excluded window, because counting it means walking it', () => {
    // The count is not the leak; the walk is. Counting an excluded window would pull its
    // contents into the helper process to measure them.
    const handles = countableHandles(
      [observed('w-1', 'Code.exe'), observed('w-2', '1Password.exe')],
      { processNames: ['1Password.exe'], titlePatterns: [] },
    );

    expect(handles).toEqual([1]);
  });

  it('leaves out a window excluded by its title', () => {
    const handles = countableHandles([observed('w-1', 'chrome.exe', 'My Vault — 1Password')], {
      processNames: [],
      titlePatterns: ['*Vault*'],
    });

    expect(handles).toEqual([]);
  });

  it('skips an id it cannot turn back into a handle', () => {
    expect(
      countableHandles([observed('nonsense', 'Code.exe')], {
        processNames: [],
        titlePatterns: [],
      }),
    ).toEqual([]);
  });
});

describe('attachTextCounts', () => {
  const observed = (id: string): ObservedWindow => ({
    id,
    processName: 'Code.exe',
    title: 'a',
    state: 'background',
  });

  it('attaches the count for a window that has one', () => {
    const [window] = attachTextCounts([observed('w-1')], new Map([[1, 456]]));
    expect(window?.textChars).toBe(456);
  });

  it('attaches a zero, which says the window published nothing', () => {
    const [window] = attachTextCounts([observed('w-1')], new Map([[1, 0]]));
    expect(window?.textChars).toBe(0);
  });

  it('leaves a window with no count alone rather than calling it zero', () => {
    // Absent means nobody looked. Rendering that as zero would have the pet skip a
    // window worth reading.
    const [window] = attachTextCounts([observed('w-1')], new Map());
    expect(window?.textChars).toBeUndefined();
  });

  it('keeps every other field untouched', () => {
    const [window] = attachTextCounts([observed('w-7')], new Map([[7, 1]]));
    expect(window?.id).toBe('w-7');
    expect(window?.processName).toBe('Code.exe');
    expect(window?.state).toBe('background');
  });
});

describe('telling a failed enumeration from an empty desktop', () => {
  /**
   * The distinction this whole block exists for. A broken transport and a quiet desktop
   * produced the same value — an empty array — which is how a completely non-functional
   * enumeration shipped through a task, a review and a green CI run.
   */
  it('reports no-output when the helper printed nothing', () => {
    // Exactly what a silently failing PowerShell produces: exit 0, empty stdout, empty
    // stderr. Indistinguishable from success unless it is named.
    expect(parseWindowList('').failure).toBe('no-output');
    expect(parseWindowList('   \n ').failure).toBe('no-output');
  });

  it('reports unparseable when the helper printed something that is not JSON', () => {
    expect(parseWindowList('At line:1 char:1').failure).toBe('unparseable');
    expect(parseWindowList('{"broken":').failure).toBe('unparseable');
  });

  it('reports no-windows for a well-formed but empty list', () => {
    // A running desktop cannot legitimately have zero top-level windows: Tagalong's own
    // window is one of them. Zero is a failure, not a state.
    expect(parseWindowList('[]').failure).toBe('no-windows');
  });

  it('reports no failure when it actually enumerated something', () => {
    const outcome = parseWindowList(
      JSON.stringify([
        {
          handle: 1,
          processName: 'Code.exe',
          title: 'a',
          minimized: false,
          foreground: true,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
        },
      ]),
    );

    expect(outcome.failure).toBeUndefined();
    expect(outcome.windows).toHaveLength(1);
  });

  it('reports no-windows when every entry was malformed', () => {
    // Output arrived and parsed, but nothing survived validation. That is a failure of
    // the same kind, not a desktop with nothing on it.
    expect(parseWindowList(JSON.stringify([null, 42, { nope: true }])).failure).toBe('no-windows');
  });

  it('always carries an array, so a caller that ignores the failure still works', () => {
    for (const junk of ['', 'nonsense', '[]']) {
      expect(Array.isArray(parseWindowList(junk).windows)).toBe(true);
    }
  });
});
