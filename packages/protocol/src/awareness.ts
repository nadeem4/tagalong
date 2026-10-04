import { z } from 'zod';

import { CapturedImage, DisplayBounds, WindowEntry } from './context';

/**
 * Phase 3B: what the desktop remembers, and what changed on it.
 *
 * Kept apart from `methods.ts` because these shapes share one idea the rest of the
 * catalog does not have — time. Every other perception method answers about now.
 */

/** One display as it looked at a moment the host buffered. */
export const RecalledFrame = z.object({
  displayId: z.number().int(),
  /** When this frame was taken, so the pet can say which moment it is describing. */
  capturedAt: z.iso.datetime(),
  image: CapturedImage,
});
export type RecalledFrame = z.infer<typeof RecalledFrame>;

/**
 * The frame nearest `secondsAgo`, for one display or for every display.
 *
 * Whole seconds: the buffer holds a frame every five, so anything finer is a precision
 * the answer cannot have.
 */
export const PerceptionRecallParams = z.object({
  secondsAgo: z.number().int().nonnegative(),
  displayId: z.number().int().optional(),
});
export type PerceptionRecallParams = z.infer<typeof PerceptionRecallParams>;

export const PerceptionRecallResult = z.object({
  /** Whether rolling memory is on right now. Off, `frames` is empty and the pet says why. */
  recording: z.boolean(),
  /** The oldest moment the buffer reaches, so "ten minutes ago" after a restart is honest. */
  oldestAt: z.iso.datetime().optional(),
  /** The moment the answer describes. Absent when the buffer is empty. */
  capturedAt: z.iso.datetime().optional(),
  frames: z.array(RecalledFrame),
  /** The window inventory as it was at `capturedAt`. Never any window text. */
  windows: z.array(WindowEntry),
  focusedWindow: z.object({ processName: z.string().min(1), title: z.string() }).optional(),
});
export type PerceptionRecallResult = z.infer<typeof PerceptionRecallResult>;

/**
 * How one display, or a region of it, differs from how it looked `sinceSeconds` ago.
 *
 * `rect` is in that display's own pixels, as `perception.captureRegion` takes it. A watch
 * polls with `includeImages: false` and only asks for the crops when it is about to show
 * them to a model: two PNGs every five seconds is the cost the threshold exists to avoid.
 */
export const PerceptionDiffParams = z.object({
  displayId: z.number().int(),
  /** Positive: a frame compared with itself says nothing. */
  sinceSeconds: z.number().int().positive(),
  rect: DisplayBounds.optional(),
  includeImages: z.boolean().default(true),
});
export type PerceptionDiffParams = z.input<typeof PerceptionDiffParams>;

export const PerceptionDiffResult = z.object({
  /** The share of the region's pixels that changed, from 0 (nothing) to 1 (everything). */
  changeRatio: z.number().min(0).max(1),
  /** When the earlier frame was taken. Absent when there was nothing to compare with. */
  beforeAt: z.iso.datetime().optional(),
  afterAt: z.iso.datetime(),
  /** The bounding box of what changed, in display pixels. Absent when nothing did. */
  bounds: DisplayBounds.optional(),
  /** The changed box as it was, and as it is now. Only with `includeImages`. */
  before: CapturedImage.optional(),
  after: CapturedImage.optional(),
});
export type PerceptionDiffResult = z.infer<typeof PerceptionDiffResult>;

/** A watch saw its condition come true. The panel shows `message`; the watch is over. */
export const WatchFiredParams = z.object({
  watchId: z.uuid(),
  petId: z.string().min(1),
  message: z.string().min(1),
  displayId: z.number().int(),
});
export type WatchFiredParams = z.infer<typeof WatchFiredParams>;

/**
 * Where a watch stands, so a host can show a Watching chip and take it down again.
 *
 * Every state but `watching` is final. `capped` means the per-watch check limit ran out.
 */
export const WatchState = z.enum(['watching', 'fired', 'stopped', 'timeout', 'capped', 'error']);
export type WatchState = z.infer<typeof WatchState>;

export const WatchStatusParams = z.object({
  watchId: z.uuid(),
  petId: z.string().min(1),
  condition: z.string().min(1),
  displayId: z.number().int(),
  state: WatchState,
  /** Model checks spent so far, against `maxChecks`. */
  checks: z.number().int().nonnegative(),
  maxChecks: z.number().int().positive(),
  /** The small model answering this watch's checks, so the chip can say which one. */
  checkModel: z.string().min(1).optional(),
  /** A sentence for the user when the watch ended for a reason worth saying. */
  detail: z.string().optional(),
});
export type WatchStatusParams = z.infer<typeof WatchStatusParams>;

/** The Watching chip's Stop button. */
export const WatchStopParams = z.object({ watchId: z.uuid() });
export const WatchStopResult = z.object({ stopped: z.boolean() });
