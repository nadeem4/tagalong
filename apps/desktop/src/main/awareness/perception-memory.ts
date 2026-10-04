import { findCaptureBlock } from '@tagalong/core';
import type {
  CaptureExclusions,
  CapturedImage,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
  RecalledFrame,
} from '@tagalong/protocol';
import type { Bitmap } from '../platform/canvas';
import type { Platform } from '../platform/index';
import type { Clock } from './clock';
import { FrameRing } from './frame-ring';
import type { Moment, StoredFrame } from './frame-ring';
import { cropBitmap, diffBitmaps } from './pixel-diff';
import type { PixelRect } from './pixel-diff';
import { FRAME_LONG_SIDE } from './rolling-memory';
import type { RollingMemory } from './rolling-memory';

/** PNG in and out. `nativeImage` in the app; a byte-for-byte fake in tests. */
export interface ImageCodec {
  decode(png: Buffer): Bitmap;
  encode(bitmap: Bitmap): Buffer;
}

export type PerceptionMemoryPlatform = Pick<
  Platform,
  'captureDisplays' | 'listWindows' | 'getActiveWindow' | 'captureRegion'
>;

export interface PerceptionMemoryOptions {
  rolling: RollingMemory;
  platform: PerceptionMemoryPlatform;
  codec: ImageCodec;
  clock: Pick<Clock, 'now'>;
  exclusions: () => CaptureExclusions;
}

/**
 * How long a display's watch frames outlive the last diff that asked about it.
 *
 * A watch polls every five seconds, so thirty seconds of silence means the watch ended —
 * and frames of a screen nobody is watching any more are frames this app should not hold.
 */
export const SCRATCH_IDLE_MS = 30_000;

/** A fresh capture this young answers a second diff too; a watch asks two in a row. */
const FRESH_MS = 1_000;

/** The ceiling on the native-resolution after crop a watch shows its check model. */
const AFTER_CROP_LONG_SIDE = 1024;

interface Scratch {
  ring: FrameRing;
  lastUsed: number;
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

/**
 * Answers `perception.recall` and `perception.diff` for the desktop host.
 *
 * Recall reads rolling memory. Diff takes a fresh 640-pixel frame and compares it with the
 * one nearest `sinceSeconds` ago — from rolling memory when it is on, and otherwise from a
 * small scratch ring kept only for displays a diff asked about. Both rings live in memory.
 */
export class PerceptionMemory {
  readonly #options: PerceptionMemoryOptions;
  readonly #scratch = new Map<number, Scratch>();
  #fresh: Moment | null = null;

  constructor(options: PerceptionMemoryOptions) {
    this.#options = options;
  }

