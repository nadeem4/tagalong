import { describe, expect, it, vi } from 'vitest';
import type { CaptureExclusions } from '@tagalong/protocol';
import { createCanvas } from '../platform/canvas';
import type { Bitmap } from '../platform/canvas';
import type { DisplaysCapture } from '../platform/displays';
import type { ActiveWindowInfo } from '../platform/index';
import { FakeClock } from './fake-clock';
import { PerceptionMemory, SCRATCH_IDLE_MS } from './perception-memory';
import type { ImageCodec, PerceptionMemoryPlatform } from './perception-memory';
import { RollingMemory } from './rolling-memory';

const EXCLUSIONS: CaptureExclusions = { processNames: ['KeePass.exe'], titlePatterns: [] };
const GREY = { r: 40, g: 40, b: 40, a: 255 };

/** Encodes a bitmap as its own bytes plus a size header, so tests need no PNG library. */
const codec: ImageCodec = {
  encode: (bitmap) =>
    Buffer.concat([Buffer.from(`${bitmap.width}x${bitmap.height}:`), bitmap.data]),
  decode: (png) => {
    const colon = png.indexOf(':');
    const [width, height] = png.subarray(0, colon).toString().split('x').map(Number);
    return { width: width!, height: height!, data: Buffer.from(png.subarray(colon + 1)) };
  },
};

function paint(bitmap: Bitmap, x: number, y: number, width: number, height: number): Bitmap {
  const copy = { ...bitmap, data: Buffer.from(bitmap.data) };
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      copy.data.fill(255, (row * copy.width + column) * 4, (row * copy.width + column) * 4 + 3);
    }
  }
  return copy;
}

function setup(options: { active?: ActiveWindowInfo | null } = {}) {
  const clock = new FakeClock(1_000_000);
  // Display 1 is 1280x720 physical pixels, captured at 64x36 so tests stay small.
  let screen = createCanvas(64, 36, GREY);
  const state = { active: options.active ?? null };
  const platform: PerceptionMemoryPlatform = {
    getActiveWindow: vi.fn(() => Promise.resolve(state.active)),
    captureDisplays: vi.fn((): Promise<DisplaysCapture> =>
      Promise.resolve({
        displays: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1280, height: 720 },
            scaleFactor: 1,
            primary: true,
            focused: true,
            blocked: null,
            image: {
              base64: codec.encode(screen).toString('base64'),
              width: screen.width,
              height: screen.height,
            },
          },
        ],
        composite: null,
      }),
    ),
    listWindows: vi.fn(() => Promise.resolve({ windows: [] })),
    captureRegion: vi.fn((params: { rect: { width: number; height: number } }) =>
      Promise.resolve({ base64: 'bmF0aXZl', width: params.rect.width, height: params.rect.height }),
    ),
  };
  const rolling = new RollingMemory({
    platform,
    clock,
    exclusions: () => EXCLUSIONS,
    isPaused: () => false,
  });
  const memory = new PerceptionMemory({
    rolling,
    platform,
    codec,
    clock,
    exclusions: () => EXCLUSIONS,
  });
  return {
    clock,
    platform,
    rolling,
    memory,
    state,
    setScreen: (next: Bitmap) => {
      screen = next;
    },
    screen: () => screen,
  };
}

describe('perception.recall', () => {
  it('says it is not recording and returns nothing while rolling memory is off', async () => {
    const { memory } = setup();
    const result = await memory.recall({ secondsAgo: 300 });
    expect(result).toEqual({ recording: false, frames: [], windows: [] });
  });

  it('returns the frame nearest the moment asked about, with its timestamp', async () => {
    const { clock, rolling, memory } = setup();
    rolling.configure({ enabled: true, minutes: 10 });
    await clock.advance(10 * 60_000);

    const result = await memory.recall({ secondsAgo: 300 });
    expect(result.recording).toBe(true);
    expect(result.capturedAt).toBe(new Date(1_000_000 + 5 * 60_000).toISOString());
    expect(result.oldestAt).toBe(new Date(1_000_000 + 5_000).toISOString());
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.capturedAt).toBe(result.capturedAt);
    expect(result.frames[0]?.image.mime).toBe('image/png');
  });

  it('reaches no further back than the buffer: after a restart there is nothing older', async () => {
    const { clock, rolling, memory } = setup();
    rolling.configure({ enabled: true, minutes: 10 });
    await clock.advance(20_000);
    const result = await memory.recall({ secondsAgo: 600 });
    expect(result.oldestAt).toBe(result.capturedAt);
    expect(result.capturedAt).toBe(new Date(1_000_000 + 5_000).toISOString());
  });
});

