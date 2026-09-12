import { describe, expect, it } from 'vitest';
import { ContextSnapshot } from '@tagalong/protocol';
import { captureAskSnapshot, capturePatch } from './context';
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
    captureActiveWindowImage: async () => null,
    ...overrides,
  };
}

describe('captureAskSnapshot', () => {
  it('produces a snapshot the protocol accepts', async () => {
    const snapshot = await captureAskSnapshot(fakePlatform());

    expect(ContextSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.host).toBe('desktop');
    expect(snapshot.selection).toBe('the highlighted paragraph');
    expect(snapshot.app).toEqual({ name: 'Code.exe', windowTitle: 'selection.ts — tagalong' });
  });

  it('omits the fields the platform could not read rather than sending empty ones', async () => {
    const snapshot = await captureAskSnapshot(
      fakePlatform({ captureSelection: async () => null, getActiveWindow: async () => null }),
    );

    expect(snapshot.selection).toBeUndefined();
    expect(snapshot.app).toBeUndefined();
    expect(ContextSnapshot.safeParse(snapshot).success).toBe(true);
  });

  it('still returns a snapshot when perception throws', async () => {
    const snapshot = await captureAskSnapshot(
      fakePlatform({
        captureSelection: async () => {
          throw new Error('the foreground window refused the copy');
        },
      }),
    );

    expect(snapshot.selection).toBeUndefined();
    expect(snapshot.app?.name).toBe('Code.exe');
  });
});

describe('capturePatch', () => {
  it('reads only what the engine asked for', async () => {
    const patch = await capturePatch(fakePlatform(), ['clipboard']);

    expect(patch).toEqual({ clipboard: 'clipboard contents' });
  });

  it('leaves out targets this host cannot perceive', async () => {
    const patch = await capturePatch(fakePlatform(), ['pageText', 'screenshot']);

    expect(patch).toEqual({});
  });
});
