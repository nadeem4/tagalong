import { describe, expect, it } from 'vitest';
import type { CaptureExclusions } from '@tagalong/protocol';

import { buildInventory, isBrowserProcess, renderInventory } from './inventory';
import type { ObservedWindow } from './inventory';

const NOTHING_EXCLUDED: CaptureExclusions = { processNames: [], titlePatterns: [] };
const PASSWORD_MANAGER: CaptureExclusions = {
  processNames: ['1Password.exe'],
  titlePatterns: ['*Vault*'],
};

function observed(overrides: Partial<ObservedWindow> = {}): ObservedWindow {
  return {
    id: 'w-1',
    processName: 'Code.exe',
    title: 'inventory.ts — tagalong',
    state: 'background',
    displayId: 1,
    ...overrides,
  };
}

describe('isBrowserProcess', () => {
  it('knows the Chromium browsers whose tabs need the extension', () => {
    for (const name of ['chrome', 'msedge', 'brave', 'vivaldi', 'opera']) {
      expect(isBrowserProcess(name), name).toBe(true);
    }
  });

  it('ignores case and the exe extension, as the exclusion list does', () => {
    // Windows reports the same binary as Chrome.exe, chrome.exe or CHROME.EXE depending
    // on who asked. This reuses the exclusion list's own folding rather than repeating it.
    for (const name of ['Chrome.exe', 'CHROME.EXE', '  chrome  ']) {
      expect(isBrowserProcess(name), name).toBe(true);
    }
  });

  it('does not mistake an editor or a terminal for a browser', () => {
    for (const name of ['Code.exe', 'WindowsTerminal.exe', 'explorer', 'chromium-helper-thing']) {
      expect(isBrowserProcess(name), name).toBe(false);
    }
  });
});

