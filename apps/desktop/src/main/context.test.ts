import { describe, expect, it, vi } from 'vitest';
import { ContextSnapshot } from '@tagalong/protocol';
import type { CaptureExclusions } from '@tagalong/protocol';
import { MAX_SCREENSHOT_LONG_SIDE, captureAskSnapshot, capturePatch } from './context';
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
