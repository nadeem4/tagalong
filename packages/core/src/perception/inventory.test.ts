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
      }),
    );
  }

  it('stays under 300 tokens on a twelve-window desktop', () => {
    // The acceptance clause. The inventory rides along with every full-view capture, so
    // it is paid for on every ask whether or not the pet uses it.
    //
    // Measured at 276 against a budget of 300: about 8% of headroom, which is not much.
    // Anything added to a *line* is multiplied by the window count, so put new wording in
    // the header instead. Moving the browser caveat out of the lines is what brought this
    // from 383 down to 276.
    const text = renderInventory(buildInventory(desktopOf(12), NOTHING_EXCLUDED));
    expect(tokens(text)).toBeLessThan(300);
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
