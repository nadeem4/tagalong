/** Tests for the ask's snapshot and the voice path's window-only snapshot. */

import { describe, expect, it, vi } from 'vitest';
import { basename } from 'node:path';
import { ContextSnapshot } from '@tagalong/ui/shapes';
import type { CaptureExclusions } from '../shared/settings';
import type { WindowEntry } from '@tagalong/ui/shapes';
import { captureActiveWindow, captureAskSnapshot } from './context';
import type { Platform } from './platform/index';
import { gateSight } from './platform/sight-gate';

function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    getActiveWindow: async () => ({
      appName: 'Code.exe',
      title: 'selection.ts — tagalong',
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
    }),
    captureSelection: async () => 'the highlighted paragraph',
    // Nothing in this file reads window text; the stub keeps the fake a valid
    // Platform and answers with an empty read, so a test that reaches it by accident
    // fails on missing text rather than on a missing method.
    readWindowText: async () => ({
      windowId: '',
      text: '',
      truncated: false,
      source: 'uia' as const,
    }),
    // Empty by default so a test that reaches the enumeration without meaning
    // to fails on a missing inventory rather than on invented windows.
    listWindows: async () => ({ windows: [] }),
    lookAtWindow: async () => ({ windowId: '' }),
    ...overrides,
  };
}

/** Nothing is excluded unless a test says so, so a block is always deliberate. */
const NOTHING_EXCLUDED: CaptureExclusions = { processNames: [], titlePatterns: [] };
const PASSWORD_MANAGER: CaptureExclusions = {
  processNames: ['1Password.exe'],
  titlePatterns: ['*Vault*'],
};

