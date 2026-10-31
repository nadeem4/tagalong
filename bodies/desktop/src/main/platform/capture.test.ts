/** Tests for the screenshot of one listed window, found by its handle. */

import { describe, expect, it } from 'vitest';
import { captureWindowImageWith } from './capture';
import type { CaptureImagePort, CaptureSource, WindowCaptureDeps } from './capture';

const BOUND = 1568;

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

function deps(sources: { window?: CaptureSource[] }): WindowCaptureDeps {
  return {
    desktopCapturer: {
      async getSources() {
        return sources.window ?? [];
      },
    },
  };
}

describe('captureWindowImageWith', () => {
  const withId = (id: string, image: CaptureImagePort): CaptureSource => ({
    ...source('a window', image),
    id,
  });

  it('photographs the window with that handle, even one behind others', async () => {
    const d = deps({
      window: [
        withId('window:111:0', fakeImage(800, 600, 'front')),
        withId('window:222:0', fakeImage(3840, 2160, 'behind')),
      ],
    });

    const captured = await captureWindowImageWith(d, 222, BOUND);

    expect(captured).toEqual({
      base64: Buffer.from('behind@1568x882').toString('base64'),
      width: 1568,
      height: 882,
    });
  });

  it('does not mistake a handle that merely starts the same', async () => {
    const d = deps({ window: [withId('window:2220:0', fakeImage(800, 600))] });
    expect(await captureWindowImageWith(d, 222, BOUND)).toBeNull();
  });

  it('returns nothing for a window Windows cannot draw, such as a minimized one', async () => {
    const d = deps({ window: [withId('window:222:0', fakeImage(0, 0))] });
    expect(await captureWindowImageWith(d, 222, BOUND)).toBeNull();
  });
});