describe('buildInventory', () => {
  it('carries what a window is and where, and no text', () => {
    const [entry] = buildInventory([observed()], NOTHING_EXCLUDED);

    expect(entry).toEqual({
      id: 'w-1',
      processName: 'Code.exe',
      title: 'inventory.ts — tagalong',
      state: 'background',
      displayId: 1,
      browser: false,
    });
    expect(entry).not.toHaveProperty('text');
    expect(entry).not.toHaveProperty('textChars');
  });

  it('flags a browser window, whose other tabs the desktop host cannot reach', () => {
    const [entry] = buildInventory([observed({ processName: 'chrome.exe' })], NOTHING_EXCLUDED);
    expect(entry?.browser).toBe(true);
  });

  it('marks an excluded window and names the rule that refused it', () => {
    const [entry] = buildInventory(
      [observed({ processName: '1Password.exe', title: 'Personal' })],
      PASSWORD_MANAGER,
    );

    expect(entry?.blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
  });

  it('matches an excluded window by title as well as by process', () => {
    const [entry] = buildInventory(
      [observed({ processName: 'chrome.exe', title: 'My Vault — Bitwarden' })],
      PASSWORD_MANAGER,
    );

    expect(entry?.blocked?.rule).toBe('titlePattern');
  });

  it('withholds the title of a blocked window', () => {
    // The title is the leak. "Chase — Transfer to savings" says most of what the window
    // holds, and the inventory is attached to every full-view capture.
    const [entry] = buildInventory(
      [observed({ processName: '1Password.exe', title: 'AWS root — production' })],
      PASSWORD_MANAGER,
    );

    expect(entry?.title).toBe('');
    expect(entry?.processName).toBe('1Password.exe');
  });

  it('keeps a minimized window, which UI Automation can still read', () => {
    const [entry] = buildInventory([observed({ state: 'minimized' })], NOTHING_EXCLUDED);
    expect(entry?.state).toBe('minimized');
  });

  it('omits displayId when the host could not place the window', () => {
    // The key is absent rather than set to undefined: exactOptionalPropertyTypes is on,
    // and a minimized window really does come back unplaced.
    const { displayId: _unplaced, ...unplaced } = observed();
    const [entry] = buildInventory([unplaced], NOTHING_EXCLUDED);
    expect(entry).not.toHaveProperty('displayId');
  });

  it('carries the full-screen mark, so a pet keeping an eye stays quiet over a film', () => {
    const [entry] = buildInventory([observed({ fullScreen: true })], NOTHING_EXCLUDED);
    expect(entry?.fullScreen).toBe(true);
    const [plain] = buildInventory([observed()], NOTHING_EXCLUDED);
    expect(plain).not.toHaveProperty('fullScreen');
  });

  it('returns entries in the order the host enumerated them', () => {
    const entries = buildInventory(
      [observed({ id: 'w-3' }), observed({ id: 'w-1' }), observed({ id: 'w-2' })],
      NOTHING_EXCLUDED,
    );
    expect(entries.map((e) => e.id)).toEqual(['w-3', 'w-1', 'w-2']);
  });

  it('accepts an empty enumeration', () => {
    expect(buildInventory([], NOTHING_EXCLUDED)).toEqual([]);
  });
});

describe('renderInventory', () => {
  /**
   * Roughly three characters per token.
   *
   * The usual English rule of thumb is four, but this text is short identifiers, digits
   * and punctuation, which tokenize worse than prose. Three is the pessimistic end, so a
   * budget that holds here holds on a real tokenizer.
   */
  const CHARS_PER_TOKEN = 3;
  const tokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

  function desktopOf(count: number): ObservedWindow[] {
    return Array.from({ length: count }, (_, index) =>
      observed({
        id: `w-${index + 1}`,
        processName: index % 3 === 0 ? 'chrome.exe' : 'Code.exe',
        title: `A fairly ordinary window title number ${index + 1}`,
        displayId: (index % 3) + 1,
        state: index === 0 ? 'foreground' : index % 4 === 0 ? 'minimized' : 'background',
        // Counts on every line, because that is what the budget has to survive. A fixture
        // without them would measure the inventory as it was before the text layer.
        textChars: index % 5 === 0 ? 0 : index * 1_237,
      }),
    );
  }

  it('stays under 400 tokens on a twelve-window desktop carrying text counts', () => {
    // The acceptance clause. The inventory rides along with every full-view capture, so
    // it is paid for on every ask whether or not the pet uses it.
    //
    // The budget rose from 300 to 400 when the text layer added a readable-character
    // count to every line. Measured at 311 (932 characters), so about 22% of headroom —
    // more than the 8% the pre-count inventory was left with, because the counts are
    // short and the explanation of them sits in the header.
    //
    // Anything added to a *line* is multiplied by the window count, so new wording
    // belongs in the header instead. Moving the browser caveat out of the lines is what
    // brought the pre-count figure from 383 down to 276.
    //
    // Measured grouped across three screens, the longer of the two layouts.
    const screens = [1, 2, 3].map((id) => ({
      id,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      primary: id === 1,
    }));
    const text = renderInventory(buildInventory(desktopOf(12), NOTHING_EXCLUDED), screens);
    expect(tokens(text)).toBeLessThan(400);
  });

  it('truncates a long title rather than letting one window eat the budget', () => {
    // Windows allows titles around 260 characters. Three of those would blow the budget
    // on their own.
    const text = renderInventory(
      buildInventory([observed({ title: 'x'.repeat(260) })], NOTHING_EXCLUDED),
    );
    expect(text).not.toContain('x'.repeat(200));
    expect(text).toContain('…');
  });

  it('names every window id, so the pet can ask for one by id', () => {
    const text = renderInventory(buildInventory(desktopOf(5), NOTHING_EXCLUDED));
    for (let index = 1; index <= 5; index += 1) {
      expect(text, `w-${index}`).toContain(`w-${index}`);
    }
  });

  it('says a window is minimized, because that is what the user cannot see', () => {
    const text = renderInventory(
      buildInventory([observed({ state: 'minimized' })], NOTHING_EXCLUDED),
    );
    expect(text).toContain('minimized');
  });

  it('says a browser window holds tabs the desktop host cannot read', () => {
    // Without this the pet reads one tab's text and answers as though it saw all ten.
    const text = renderInventory(
      buildInventory([observed({ processName: 'chrome.exe' })], NOTHING_EXCLUDED),
    );
    expect(text.toLowerCase()).toContain('tab');
  });

  it('shows a blocked window as blocked and leaks no title', () => {
    const text = renderInventory(
      buildInventory(
        [observed({ processName: '1Password.exe', title: 'AWS root — production' })],
        PASSWORD_MANAGER,
      ),
    );

    expect(text).toContain('blocked');
    expect(text).not.toContain('AWS root');
  });

  it('says plainly when there are no windows', () => {
    expect(renderInventory([])).toMatch(/no .*window/i);
  });
});

describe('renderInventory by screen', () => {
  // Raw Electron ids, deliberately not 1 and 2: the pet must never see these as screen numbers.
  const SCREENS = [
    { id: 2528732444, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true },
    { id: 77, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, primary: false },
  ];

  function desktop(): ObservedWindow[] {
    return [
      observed({
        id: 'w-1',
        processName: 'Code.exe',
        title: 'engine.ts',
        state: 'foreground',
        displayId: 2528732444,
      }),
      observed({ id: 'w-2', processName: 'chrome.exe', title: 'PR #64', displayId: 2528732444 }),
      observed({ id: 'w-3', processName: 'slack.exe', title: '#general', displayId: 77 }),
      // Minimized windows have no real bounds, so the host leaves them unplaced.
      unplaced({ id: 'w-4', processName: 'OUTLOOK.EXE', title: 'Inbox', state: 'minimized' }),
    ];
  }

  function unplaced(overrides: Partial<ObservedWindow>): ObservedWindow {
    const { displayId: _dropped, ...rest } = observed(overrides);
    return rest;
  }

  const render = (screens = SCREENS): string =>
    renderInventory(buildInventory(desktop(), NOTHING_EXCLUDED), screens);

  it('numbers screens in host order, as the composite labels them, never by raw id', () => {
    const text = render();
    expect(text).not.toContain('2528732444');
    expect(text).not.toMatch(/\bd77\b/);
    expect(text).toMatch(/^Screen 1\b/m);
    expect(text).toMatch(/^Screen 2\b/m);
  });

  it('says how many screens there are and their sizes', () => {
    const text = render();
    expect(text).toContain('2 screens');
    expect(text).toContain('1920x1080');
    expect(text).toContain('2560x1440');
    expect(text).toMatch(/primary/);
  });

  it('lists each window under its own screen, top first', () => {
    const lines = render().split('\n');
    const at = (prefix: string): number => lines.findIndex((line) => line.startsWith(prefix));
    expect(at('Screen 1')).toBeLessThan(at('w-1'));
    expect(at('w-1')).toBeLessThan(at('w-2'));
    expect(at('w-2')).toBeLessThan(at('Screen 2'));
    expect(at('Screen 2')).toBeLessThan(at('w-3'));
  });

  it('gathers minimized windows on their own, after the screens', () => {
    const lines = render().split('\n');
    const minimized = lines.findIndex((line) => line.startsWith('Minimized'));
    expect(minimized).toBeGreaterThan(lines.findIndex((line) => line.startsWith('w-3')));
    expect(lines.findIndex((line) => line.startsWith('w-4'))).toBeGreaterThan(minimized);
  });

  it('names a screen with nothing open on it rather than dropping it', () => {
    const third = { id: 5, bounds: { x: 0, y: 1080, width: 1280, height: 720 }, primary: false };
    expect(render([...SCREENS, third])).toMatch(/^Screen 3.*nothing open/m);
  });

  it('still leaks no title for a blocked window placed on a screen', () => {
    const text = renderInventory(
      buildInventory(
        [observed({ processName: '1Password.exe', title: 'AWS root — production', displayId: 77 })],
        PASSWORD_MANAGER,
      ),
      SCREENS,
    );
    expect(text).toContain('blocked');
    expect(text).not.toContain('AWS root');
  });

  it('prints no raw display ids when the host did not name its screens', () => {
    const text = renderInventory(buildInventory(desktop(), NOTHING_EXCLUDED));
    expect(text).not.toContain('2528732444');
    expect(text).not.toMatch(/\bd77\b/);
    expect(text).toMatch(/^Minimized/m);
  });
});

describe('the readable-character count', () => {
  it('carries a count the host supplied', () => {
    const [entry] = buildInventory([observed({ textChars: 5_399 })], NOTHING_EXCLUDED);
    expect(entry?.textChars).toBe(5_399);
  });

  it('leaves the count absent when the host did not supply one', () => {
    const [entry] = buildInventory([observed({})], NOTHING_EXCLUDED);
    expect(entry?.textChars).toBeUndefined();
  });

  it('carries a zero count, which is different from not knowing', () => {
    // A window that published nothing is a fact worth telling the pet: it stops it
    // spending a tool call to find out.
    const [entry] = buildInventory([observed({ textChars: 0 })], NOTHING_EXCLUDED);
    expect(entry?.textChars).toBe(0);
  });

  it('drops the count for an excluded window', () => {
    // The count is itself a small leak. Knowing a vault holds 4,000 characters says more
    // than nothing at all, and the window is one the user asked Tagalong never to read.
    const [entry] = buildInventory([observed({ processName: '1Password.exe', textChars: 4_000 })], {
      processNames: ['1Password.exe'],
      titlePatterns: [],
    });
    expect(entry?.blocked).toBeDefined();
    expect(entry?.textChars).toBeUndefined();
  });

  it('renders a small count exactly and a large one rounded', () => {
    const text = renderInventory(
      buildInventory(
        [observed({ id: 'w-1', textChars: 456 }), observed({ id: 'w-2', textChars: 5_399 })],
        NOTHING_EXCLUDED,
      ),
    );
    expect(text).toContain('t456');
    expect(text).toContain('t5k');
  });

  it('says nothing about text for a window with no count, rather than implying zero', () => {
    const text = renderInventory(buildInventory([observed({ id: 'w-9' })], NOTHING_EXCLUDED));
    const line = text.split('\n').find((row) => row.startsWith('w-9')) ?? '';
    expect(line).not.toMatch(/\bt\d/);
  });

  it('explains the count marker in the header, not on every line', () => {
    const text = renderInventory(buildInventory([observed({ textChars: 10 })], NOTHING_EXCLUDED));
    expect(text.split('\n')[0]).toMatch(/t\d/);
  });
});