describe('perception.diff', () => {
  it('reports no change, and no before, the first time a display is asked about', async () => {
    const { memory } = setup();
    const result = await memory.diff({ displayId: 1, sinceSeconds: 5 });
    expect(result.changeRatio).toBe(0);
    expect(result.beforeAt).toBeUndefined();
  });

  it('compares now with the frame from before, even with rolling memory off', async () => {
    const { clock, memory, setScreen, screen } = setup();
    await memory.diff({ displayId: 1, sinceSeconds: 5, includeImages: false });
    await clock.advance(5_000);
    setScreen(paint(screen(), 0, 0, 32, 18));

    const result = await memory.diff({ displayId: 1, sinceSeconds: 5, includeImages: false });
    expect(result.changeRatio).toBeCloseTo(0.25, 5);
    expect(result.beforeAt).toBe(new Date(1_000_000).toISOString());
    // The box comes back in the display's own pixels: 20x scale from the 64-pixel frame.
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    expect(result.before).toBeUndefined();
    expect(result.after).toBeUndefined();
  });

  it('measures a region as a share of that region', async () => {
    const { clock, memory, setScreen, screen } = setup();
    await memory.diff({ displayId: 1, sinceSeconds: 5 });
    await clock.advance(5_000);
    setScreen(paint(screen(), 0, 0, 32, 18));
    const rect = { x: 0, y: 0, width: 640, height: 720 };
    const result = await memory.diff({ displayId: 1, sinceSeconds: 5, rect });
    expect(result.changeRatio).toBeCloseTo(0.5, 5);
  });

  it('returns the before crop from memory and the after crop at native resolution', async () => {
    const { clock, memory, platform, setScreen, screen } = setup();
    await memory.diff({ displayId: 1, sinceSeconds: 5 });
    await clock.advance(5_000);
    setScreen(paint(screen(), 10, 10, 4, 2));

    const result = await memory.diff({ displayId: 1, sinceSeconds: 5 });
    expect(result.before?.width).toBe(4);
    expect(result.after?.base64).toBe('bmF0aXZl');
    expect(platform.captureRegion).toHaveBeenCalledWith(
      expect.objectContaining({ displayId: 1, rect: { x: 200, y: 200, width: 80, height: 40 } }),
      // The crop gets the exclusions, so it refuses a blocked display like any capture.
      { processNames: ['KeePass.exe'], titlePatterns: [] },
    );
  });

  it('compares against the frame nearest the time asked, not just the last one', async () => {
    const { clock, memory, setScreen, screen } = setup();
    await memory.diff({ displayId: 1, sinceSeconds: 5, includeImages: false });
    await clock.advance(5_000);
    setScreen(paint(screen(), 0, 0, 64, 36));
    await memory.diff({ displayId: 1, sinceSeconds: 5, includeImages: false });
    await clock.advance(5_000);

    // Against five seconds ago nothing moved; against ten seconds ago, everything did.
    expect((await memory.diff({ displayId: 1, sinceSeconds: 5 })).changeRatio).toBe(0);
    expect((await memory.diff({ displayId: 1, sinceSeconds: 10 })).changeRatio).toBe(1);
  });

  it('reuses a capture taken within the last second rather than taking another', async () => {
    const { memory, platform } = setup();
    await memory.diff({ displayId: 1, sinceSeconds: 5 });
    await memory.diff({ displayId: 1, sinceSeconds: 60 });
    expect(platform.captureDisplays).toHaveBeenCalledTimes(1);
  });

  it('refuses while an excluded app has focus, before taking a picture', async () => {
    const { memory, platform } = setup({
      active: { appName: 'KeePass.exe', title: 'v', bounds: { x: 0, y: 0, width: 1, height: 1 } },
    });
    await expect(memory.diff({ displayId: 1, sinceSeconds: 5 })).rejects.toThrow(/KeePass/);
    expect(platform.captureDisplays).not.toHaveBeenCalled();
  });

  it('refuses a display that does not exist', async () => {
    const { memory } = setup();
    await expect(memory.diff({ displayId: 9, sinceSeconds: 5 })).rejects.toThrow(/no display 9/);
  });

  it('drops a display it has not been asked about for a while, and on clear', async () => {
    const { clock, memory } = setup();
    await memory.diff({ displayId: 1, sinceSeconds: 5 });
    expect(memory.scratchFrames).toBe(1);
    await clock.advance(SCRATCH_IDLE_MS + 1_000);
    await memory.diff({ displayId: 1, sinceSeconds: 5 });
    // The idle display was forgotten, so this is a first look again.
    expect(memory.scratchFrames).toBe(1);
    memory.clear();
    expect(memory.scratchFrames).toBe(0);
  });
});
