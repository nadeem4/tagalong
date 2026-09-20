import { describe, expect, it, vi } from 'vitest';
import { ContextSnapshot } from '@tagalong/protocol';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import {
  DESKTOP_CAPABILITIES,
  MAX_SCREENSHOT_LONG_SIDE,
  captureAskSnapshot,
  capturePatch,
} from './context';
import type { Platform } from './platform/index';

function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    getActiveWindow: async () => ({
      appName: 'Code.exe',
      title: 'selection.ts — tagalong',
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
    }),
    captureSelection: async () => 'the highlighted paragraph',
    readClipboard: async () => 'clipboard contents',
    captureActiveWindowImage: async () => ({ base64: 'cG5n', width: 1568, height: 882 }),
    // Phase 2B. Nothing in this file asks for displays yet; the stub exists so the fake
    // still satisfies Platform, and returns an empty capture so a test that reaches it by
    // accident fails on missing displays rather than on a missing method.
    captureDisplays: async () => ({ displays: [], composite: null }),
    // Phase 2B. Nothing in this file reads window text; the stub keeps the fake a valid
    // Platform and answers with an empty read, so a test that reaches it by accident
    // fails on missing text rather than on a missing method.
    readWindowText: async () => ({
      windowId: '',
      text: '',
      truncated: false,
      source: 'uia' as const,
    }),
    // Phase 2B. Empty by default so a test that reaches the enumeration without meaning
    // to fails on a missing inventory rather than on invented windows.
    listWindows: async () => ({ windows: [] }),
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
      screenshot: false,
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
      { screenshot: false, exclusions: NOTHING_EXCLUDED },
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
      { screenshot: false, exclusions: NOTHING_EXCLUDED },
    );

    expect(snapshot.selection).toBeUndefined();
    expect(snapshot.app?.name).toBe('Code.exe');
  });

  it('takes no picture at all for a text-only ask, so a cheap ask stays cheap', async () => {
    const captureActiveWindowImage = vi.fn(async () => null);

    const { snapshot, blocked } = await captureAskSnapshot(
      fakePlatform({ captureActiveWindowImage }),
      {
        screenshot: false,
        exclusions: NOTHING_EXCLUDED,
      },
    );

    expect(captureActiveWindowImage).not.toHaveBeenCalled();
    expect(snapshot.screenshot).toBeUndefined();
    expect(blocked).toBeNull();
  });

  it('attaches a PNG when the ask asked to look', async () => {
    const captureActiveWindowImage = vi.fn(async () => ({
      base64: 'cG5n',
      width: 1568,
      height: 882,
    }));

    const { snapshot, blocked } = await captureAskSnapshot(
      fakePlatform({ captureActiveWindowImage }),
      {
        screenshot: true,
        exclusions: NOTHING_EXCLUDED,
      },
    );

    expect(captureActiveWindowImage).toHaveBeenCalledWith(MAX_SCREENSHOT_LONG_SIDE);
    expect(snapshot.screenshot).toEqual({
      mime: 'image/png',
      base64: 'cG5n',
      width: 1568,
      height: 882,
    });
    expect(blocked).toBeNull();
    expect(ContextSnapshot.safeParse(snapshot).success).toBe(true);
  });

  it('refuses to photograph an excluded window and says which rule refused', async () => {
    const captureActiveWindowImage = vi.fn(async () => ({
      base64: 'cG5n',
      width: 10,
      height: 10,
    }));
    const platform = fakePlatform({
      captureActiveWindowImage,
      getActiveWindow: async () => ({
        appName: '1Password.exe',
        title: 'All Items',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { snapshot, blocked } = await captureAskSnapshot(platform, {
      screenshot: true,
      exclusions: PASSWORD_MANAGER,
    });

    expect(captureActiveWindowImage).not.toHaveBeenCalled();
    expect(snapshot.screenshot).toBeUndefined();
    expect(blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
  });

  it('blocks a web vault by its window title, not by the browser it runs in', async () => {
    const platform = fakePlatform({
      getActiveWindow: async () => ({
        appName: 'chrome.exe',
        title: 'My Vault — Bitwarden',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { blocked } = await captureAskSnapshot(platform, {
      screenshot: true,
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked).toEqual({ rule: 'titlePattern', entry: '*Vault*' });
  });

  it('keeps the rest of the snapshot when the screenshot itself fails', async () => {
    const { snapshot, blocked } = await captureAskSnapshot(
      fakePlatform({
        captureActiveWindowImage: async () => {
          throw new Error('the window vanished mid-capture');
        },
      }),
      { screenshot: true, exclusions: NOTHING_EXCLUDED },
    );

    expect(snapshot.screenshot).toBeUndefined();
    expect(snapshot.selection).toBe('the highlighted paragraph');
    expect(blocked).toBeNull();
  });
});

describe('capturePatch', () => {
  it('reads only what the engine asked for', async () => {
    const { patch } = await capturePatch(fakePlatform(), ['clipboard'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch).toEqual({ clipboard: 'clipboard contents' });
  });

  it('leaves out targets this host cannot perceive', async () => {
    const { patch } = await capturePatch(fakePlatform(), ['pageText'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch).toEqual({});
  });

  it('answers a screenshot request from a pet tool with a PNG', async () => {
    const { patch, blocked } = await capturePatch(fakePlatform(), ['screenshot'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch.screenshot).toEqual({
      mime: 'image/png',
      base64: 'cG5n',
      width: 1568,
      height: 882,
    });
    expect(blocked).toBeNull();
  });

  it('enforces the exclusions on a tool-driven capture too', async () => {
    const captureActiveWindowImage = vi.fn(async () => ({ base64: 'cG5n', width: 8, height: 8 }));
    const platform = fakePlatform({
      captureActiveWindowImage,
      getActiveWindow: async () => ({
        appName: '1Password.exe',
        title: 'All Items',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    });

    const { patch, blocked } = await capturePatch(platform, ['screenshot'], {
      exclusions: PASSWORD_MANAGER,
    });

    expect(captureActiveWindowImage).not.toHaveBeenCalled();
    expect(patch.screenshot).toBeUndefined();
    expect(blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
  });
});

describe('the windows perception target', () => {
  const inventory: WindowEntry[] = [
    {
      id: 'w-1',
      processName: 'Code.exe',
      title: 'context.ts — tagalong',
      state: 'minimized',
      displayId: 1,
      browser: false,
    },
  ];

  it('asks the platform for the inventory and puts it in the patch', async () => {
    const platform = fakePlatform({ listWindows: async () => ({ windows: inventory }) });

    const { patch } = await capturePatch(platform, ['windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch.windows).toEqual(inventory);
  });

  it('does not enumerate windows when the engine did not ask for them', async () => {
    // The enumeration spawns PowerShell. A text-only ask must not pay for it.
    const listWindows = vi.fn(async () => ({ windows: inventory }));
    const platform = fakePlatform({ listWindows });

    await capturePatch(platform, ['selection'], { exclusions: NOTHING_EXCLUDED });

    expect(listWindows).not.toHaveBeenCalled();
  });

  it('hands the exclusion list down, so blocked windows are marked at the source', async () => {
    const listWindows = vi.fn(async () => ({ windows: inventory }));
    const platform = fakePlatform({ listWindows });

    await capturePatch(platform, ['windows'], { exclusions: PASSWORD_MANAGER });

    expect(listWindows).toHaveBeenCalledWith(PASSWORD_MANAGER);
  });

  it('leaves windows out of the patch when the enumeration fails', async () => {
    // Perception is best effort. A helper that will not run costs the inventory, not the
    // ask behind it.
    const platform = fakePlatform({
      listWindows: async () => {
        throw new Error('powershell is not available');
      },
    });

    const { patch } = await capturePatch(platform, ['windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch).not.toHaveProperty('windows');
  });

  it('omits an empty inventory rather than claiming the desktop is empty', async () => {
    const platform = fakePlatform({ listWindows: async () => ({ windows: [] }) });

    const { patch } = await capturePatch(platform, ['windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch).not.toHaveProperty('windows');
  });
});

describe('DESKTOP_CAPABILITIES', () => {
  it('advertises that this host can enumerate and photograph every display', () => {
    expect(DESKTOP_CAPABILITIES).toContain('displays');
  });

  it('advertises the text layer, now that perception.readText is answered', () => {
    // Task 3 asserted the opposite, deliberately: advertising a capability the host
    // cannot honour makes the engine call a method that fails, which reads to the user as
    // a broken pet rather than a missing feature. The claim only became true here, when
    // the read landed, so the assertion flips here and nowhere earlier.
    expect(DESKTOP_CAPABILITIES).toContain('textLayer');
  });
});

describe('a failed window enumeration', () => {
  it('complains rather than passing off an empty desktop as the truth', async () => {
    // The whole reason this exists. A broken helper and a quiet desktop both produced an
    // empty list, so a completely non-functional enumeration shipped through a task, a
    // review and a green CI run without one line of output anywhere saying so.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const platform = fakePlatform({
      listWindows: async () => ({ windows: [], failure: 'no-output' as const }),
    });

    const { patch, warnings } = await capturePatch(platform, ['windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch.windows).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/window list|enumerat/i);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps omitting the inventory from the snapshot, so the pet is not told a lie', async () => {
    // The judgement call from task 3 stands: an empty list must not reach the prompt as
    // "no windows are open". What changes is that the omission now comes with a
    // complaint instead of silence.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const platform = fakePlatform({
      listWindows: async () => ({ windows: [], failure: 'no-windows' as const }),
    });

    const { patch } = await capturePatch(platform, ['windows'], { exclusions: NOTHING_EXCLUDED });

    expect(patch.windows).toBeUndefined();
    warn.mockRestore();
  });

  it('says nothing when the enumeration worked', async () => {
    const platform = fakePlatform({
      listWindows: async () => ({
        windows: [
          {
            id: 'w-1',
            processName: 'Code.exe',
            title: 'a',
            state: 'background' as const,
            browser: false,
          },
        ],
      }),
    });

    const { patch, warnings } = await capturePatch(platform, ['windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch.windows).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});
