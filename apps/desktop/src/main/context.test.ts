import { describe, expect, it, vi } from 'vitest';
import { basename } from 'node:path';
import { ContextSnapshot } from '@tagalong/protocol';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import {
  DESKTOP_CAPABILITIES,
  MAX_SCREENSHOT_LONG_SIDE,
  answerCapture,
  captureAskSnapshot,
  capturePatch,
} from './context';
import type { DisplaysCapture, Platform } from './platform/index';
import { gateSight } from './platform/sight-gate';

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
    // Phase 2B. Nothing in this file crops; the stub returns null so a test reaching it
    // by accident fails on a missing crop rather than on a missing method.
    captureRegion: async () => null,
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

    expect(captureActiveWindowImage).toHaveBeenCalledWith(
      MAX_SCREENSHOT_LONG_SIDE,
      NOTHING_EXCLUDED,
    );
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
      screenshot: false,
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
      screenshot: true,
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked).toEqual({ rule: 'titlePattern', entry: '*Vault*' });
    expect(snapshot.app).toEqual({ name: 'chrome.exe', blocked });
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

  it('looks past its own windows to the one the person was using', async () => {
    // Scout's bubble has the focus while the person types to it, so "the window in front"
    // is Scout itself. The next window down is the one they mean.
    const own = basename(process.execPath);
    const captureActiveWindowImage = vi.fn(async () => ({
      base64: 'c2VsZg==',
      width: 8,
      height: 8,
    }));
    const lookAtWindow = vi.fn(async () => ({
      windowId: 'w-2',
      image: { mime: 'image/png' as const, base64: 'ZWRpdG9y', width: 800, height: 600 },
    }));
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
      captureActiveWindowImage,
      lookAtWindow,
      getActiveWindow: async () => ({
        appName: own,
        title: 'Tagalong',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
      }),
      listWindows: async () => ({ windows }),
    });

    const { patch } = await capturePatch(platform, ['activeWindow', 'screenshot'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(captureActiveWindowImage).not.toHaveBeenCalled();
    expect(lookAtWindow).toHaveBeenCalledWith(
      { windowId: 'w-2', maxLongSide: expect.any(Number) },
      NOTHING_EXCLUDED,
    );
    expect(patch.app).toEqual({ name: 'Code.exe', windowTitle: 'engine.ts - ai_pet' });
    expect(patch.screenshot?.base64).toBe('ZWRpdG9y');
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

    const { patch, blocked } = await capturePatch(platform, ['screenshot', 'activeWindow'], {
      exclusions: PASSWORD_MANAGER,
    });

    expect(captureActiveWindowImage).not.toHaveBeenCalled();
    expect(patch.screenshot).toBeUndefined();
    expect(blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
    expect(patch.app).toEqual({ name: '1Password.exe', blocked });
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

  it('advertises recall, now that perception.recall and perception.diff are answered', () => {
    expect(DESKTOP_CAPABILITIES).toContain('recall');
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

// ---------------------------------------------------------------------------
// Phase 2B: the see-everything capture
// ---------------------------------------------------------------------------

const PNG = { base64: 'aGk=', width: 1568, height: 882 };

function displayCapture(overrides: Partial<DisplaysCapture> = {}): DisplaysCapture {
  return {
    composite: PNG,
    displays: [
      {
        id: 101,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
        primary: true,
        focused: true,
        blocked: null,
        image: PNG,
      },
      {
        id: 102,
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
        primary: false,
        focused: false,
        blocked: null,
        image: PNG,
      },
    ],
    ...overrides,
  };
}

const ONE_WINDOW = [
  {
    id: 'w-1',
    processName: 'Code.exe',
    title: 'context.ts',
    state: 'background' as const,
    browser: false,
    displayId: 102,
  },
];

describe('captureAskSnapshot, full view', () => {
  it('carries every display, the composite and the window inventory', async () => {
    const platform = fakePlatform({
      captureDisplays: async () => displayCapture(),
      listWindows: async () => ({ windows: ONE_WINDOW }),
    });

    const { snapshot } = await captureAskSnapshot(platform, {
      screenshot: false,
      fullView: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(snapshot.displays).toHaveLength(2);
    expect(snapshot.composite?.mime).toBe('image/png');
    expect(snapshot.windows).toHaveLength(1);
  });

  it('does not reach for displays or windows on the cheap ask', async () => {
    // Ctrl+Shift+Space must stay cheap. Enumerating windows costs seconds, and a
    // capture that quietly does it on every ask is the paper cut that makes the fast
    // path stop feeling fast.
    const captureDisplays = vi.fn();
    const listWindows = vi.fn();
    const platform = fakePlatform({ captureDisplays, listWindows });

    await captureAskSnapshot(platform, { screenshot: false, exclusions: NOTHING_EXCLUDED });

    expect(captureDisplays).not.toHaveBeenCalled();
    expect(listWindows).not.toHaveBeenCalled();
  });

  it('reports the exclusion that blanked the focused display', async () => {
    // The capture notice says why the pet cannot see. A full-view capture that blanks
    // the screen the user is on has to announce it, or the refusal is invisible.
    const platform = fakePlatform({
      captureDisplays: async () =>
        displayCapture({
          displays: [
            {
              id: 101,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              scaleFactor: 1,
              primary: true,
              focused: true,
              blocked: { rule: 'processName', entry: '1Password.exe' },
              image: PNG,
            },
          ],
        }),
      listWindows: async () => ({ windows: [] }),
    });

    const { blocked } = await captureAskSnapshot(platform, {
      screenshot: false,
      fullView: true,
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
  });

  it('still produces a snapshot when the displays cannot be captured at all', async () => {
    // Perception is best effort everywhere else; a thrown capturer must not cost the
    // user the selection they highlighted before pressing the key.
    const platform = fakePlatform({
      captureDisplays: async () => {
        throw new Error('desktopCapturer unavailable');
      },
      listWindows: async () => ({ windows: ONE_WINDOW }),
    });

    const { snapshot } = await captureAskSnapshot(platform, {
      screenshot: false,
      fullView: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(snapshot.displays).toBeUndefined();
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.selection).toBe('the highlighted paragraph');
  });

  it('omits an inventory that failed rather than passing off nothing as an empty desktop', async () => {
    const platform = fakePlatform({
      captureDisplays: async () => displayCapture(),
      listWindows: async () => ({ windows: [], failure: 'no-output' as const }),
    });

    const { snapshot } = await captureAskSnapshot(platform, {
      screenshot: false,
      fullView: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(snapshot.windows).toBeUndefined();
  });

  it('drops a display image the capturer could not produce', async () => {
    const platform = fakePlatform({
      captureDisplays: async () =>
        displayCapture({
          displays: [
            {
              id: 101,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              scaleFactor: 1,
              primary: true,
              focused: true,
              blocked: null,
              image: null,
            },
          ],
        }),
      listWindows: async () => ({ windows: [] }),
    });

    const { snapshot } = await captureAskSnapshot(platform, {
      screenshot: false,
      fullView: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(snapshot.displays?.[0]?.image).toBeUndefined();
    expect(snapshot.displays?.[0]?.id).toBe(101);
  });
});

describe('capturePatch, displays', () => {
  it('answers the displays target the host advertises a capability for', async () => {
    // DESKTOP_CAPABILITIES names `displays`, so the engine is entitled to ask for it.
    // A host that advertises a capability and then ignores the target makes the engine
    // call something that silently returns nothing, which reads as a broken pet.
    const platform = fakePlatform({
      captureDisplays: async () => displayCapture(),
      listWindows: async () => ({ windows: [] }),
    });

    const { patch } = await capturePatch(platform, ['displays'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch.displays).toHaveLength(2);
    expect(patch.composite?.mime).toBe('image/png');
  });

  it('does not capture displays for a target that did not ask for them', async () => {
    const captureDisplays = vi.fn();
    await capturePatch(fakePlatform({ captureDisplays }), ['selection'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(captureDisplays).not.toHaveBeenCalled();
  });

  it('reports the refusal when the focused display is blanked', async () => {
    const platform = fakePlatform({
      captureDisplays: async () =>
        displayCapture({
          displays: [
            {
              id: 101,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              scaleFactor: 1,
              primary: true,
              focused: true,
              blocked: { rule: 'processName', entry: '1Password.exe' },
              image: PNG,
            },
          ],
        }),
    });

    const { blocked } = await capturePatch(platform, ['displays'], {
      exclusions: PASSWORD_MANAGER,
    });

    expect(blocked?.entry).toBe('1Password.exe');
  });

  it('warns rather than staying quiet when the displays cannot be read', async () => {
    const platform = fakePlatform({
      captureDisplays: async () => {
        throw new Error('desktopCapturer unavailable');
      },
    });

    const { patch, warnings } = await capturePatch(platform, ['displays'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(patch.displays).toBeUndefined();
    expect(warnings.join(' ')).toContain('displays');
  });
});

// ---------------------------------------------------------------------------
// Phase 2B task 8: sight paused
// ---------------------------------------------------------------------------

/** A platform gated by a pause that is already on, exactly as the host builds it. */
function pausedPlatform(overrides: Partial<Platform> = {}): Platform {
  return gateSight(fakePlatform(overrides), () => true);
}

describe('captureAskSnapshot while sight is paused', () => {
  it('reports the capture as paused rather than as merely empty', async () => {
    // The distinction is the whole point. Four reads in this phase failed by returning
    // nothing, and nothing is what an unproductive capture also looks like.
    const capture = await captureAskSnapshot(pausedPlatform(), {
      screenshot: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.paused).toBe(true);
  });

  it('carries no screenshot, no app and no displays', async () => {
    const capture = await captureAskSnapshot(pausedPlatform(), {
      screenshot: true,
      fullView: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.snapshot.screenshot).toBeUndefined();
    expect(capture.snapshot.app).toBeUndefined();
    expect(capture.snapshot.displays).toBeUndefined();
    expect(capture.snapshot.composite).toBeUndefined();
    expect(capture.snapshot.windows).toBeUndefined();
  });

  it('still carries the selection the user highlighted', async () => {
    // Pausing sight blinds the pet. It does not refuse what the user hands over, or a
    // paused pet would be useless rather than merely blind.
    const capture = await captureAskSnapshot(pausedPlatform(), {
      screenshot: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.snapshot.selection).toBe('the highlighted paragraph');
  });

  it('is not reported as blocked, which means something else entirely', async () => {
    // "You turned sight off" and "this app is on your exclusion list" are different
    // facts, and the pet must not say the second when the first is true.
    const capture = await captureAskSnapshot(pausedPlatform(), {
      screenshot: true,
      exclusions: PASSWORD_MANAGER,
    });

    expect(capture.paused).toBe(true);
    expect(capture.blocked).toBeNull();
  });

  it('reports not paused on an ordinary capture', async () => {
    const capture = await captureAskSnapshot(fakePlatform(), {
      screenshot: true,
      exclusions: NOTHING_EXCLUDED,
    });

    expect(capture.paused).toBe(false);
  });
});

describe('capturePatch while sight is paused', () => {
  it('reports paused and returns none of the gated targets', async () => {
    const result = await capturePatch(pausedPlatform(), ['screenshot', 'displays', 'windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(result.paused).toBe(true);
    expect(result.patch.screenshot).toBeUndefined();
    expect(result.patch.displays).toBeUndefined();
    expect(result.patch.windows).toBeUndefined();
  });

  it('answers a paused screenshot with the pause, like every other screen tool', async () => {
    const result = await capturePatch(pausedPlatform(), ['screenshot'], {
      exclusions: NOTHING_EXCLUDED,
    });
    expect(() => answerCapture(['screenshot'], result)).toThrow(/sight is paused/);
  });

  it('still answers an ungated read while paused', async () => {
    const result = await capturePatch(pausedPlatform(), ['selection', 'activeWindow'], {
      exclusions: NOTHING_EXCLUDED,
    });
    expect(answerCapture(['selection', 'activeWindow'], result)).toBe(result.patch);
  });

  it('does not complain that the displays failed, because they did not', async () => {
    // A paused capture is a refusal, not a broken one. Warning about it would train the
    // user to ignore the warnings that mean something is actually wrong.
    const result = await capturePatch(pausedPlatform(), ['displays', 'windows'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(result.warnings).toEqual([]);
  });

  it('still answers the clipboard and the selection', async () => {
    const result = await capturePatch(pausedPlatform(), ['selection', 'clipboard'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(result.paused).toBe(false);
    expect(result.patch.selection).toBe('the highlighted paragraph');
    expect(result.patch.clipboard).toBe('clipboard contents');
  });

  it('reports paused for a mixed request and keeps the ungated half', async () => {
    const result = await capturePatch(pausedPlatform(), ['selection', 'screenshot'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(result.paused).toBe(true);
    expect(result.patch.selection).toBe('the highlighted paragraph');
    expect(result.patch.screenshot).toBeUndefined();
  });

  it('reports not paused on an ordinary capture', async () => {
    const result = await capturePatch(fakePlatform(), ['selection'], {
      exclusions: NOTHING_EXCLUDED,
    });

    expect(result.paused).toBe(false);
  });
});

describe('a real failure is still swallowed while a pause is not', () => {
  it('keeps treating an ordinary capture failure as best effort', async () => {
    // Perception stays best effort: a clipboard the OS briefly locked must not cost the
    // user their ask. Only the pause is promoted out of that.
    const capture = await captureAskSnapshot(
      fakePlatform({
        captureActiveWindowImage: async () => {
          throw new Error('the capturer went away');
        },
      }),
      { screenshot: true, exclusions: NOTHING_EXCLUDED },
    );

    expect(capture.paused).toBe(false);
    expect(capture.snapshot.screenshot).toBeUndefined();
    expect(capture.snapshot.selection).toBe('the highlighted paragraph');
  });
});
