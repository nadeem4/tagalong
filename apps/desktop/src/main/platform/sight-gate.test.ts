import { describe, expect, it } from 'vitest';

import { SIGHT_POLICY, SightPausedError, gateSight, isSightPaused } from './sight-gate';
import type { Platform } from './index';

const NOTHING_EXCLUDED = { processNames: [], titlePatterns: [] };

/**
 * A platform that answers everything, so any refusal in a test came from the gate rather
 * than from the adapter having nothing to say.
 */
function openPlatform(): Platform {
  return {
    getActiveWindow: async () => ({
      appName: 'Code.exe',
      title: 'sight-gate.ts',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    }),
    captureSelection: async () => 'the highlighted paragraph',
    readClipboard: async () => 'clipboard contents',
    captureActiveWindowImage: async () => ({ base64: 'cG5n', width: 10, height: 10 }),
    captureDisplays: async () => ({ displays: [], composite: null }),
    listWindows: async () => ({ windows: [] }),
    captureRegion: async () => ({ base64: 'cG5n', width: 10, height: 10 }),
    readWindowText: async () => ({
      windowId: 'w-1',
      text: 'hello',
      truncated: false,
      source: 'uia' as const,
    }),
    lookAtWindow: async () => ({ windowId: 'w-1' }),
  };
}

/** Calls one Platform method with arguments its signature accepts. */
function callOf(platform: Platform, method: keyof Platform): () => Promise<unknown> {
  switch (method) {
    case 'getActiveWindow':
      return () => platform.getActiveWindow();
    case 'captureSelection':
      return () => platform.captureSelection();
    case 'readClipboard':
      return () => platform.readClipboard();
    case 'captureActiveWindowImage':
      return () => platform.captureActiveWindowImage(1568, NOTHING_EXCLUDED);
    case 'captureDisplays':
      return () => platform.captureDisplays(1568, NOTHING_EXCLUDED);
    case 'listWindows':
      return () => platform.listWindows(NOTHING_EXCLUDED);
    case 'captureRegion':
      return () =>
        platform.captureRegion(
          { displayId: 1, rect: { x: 0, y: 0, width: 10, height: 10 }, maxLongSide: 1568 },
          NOTHING_EXCLUDED,
        );
    case 'readWindowText':
      return () => platform.readWindowText({ maxChars: 8000 }, NOTHING_EXCLUDED);
    case 'lookAtWindow':
      return () => platform.lookAtWindow({ windowId: 'w-1', maxLongSide: 1568 }, NOTHING_EXCLUDED);
  }
}

const METHODS = Object.keys(SIGHT_POLICY) as Array<keyof Platform>;
const GATED = METHODS.filter((method) => SIGHT_POLICY[method] === 'sight');
const OPEN = METHODS.filter((method) => SIGHT_POLICY[method] !== 'sight');

describe('SIGHT_POLICY', () => {
  it('classifies every method the platform has', () => {
    // The policy is a mapped type over `keyof Platform`, so a method added to the
    // interface without a line here is a compile error rather than a silent hole. This
    // asserts the runtime object really carries every key, which is what the gate walks.
    expect(METHODS.sort()).toEqual(
      [
        'captureActiveWindowImage',
        'captureDisplays',
        'captureRegion',
        'captureSelection',
        'getActiveWindow',
        'listWindows',
        'lookAtWindow',
        'readClipboard',
        'readWindowText',
      ].sort(),
    );
  });

  it('gates every method that reads the screen', () => {
    expect(GATED.sort()).toEqual(
      [
        'getActiveWindow',
        'captureActiveWindowImage',
        'captureDisplays',
        'listWindows',
        'captureRegion',
        'readWindowText',
        'lookAtWindow',
      ].sort(),
    );
  });

  it('leaves the two the user hands over deliberately', () => {
    // The selection and the clipboard are not sight: the user highlighted or copied them
    // on purpose. Pausing sight blinds the pet; it does not stop the user handing it
    // something, which is what makes a paused pet still worth talking to.
    expect(OPEN.sort()).toEqual(['captureSelection', 'readClipboard']);
  });
});

describe('gateSight while running', () => {
  it('passes every call straight through', async () => {
    const gated = gateSight(openPlatform(), () => false);

    for (const method of METHODS) {
      await expect(callOf(gated, method)(), method).resolves.not.toThrow();
    }
  });

  it('returns what the platform returned, not a copy of it', async () => {
    const gated = gateSight(openPlatform(), () => false);

    expect(await gated.captureSelection()).toBe('the highlighted paragraph');
    expect((await gated.getActiveWindow())?.appName).toBe('Code.exe');
  });
});

describe('gateSight while paused', () => {
  it('refuses every method that reads the screen', async () => {
    const gated = gateSight(openPlatform(), () => true);

    for (const method of GATED) {
      await expect(callOf(gated, method)(), method).rejects.toThrow(SightPausedError);
    }
  });

  it('still lets the user hand over a selection and a clipboard', async () => {
    const gated = gateSight(openPlatform(), () => true);

    expect(await gated.captureSelection()).toBe('the highlighted paragraph');
    expect(await gated.readClipboard()).toBe('clipboard contents');
  });

  it('never reaches the platform at all for a gated call', async () => {
    // The refusal has to happen before the read, exactly as the exclusion list does. A
    // screenshot taken and then discarded has still been decoded into this process.
    let reached = false;
    const platform = openPlatform();
    const spy: Platform = {
      ...platform,
      captureDisplays: async (...args) => {
        reached = true;
        return platform.captureDisplays(...args);
      },
    };

    await expect(
      gateSight(spy, () => true).captureDisplays(1568, NOTHING_EXCLUDED),
    ).rejects.toThrow(SightPausedError);
    expect(reached).toBe(false);
  });

  it('names the method it refused, so a log says which read was stopped', async () => {
    const gated = gateSight(openPlatform(), () => true);

    await expect(gated.listWindows(NOTHING_EXCLUDED)).rejects.toThrow(/listWindows/);
  });

  it('reads the pause state per call, not once at construction', async () => {
    // The gate is built at boot and the user pauses later. Reading the flag once would
    // make the hotkey do nothing until restart.
    let paused = false;
    const gated = gateSight(openPlatform(), () => paused);

    await expect(gated.listWindows(NOTHING_EXCLUDED)).resolves.toBeDefined();
    paused = true;
    await expect(gated.listWindows(NOTHING_EXCLUDED)).rejects.toThrow(SightPausedError);
    paused = false;
    await expect(gated.listWindows(NOTHING_EXCLUDED)).resolves.toBeDefined();
  });
});

describe('isSightPaused', () => {
  it('recognises the gate’s own refusal', () => {
    expect(isSightPaused(new SightPausedError('listWindows'))).toBe(true);
  });

  it('does not claim an ordinary failure is a pause', () => {
    // Everything upstream treats perception as best effort and swallows failures. A pause
    // must not be swallowed with them, and an ordinary error must not be reported to the
    // user as "you turned sight off".
    expect(isSightPaused(new Error('the capturer went away'))).toBe(false);
    expect(isSightPaused('paused')).toBe(false);
    expect(isSightPaused(null)).toBe(false);
  });
});