  /** How many frames the watch rings hold, across every display. */
  get scratchFrames(): number {
    let count = 0;
    for (const scratch of this.#scratch.values()) count += scratch.ring.size;
    return count;
  }

  /** On pause and on quit. */
  clear(): void {
    this.#scratch.clear();
    this.#fresh = null;
  }

  recall(params: PerceptionRecallParams): Promise<PerceptionRecallResult> {
    const { rolling, clock } = this.#options;
    const ring = rolling.ring;
    const recording = rolling.recording;
    const oldest = ring.oldest();
    const target = clock.now() - params.secondsAgo * 1000;
    const moment = ring.nearest(target, params.displayId);
    if (moment === undefined) {
      return Promise.resolve({
        recording,
        ...(oldest === undefined ? {} : { oldestAt: iso(oldest.at) }),
        frames: [],
        windows: [],
      });
    }

    const frames: RecalledFrame[] = moment.frames
      .filter((frame) => params.displayId === undefined || frame.displayId === params.displayId)
      .map((frame) => ({
        displayId: frame.displayId,
        capturedAt: iso(moment.at),
        image: {
          mime: 'image/png',
          base64: frame.png.toString('base64'),
          width: frame.width,
          height: frame.height,
        },
      }));

    return Promise.resolve({
      recording,
      ...(oldest === undefined ? {} : { oldestAt: iso(oldest.at) }),
      capturedAt: iso(moment.at),
      frames,
      windows: moment.windows,
      ...(moment.focused === undefined ? {} : { focusedWindow: moment.focused }),
    });
  }

  async diff(params: PerceptionDiffParams): Promise<PerceptionDiffResult> {
    const { clock, codec } = this.#options;
    const now = clock.now();
    this.#prune(now);

    const fresh = await this.#capture(now);
    const after = fresh.frames.find((frame) => frame.displayId === params.displayId);
    if (after === undefined) throw new Error(`no display ${params.displayId} to compare`);
    const scratch = this.#scratchFor(params.displayId, now);
    if (scratch.ring.newest() !== fresh) scratch.ring.push(fresh);

    const target = now - params.sinceSeconds * 1000;
    const beforeMoment = this.#nearestBefore(params.displayId, target, fresh.at);
    const afterAt = iso(fresh.at);
    if (beforeMoment === undefined) return { changeRatio: 0, afterAt };
    const before = beforeMoment.frames.find((frame) => frame.displayId === params.displayId)!;

    const beforeBitmap = codec.decode(before.png);
    const afterBitmap = codec.decode(after.png);
    const scaleX = after.width / after.displayWidth;
    const scaleY = after.height / after.displayHeight;
    const region =
      params.rect === undefined
        ? undefined
        : {
            x: Math.floor(params.rect.x * scaleX),
            y: Math.floor(params.rect.y * scaleY),
            width: Math.max(1, Math.ceil(params.rect.width * scaleX)),
            height: Math.max(1, Math.ceil(params.rect.height * scaleY)),
          };
    const { ratio, box } = diffBitmaps(beforeBitmap, afterBitmap, region);

    const result: PerceptionDiffResult = {
      changeRatio: ratio,
      beforeAt: iso(beforeMoment.at),
      afterAt,
    };
    if (box === undefined) return result;

    const bounds = {
      x: Math.floor(box.x / scaleX),
      y: Math.floor(box.y / scaleY),
      width: Math.max(1, Math.round(box.width / scaleX)),
      height: Math.max(1, Math.round(box.height / scaleY)),
    };
    result.bounds = bounds;
    if (params.includeImages === false) return result;

    if (beforeBitmap.width === afterBitmap.width && beforeBitmap.height === afterBitmap.height) {
      result.before = this.#png(cropBitmap(beforeBitmap, box));
    }
    result.after = await this.#afterCrop(params.displayId, bounds, afterBitmap, box);
    return result;
  }

  /**
   * The after crop at the display's own resolution, so a check model can read a terminal
   * line a 640-pixel frame turns into a smear. Falls back to the frame's own pixels.
   */
  async #afterCrop(
    displayId: number,
    bounds: PixelRect,
    afterBitmap: Bitmap,
    box: PixelRect,
  ): Promise<CapturedImage> {
    try {
      const native = await this.#options.platform.captureRegion({
        displayId,
        rect: bounds,
        maxLongSide: AFTER_CROP_LONG_SIDE,
      });
      if (native !== null) return { mime: 'image/png', ...native };
    } catch {
      // Fall through to the frame's own pixels: a blurry crop beats none.
    }
    return this.#png(cropBitmap(afterBitmap, box));
  }

  #png(bitmap: Bitmap): CapturedImage {
    return {
      mime: 'image/png',
      base64: this.#options.codec.encode(bitmap).toString('base64'),
      width: bitmap.width,
      height: bitmap.height,
    };
  }

  /** The earlier frame nearest `target`, from rolling memory or the watch ring. */
  #nearestBefore(displayId: number, target: number, before: number): Moment | undefined {
    const candidates = [
      this.#options.rolling.ring.nearest(target, displayId, { before }),
      this.#scratch.get(displayId)?.ring.nearest(target, displayId, { before }),
    ].filter((moment): moment is Moment => moment !== undefined);
    return candidates.sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0];
  }

  #scratchFor(displayId: number, now: number): Scratch {
    const windowMs = this.#options.rolling.ring.windowMs;
    let scratch = this.#scratch.get(displayId);
    if (scratch === undefined) {
      scratch = { ring: new FrameRing(windowMs), lastUsed: now };
      this.#scratch.set(displayId, scratch);
    }
    scratch.lastUsed = now;
    if (scratch.ring.windowMs !== windowMs) scratch.ring.setWindow(windowMs);
    return scratch;
  }

  #prune(now: number): void {
    for (const [displayId, scratch] of this.#scratch) {
      if (now - scratch.lastUsed > SCRATCH_IDLE_MS) this.#scratch.delete(displayId);
    }
  }

  /** A frame of every display now, refusing first if an excluded window has focus. */
  async #capture(now: number): Promise<Moment> {
    if (this.#fresh !== null && now - this.#fresh.at < FRESH_MS) return this.#fresh;

    const { platform } = this.#options;
    const exclusions = this.#options.exclusions();
    const active = await platform.getActiveWindow();
    const block = findCaptureBlock(
      active === null ? undefined : { processName: active.appName, title: active.title },
      exclusions,
    );
    if (block !== null) {
      throw new Error(`capture is blocked while ${block.entry} has focus`);
    }

    const capture = await platform.captureDisplays(FRAME_LONG_SIDE, exclusions);
    const frames: StoredFrame[] = [];
    for (const display of capture.displays) {
      if (display.blocked !== null || display.image === null) continue;
      frames.push({
        displayId: display.id,
        png: Buffer.from(display.image.base64, 'base64'),
        width: display.image.width,
        height: display.image.height,
        displayWidth: Math.round(display.bounds.width * display.scaleFactor),
        displayHeight: Math.round(display.bounds.height * display.scaleFactor),
      });
    }
    this.#fresh = { at: now, frames, windows: [] };
    return this.#fresh;
  }
}
