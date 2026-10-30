/**
 * The shapes rolling memory answers with: a frame from a moment ago, and how a display
 * differs from how it looked earlier. Plain types, since nothing crosses a wire any more.
 * Contains RecalledFrame, PerceptionRecallParams/Result and PerceptionDiffParams/Result.
 */
import type { CapturedImage, DisplayBounds, WindowEntry } from '@tagalong/ui/shapes';

/** One display as it looked at a moment the host buffered. */
export interface RecalledFrame {
  displayId: number;
  /** When this frame was taken, so Scout can say which moment it is describing. */
  capturedAt: string;
  image: CapturedImage;
}

/**
 * The frame nearest `secondsAgo`, for one display or for every display. Whole seconds: the
 * buffer holds a frame every five, so anything finer is a precision the answer cannot have.
 */
export interface PerceptionRecallParams {
  secondsAgo: number;
  displayId?: number | undefined;
}

export interface PerceptionRecallResult {
  /** Whether rolling memory is on right now. Off, `frames` is empty. */
  recording: boolean;
  /** The oldest moment the buffer reaches, so "ten minutes ago" after a restart is honest. */
  oldestAt?: string;
  /** The moment the answer describes. Absent when the buffer is empty. */
  capturedAt?: string;
  frames: RecalledFrame[];
  /** The window inventory as it was at `capturedAt`. Never any window text. */
  windows: WindowEntry[];
  focusedWindow?: { processName: string; title: string };
}

/**
 * How one display, or a region of it, differs from how it looked `sinceSeconds` ago.
 * `rect` is in that display's own pixels. `includeImages` defaults to true: a poll passes
 * false and only asks for the crops when it is about to show them.
 */
export interface PerceptionDiffParams {
  displayId: number;
  sinceSeconds: number;
  rect?: DisplayBounds | undefined;
  includeImages?: boolean | undefined;
}

export interface PerceptionDiffResult {
  /** The share of the region's pixels that changed, from 0 (nothing) to 1 (everything). */
  changeRatio: number;
  /** When the earlier frame was taken. Absent when there was nothing to compare with. */
  beforeAt?: string;
  afterAt: string;
  /** The bounding box of what changed, in display pixels. Absent when nothing did. */
  bounds?: DisplayBounds;
  /** The changed box as it was, and as it is now. Only with `includeImages`. */
  before?: CapturedImage;
  after?: CapturedImage;
}
