import { describe, expect, it, vi } from 'vitest';
import { Settings } from '@tagalong/protocol';
import type { CaptureExclusions } from '@tagalong/protocol';
import type { Platform } from './platform/index';
import { gateSight } from './platform/sight-gate';
import { captureForAsk, lookFor, rollingMemoryFor } from './sight-mode';

function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    getActiveWindow: async () => ({
      appName: 'Code.exe',
      title: 'notes.md',
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
    }),
    captureSelection: async () => null,
    readClipboard: async () => '',
    captureActiveWindowImage: async () => ({ base64: 'cG5n', width: 1280, height: 800 }),
    captureDisplays: async () => ({ displays: [], composite: null }),
    captureRegion: async () => null,
    readWindowText: async () => ({ windowId: '', text: '', truncated: false, source: 'uia' }),
    listWindows: async () => ({ windows: [] }),
    ...overrides,
  };
}

const NOTHING_EXCLUDED: CaptureExclusions = { processNames: [], titlePatterns: [] };

describe('lookFor', () => {
  it('changes nothing when sight is when-asked', () => {
    expect(lookFor('when-asked', { screenshot: false })).toEqual({ screenshot: false });
    expect(lookFor('when-asked', { screenshot: true })).toEqual({ screenshot: true });
  });

  it('turns every plain ask into a look when sight is always', () => {
    expect(lookFor('always', { screenshot: false })).toEqual({ screenshot: true });
  });

  it('leaves a see-everything capture as it is', () => {
    expect(lookFor('always', { screenshot: false, fullView: true })).toEqual({
      screenshot: false,
      fullView: true,
    });
  });
});

describe('rollingMemoryFor', () => {
  it('follows the rolling memory setting when sight is when-asked', () => {
    expect(rollingMemoryFor(Settings.parse({}))).toEqual({ enabled: false, minutes: 10 });
    expect(
      rollingMemoryFor(Settings.parse({ rollingMemory: { enabled: true, minutes: 4 } })),
    ).toEqual({ enabled: true, minutes: 4 });
  });

  it('keeps rolling memory running when sight is always', () => {
    expect(rollingMemoryFor(Settings.parse({ sight: 'always' }))).toEqual({
      enabled: true,
      minutes: 10,
    });
  });
});

describe('captureForAsk', () => {
  it('attaches no picture to a plain ask when sight is when-asked', async () => {
    const shoot = vi.fn(async () => ({ base64: 'cG5n', width: 10, height: 10 }));
    const capture = await captureForAsk(
      fakePlatform({ captureActiveWindowImage: shoot }),
      'when-asked',
      { screenshot: false },
      NOTHING_EXCLUDED,
    );
    expect(shoot).not.toHaveBeenCalled();
    expect(capture.snapshot.screenshot).toBeUndefined();
  });

  it('attaches the active window to a plain ask when sight is always', async () => {
    const capture = await captureForAsk(
      fakePlatform(),
      'always',
      { screenshot: false },
      NOTHING_EXCLUDED,
    );
    expect(capture.snapshot.screenshot?.base64).toBe('cG5n');
  });

  it('still refuses an excluded window when sight is always', async () => {
    const shoot = vi.fn(async () => ({ base64: 'cG5n', width: 10, height: 10 }));
    const capture = await captureForAsk(
      fakePlatform({ captureActiveWindowImage: shoot }),
      'always',
      { screenshot: false },
      { processNames: ['Code.exe'], titlePatterns: [] },
    );
    expect(shoot).not.toHaveBeenCalled();
    expect(capture.snapshot.screenshot).toBeUndefined();
    expect(capture.blocked?.entry).toBe('Code.exe');
  });

  it('still reads nothing while sight is paused when sight is always', async () => {
    const shoot = vi.fn(async () => ({ base64: 'cG5n', width: 10, height: 10 }));
    const capture = await captureForAsk(
      gateSight(fakePlatform({ captureActiveWindowImage: shoot }), () => true),
      'always',
      { screenshot: false },
      NOTHING_EXCLUDED,
    );
    expect(shoot).not.toHaveBeenCalled();
    expect(capture.paused).toBe(true);
    expect(capture.snapshot.screenshot).toBeUndefined();
  });
});