describe('captureAskSnapshot', () => {
  it('produces a snapshot the protocol accepts', async () => {
    const { snapshot } = await captureAskSnapshot(fakePlatform(), {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(ContextSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.host).toBe('desktop');
    expect(snapshot.selection).toBe('the highlighted paragraph');
    expect(snapshot.app).toEqual({ name: 'Code.exe', windowTitle: 'selection.ts — tagalong' });
  });

  it('omits the fields the platform could not read rather than sending empty ones', async () => {
    const { snapshot } = await captureAskSnapshot(
      fakePlatform({ captureSelection: async () => null, getActiveWindow: async () => null }),
      { exclusions: NOTHING_EXCLUDED },
    );

    expect(snapshot.selection).toBeUndefined();
    expect(snapshot.app).toBeUndefined();
    expect(ContextSnapshot.safeParse(snapshot).success).toBe(true);
  });

  it('still returns a snapshot when perception throws', async () => {
    const { snapshot } = await captureAskSnapshot(
      fakePlatform({
        captureSelection: async () => {
          throw new Error('the foreground window refused the copy');
        },
      }),
      { exclusions: NOTHING_EXCLUDED },
    );

    expect(snapshot.selection).toBeUndefined();
    expect(snapshot.app?.name).toBe('Code.exe');
  });

  it('reads no window list, so the ask stays cheap', async () => {
    // Ctrl+Shift+Space must stay cheap. Enumerating windows costs seconds; Scout takes
    // it itself, through a tool, when a question needs it.
    const listWindows = vi.fn();

    const { snapshot, blocked } = await captureAskSnapshot(fakePlatform({ listWindows }), {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(listWindows).not.toHaveBeenCalled();
    expect(blocked).toBeNull();
    expect(Object.keys(snapshot).sort()).toEqual(['app', 'capturedAt', 'host', 'id', 'selection']);
  });

  it('says which rule blocks an excluded window and keeps its title out', async () => {
    const platform = fakePlatform({
      getActiveWindow: async () => ({
        appName: '1Password.exe',
        title: 'All Items',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { snapshot, blocked } = await captureAskSnapshot(platform, {
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
    // Which app, never the blocked window's title.
    expect(snapshot.app).toEqual({ name: '1Password.exe', blocked });
    expect(snapshot.app?.windowTitle).toBeUndefined();
  });

  it('never copies the selection out of a window it must not look at, such as a .env file', async () => {
    const captureSelection = vi.fn(async () => 'API_KEY=abc123');
    const platform = fakePlatform({
      captureSelection,
      getActiveWindow: async () => ({
        appName: 'Code.exe',
        title: '.env - ai_pet - Visual Studio Code',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { snapshot, blocked } = await captureAskSnapshot(platform, {
      exclusions: NOTHING_EXCLUDED,
    });

    // Not even Ctrl+C: the text never reaches the clipboard, let alone a model.
    expect(captureSelection).not.toHaveBeenCalled();
    expect(snapshot.selection).toBeUndefined();
    expect(blocked).toEqual({ rule: 'titlePattern', entry: '.env' });
    expect(snapshot.app?.windowTitle).toBeUndefined();
  });

  it('blocks a web vault by its window title, not by the browser it runs in', async () => {
    const platform = fakePlatform({
      getActiveWindow: async () => ({
        appName: 'chrome.exe',
        title: 'My Vault — Acme',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { snapshot, blocked } = await captureAskSnapshot(platform, {
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked).toEqual({ rule: 'titlePattern', entry: '*Vault*' });
    expect(snapshot.app).toEqual({ name: 'chrome.exe', blocked });
  });
});

describe('captureActiveWindow', () => {
  it('names the window in focus and reads no selection', async () => {
    const captureSelection = vi.fn(async () => 'text');
    const { patch, blocked, paused } = await captureActiveWindow(
      fakePlatform({ captureSelection }),
      {
        exclusions: NOTHING_EXCLUDED,
      },
    );

    expect(patch.app).toEqual({ name: 'Code.exe', windowTitle: 'selection.ts — tagalong' });
    expect(captureSelection).not.toHaveBeenCalled();
    expect(blocked).toBeNull();
    expect(paused).toBe(false);
  });

  it('looks past its own windows to the one the person was using', async () => {
    // Scout's bubble has the focus while the person types to it, so "the window in front"
    // is Scout itself. The next window down is the one they mean.
    const own = basename(process.execPath);
    const windows: WindowEntry[] = [
      { id: 'w-1', processName: own, title: 'Tagalong', state: 'foreground', browser: false },
      {
        id: 'w-2',
        processName: 'Code.exe',
        title: 'engine.ts - ai_pet',
        state: 'background',
        browser: false,
      },
    ];
    const platform = fakePlatform({
      getActiveWindow: async () => ({
        appName: own,
        title: 'Tagalong',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
      }),
      listWindows: async () => ({ windows }),
    });

    const { patch } = await captureActiveWindow(platform, { exclusions: NOTHING_EXCLUDED });

    expect(patch.app).toEqual({ name: 'Code.exe', windowTitle: 'engine.ts - ai_pet' });
  });

  it('reports the rule that blocks the window and keeps its title out', async () => {
    const platform = fakePlatform({
      getActiveWindow: async () => ({
        appName: '1Password.exe',
        title: 'All Items',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { patch, blocked } = await captureActiveWindow(platform, {
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
    expect(patch.app).toEqual({ name: '1Password.exe', blocked });
  });

  it('reports a pause instead of an empty read', async () => {
    const result = await captureActiveWindow(pausedPlatform(), { exclusions: NOTHING_EXCLUDED });

    expect(result.paused).toBe(true);
    expect(result.patch.app).toBeUndefined();
  });
});

/** A platform gated by a pause that is already on, exactly as the host builds it. */
function pausedPlatform(overrides: Partial<Platform> = {}): Platform {
  return gateSight(fakePlatform(overrides), () => true);
}

describe('captureAskSnapshot while sight is paused', () => {
  it('reports the capture as paused rather than as merely empty', async () => {
    // The distinction is the whole point: a failed read returns nothing, and nothing is
    // what an unproductive capture also looks like.
    const capture = await captureAskSnapshot(pausedPlatform(), {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.paused).toBe(true);
  });

  it('carries no app', async () => {
    const capture = await captureAskSnapshot(pausedPlatform(), {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.snapshot.app).toBeUndefined();
  });

  it('still carries the selection the user highlighted', async () => {
    // Pausing sight blinds the pet. It does not refuse what the user hands over, or a
    // paused pet would be useless rather than merely blind.
    const capture = await captureAskSnapshot(pausedPlatform(), {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.snapshot.selection).toBe('the highlighted paragraph');
  });

  it('is not reported as blocked, which means something else entirely', async () => {
    // "You turned sight off" and "this app is on your exclusion list" are different
    // facts, and the pet must not say the second when the first is true.
    const capture = await captureAskSnapshot(pausedPlatform(), {
      exclusions: PASSWORD_MANAGER,
    });

    expect(capture.paused).toBe(true);
    expect(capture.blocked).toBeNull();
  });

  it('reports not paused on an ordinary capture', async () => {
    const capture = await captureAskSnapshot(fakePlatform(), {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.paused).toBe(false);
  });
});

describe('a real failure is still swallowed while a pause is not', () => {
  it('keeps treating an ordinary capture failure as best effort', async () => {
    // Perception stays best effort: a clipboard the OS briefly locked must not cost the
    // user their ask. Only the pause is promoted out of that.
    const capture = await captureAskSnapshot(
      fakePlatform({
        getActiveWindow: async () => {
          throw new Error('the window went away');
        },
      }),
      { exclusions: NOTHING_EXCLUDED },
    );

    expect(capture.paused).toBe(false);
    expect(capture.snapshot.app).toBeUndefined();
    expect(capture.snapshot.selection).toBe('the highlighted paragraph');
  });
});
