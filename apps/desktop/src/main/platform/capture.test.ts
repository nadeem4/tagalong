import { describe, expect, it } from 'vitest';
import { captureActiveWindowImageWith } from './capture';
import type { CaptureImagePort, CaptureSource, WindowCaptureDeps } from './capture';
import type { ActiveWindowInfo } from './index';

const BOUND = 1568;

const ACTIVE: ActiveWindowInfo = {
  appName: 'Code',
  title: 'capture.ts - ai_pet',
  bounds: { x: 0, y: 0, width: 3840, height: 2160 },
};

/**
 * Stands in for Electron's NativeImage. It records the resize it was asked for so a test
 * can assert the downscale reached the image and not only the returned dimensions.
 */
function fakeImage(width: number, height: number, bytes = 'png'): CaptureImagePort {
  return {
    isEmpty: () => width === 0 && height === 0,
    getSize: () => ({ width, height }),
    resize: (size) => fakeImage(size.width, size.height, `${bytes}@${size.width}x${size.height}`),
    toPNG: () => Buffer.from(bytes),
  };
}

function source(name: string, image: CaptureImagePort, displayId = ''): CaptureSource {
  return { name, display_id: displayId, thumbnail: image };
}

interface Recorded {
  types: string[];
  thumbnailSize: { width: number; height: number };
}

function deps(
  sources: { window?: CaptureSource[]; screen?: CaptureSource[] },
  overrides: { active?: ActiveWindowInfo | null; displayId?: number } = {},
): WindowCaptureDeps & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    getActiveWindow: async () => (overrides.active === undefined ? ACTIVE : overrides.active),
    screen: { getDisplayMatching: () => ({ id: overrides.displayId ?? 1 }) },
    desktopCapturer: {
      async getSources(options) {
        calls.push({ types: [...options.types], thumbnailSize: options.thumbnailSize });
        return options.types.includes('window') ? (sources.window ?? []) : (sources.screen ?? []);
      },
    },
  };
}

describe('captureActiveWindowImageWith', () => {
  it('returns PNG base64 and dimensions for the window matching the active title', async () => {
    const d = deps({
      window: [
        source('Some other window', fakeImage(800, 600)),
        source(ACTIVE.title, fakeImage(3840, 2160)),
      ],
    });

    const captured = await captureActiveWindowImageWith(d, BOUND);

    expect(captured).toEqual({
      base64: Buffer.from('png@1568x882').toString('base64'),
      width: 1568,
      height: 882,
    });
  });

  it('asks the capturer for a thumbnail already inside the bound', async () => {
    // A 4K window handed back at full size is 33 MB of bitmap we would immediately throw
    // away, so the bound is pushed down into the request rather than applied after it.
    const d = deps({ window: [source(ACTIVE.title, fakeImage(1568, 882))] });

    await captureActiveWindowImageWith(d, BOUND);

    expect(d.calls[0]).toEqual({ types: ['window'], thumbnailSize: { width: 1568, height: 882 } });
  });

  it('leaves an image that is already within the bound untouched', async () => {
    const d = deps({ window: [source(ACTIVE.title, fakeImage(1280, 720))] });

    const captured = await captureActiveWindowImageWith(d, BOUND);

    expect(captured).toEqual({
      base64: Buffer.from('png').toString('base64'),
      width: 1280,
      height: 720,
    });
  });

  it('falls back to the display holding the active window when no window source matches', async () => {
    const d = deps(
      {
        window: [source('A window belonging to someone else', fakeImage(800, 600))],
        screen: [
          source('Screen 1', fakeImage(1920, 1080), '9'),
          source('Screen 2', fakeImage(1920, 1080), '7'),
        ],
      },
      { displayId: 7 },
    );

    const captured = await captureActiveWindowImageWith(d, BOUND);

    expect(captured?.width).toBe(1568);
    expect(d.calls.map((call) => call.types)).toEqual([['window'], ['screen']]);
  });

  it('ignores a window source whose thumbnail came back empty', async () => {
    // Electron hands back an empty thumbnail for windows it is not allowed to read; using
    // it would attach a blank image to the ask instead of admitting capture failed.
    const d = deps({
      window: [source(ACTIVE.title, fakeImage(0, 0))],
      screen: [source('Screen 1', fakeImage(1920, 1080), '1')],
    });

    const captured = await captureActiveWindowImageWith(d, BOUND);

    expect(captured?.width).toBe(1568);
  });

  it('falls back to a screen when Windows reports no active window at all', async () => {
    // GetForegroundWindow answers with nothing more often than it sounds: a locked or
    // disconnected session, a UAC prompt on the secure desktop, a full-screen exclusive
    // game. Returning null there left the pet permanently blind on machines where the
    // call never succeeds, which the user meets as "the app is broken". The exclusion
    // rules already decided that an unidentifiable window is allowed to be captured
    // (see findCaptureBlock), so bailing out here contradicted the policy above it.
    const d = deps({ screen: [source('Screen 1', fakeImage(1920, 1080), '1')] }, { active: null });

    const captured = await captureActiveWindowImageWith(d, BOUND);

    expect(captured?.width).toBe(1568);
    // Only the screens are asked for: with no window to match by title, enumerating every
    // window on the desktop would decode bitmaps nobody is going to look at.
    expect(d.calls.map((call) => call.types)).toEqual([['screen']]);
    expect(d.calls[0]?.thumbnailSize).toEqual({ width: BOUND, height: BOUND });
  });

  it('returns null when there is no active window and nothing capturable either', async () => {
    expect(await captureActiveWindowImageWith(deps({}, { active: null }), BOUND)).toBeNull();
  });

  it('returns null when neither the window nor the display could be captured', async () => {
    expect(await captureActiveWindowImageWith(deps({ window: [], screen: [] }), BOUND)).toBeNull();
  });
});
