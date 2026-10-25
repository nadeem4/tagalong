/** Tests for the display crop behind look_closer. */

import { describe, expect, it } from 'vitest';

import { captureRegionWith } from './region';
import type { RegionCaptureDeps } from './region';
import type { DisplayImagePort } from './displays';
import type { ActiveWindowInfo } from './index';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';

/** A capturer thumbnail that records how it was cropped and resized. */
function fakeImage(
  width: number,
  height: number,
  log: { crops: unknown[]; resizes: unknown[] },
): DisplayImagePort {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (size) => {
      log.resizes.push(size);
      return fakeImage(size.width, size.height, log);
    },
    crop: (rect: { x: number; y: number; width: number; height: number }) => {
      log.crops.push(rect);
      return fakeImage(rect.width, rect.height, log);
    },
    toPNG: () => Buffer.from(`png:${width}x${height}`),
    toBitmap: () => Buffer.alloc(width * height * 4),
  } as DisplayImagePort;
}

function harness(options: {
  displayWidth?: number;
  displayHeight?: number;
  scaleFactor?: number;
  sourceId?: string;
  windows?: WindowEntry[];
  active?: ActiveWindowInfo | null;
  exclusions?: CaptureExclusions;
}): { deps: RegionCaptureDeps; log: { crops: unknown[]; resizes: unknown[] } } {
  const log = { crops: [] as unknown[], resizes: [] as unknown[] };
  const width = options.displayWidth ?? 3840;
  const height = options.displayHeight ?? 2160;
  return {
    log,
    deps: {
      screen: {
        getAllDisplays: () => [
          {
            id: 1,
            bounds: {
              x: 0,
              y: 0,
              width: width / (options.scaleFactor ?? 1),
              height: height / (options.scaleFactor ?? 1),
            },
            scaleFactor: options.scaleFactor ?? 1,
            primary: true,
          },
        ],
        getDisplayMatching: () => ({ id: 1 }),
      },
      getActiveWindow: () => Promise.resolve(options.active ?? null),
      listWindows: () => Promise.resolve(options.windows ?? []),
      exclusions: options.exclusions ?? { processNames: [], titlePatterns: [] },
      desktopCapturer: {
        getSources: () =>
          Promise.resolve([
            {
              name: 'Screen 1',
              display_id: options.sourceId ?? '1',
              thumbnail: fakeImage(width, height, log),
            },
          ]),
      },
    },
  };
}

describe('captureRegionWith', () => {
  it('crops the rectangle it was asked for', async () => {
    const { deps, log } = harness({});

    const image = await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 100, y: 200, width: 640, height: 480 },
      maxLongSide: 1568,
    });

    expect(log.crops).toEqual([{ x: 100, y: 200, width: 640, height: 480 }]);
    expect(image).not.toBeNull();
  });

  it('asks the capturer for the display at full resolution, not a thumbnail', async () => {
    // The whole point of look_closer is detail. Cropping a 1568px thumbnail of a 4K
    // monitor gives back a blur, which is exactly what the pet was trying to escape.
    let asked: { width: number; height: number } | undefined;
    const { deps } = harness({});
    deps.desktopCapturer.getSources = (options) => {
      asked = options.thumbnailSize;
      return Promise.resolve([
        {
          name: 'Screen 1',
          display_id: '1',
          thumbnail: fakeImage(3840, 2160, { crops: [], resizes: [] }),
        },
      ]);
    };

    await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 640, height: 480 },
      maxLongSide: 1568,
    });

    expect(asked?.width).toBeGreaterThanOrEqual(3840);
  });

  it('clamps a rectangle that runs off the edge of the display', async () => {
    const { deps, log } = harness({ displayWidth: 1920, displayHeight: 1080 });

    await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 1800, y: 1000, width: 400, height: 400 },
      maxLongSide: 1568,
    });

    expect(log.crops).toEqual([{ x: 1800, y: 1000, width: 120, height: 80 }]);
  });

  it('keeps the crop inside the long-side bound', async () => {
    const { deps, log } = harness({});

    const image = await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 3000, height: 2000 },
      maxLongSide: 1568,
    });

    expect(log.resizes).toHaveLength(1);
    expect(Math.max(image?.width ?? 0, image?.height ?? 0)).toBeLessThanOrEqual(1568);
  });

  it('does not resize a crop already inside the bound', async () => {
    const { deps, log } = harness({});

    await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 640, height: 480 },
      maxLongSide: 1568,
    });

    expect(log.resizes).toEqual([]);
  });

  it('returns null for a display the capturer has no source for', async () => {
    const { deps } = harness({ sourceId: '999' });

    const image = await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 640, height: 480 },
      maxLongSide: 1568,
    });

    expect(image).toBeNull();
  });

  it('returns null for a display that is not there', async () => {
    const { deps } = harness({});

    const image = await captureRegionWith(deps, {
      displayId: 404,
      rect: { x: 0, y: 0, width: 640, height: 480 },
      maxLongSide: 1568,
    });

    expect(image).toBeNull();
  });

  it('returns null when the rectangle lies entirely off the display', async () => {
    const { deps } = harness({ displayWidth: 1920, displayHeight: 1080 });

    const image = await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 5000, y: 5000, width: 100, height: 100 },
      maxLongSide: 1568,
    });

    expect(image).toBeNull();
  });

  it('refuses a display that holds a blocked window, focused or not', async () => {
    const { deps, log } = harness({
      windows: [
        {
          id: 'w-9',
          processName: '1Password.exe',
          title: 'Vault',
          state: 'background',
          browser: false,
          displayId: 1,
          blocked: { rule: 'processName', entry: '1Password.exe' },
        },
      ],
    });
    const image = await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      maxLongSide: 1568,
    });
    expect(image).toBeNull();
    expect(log.crops).toEqual([]);
  });

  it('refuses the display whose focused window the person excluded', async () => {
    const { deps, log } = harness({
      active: {
        appName: 'Bank.exe',
        title: 'Statement',
        bounds: { x: 0, y: 0, width: 9, height: 9 },
      },
      exclusions: { processNames: ['Bank.exe'], titlePatterns: [] },
    });
    const image = await captureRegionWith(deps, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      maxLongSide: 1568,
    });
    expect(image).toBeNull();
    expect(log.crops).toEqual([]);
  });
});
