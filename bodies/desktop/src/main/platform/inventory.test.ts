/** Tests for the window inventory: browsers, blocked windows and text counts. */
import { describe, expect, it } from 'vitest';
import type { CaptureExclusions } from '../../shared/settings';

import { buildInventory } from './inventory';
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

  it('flags the Chromium browsers, whose other tabs the desktop host cannot reach', () => {
    for (const name of ['chrome', 'msedge', 'brave', 'vivaldi', 'opera']) {
      const [entry] = buildInventory([observed({ processName: name })], NOTHING_EXCLUDED);
      expect(entry?.browser, name).toBe(true);
    }
  });

  it('ignores case and the exe extension when it flags a browser', () => {
    // Windows reports the same binary as Chrome.exe, chrome.exe or CHROME.EXE depending
    // on who asked.
    for (const name of ['Chrome.exe', 'CHROME.EXE', '  chrome  ']) {
      const [entry] = buildInventory([observed({ processName: name })], NOTHING_EXCLUDED);
      expect(entry?.browser, name).toBe(true);
    }
  });

  it('does not mistake an editor or a terminal for a browser', () => {
    for (const name of ['Code.exe', 'WindowsTerminal.exe', 'explorer', 'chromium-helper-thing']) {
      const [entry] = buildInventory([observed({ processName: name })], NOTHING_EXCLUDED);
      expect(entry?.browser, name).toBe(false);
    }
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

  it('carries the full-screen mark, so listening can wait over a film', () => {
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
});
