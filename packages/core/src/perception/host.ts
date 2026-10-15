import type {
  ContextSnapshotPatch,
  DisplayBounds,
  HostCapability,
  PerceptionCaptureRegionResult,
  PerceptionCaptureWindowResult,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionListWindowsResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
  PerceptionReadTextResult,
  PerceptionTarget,
  ScreenPointAtParams,
  ScreenPointAtResult,
} from '@tagalong/protocol';

/**
 * The slice of a connected host the tools and watches need.
 *
 * Declared structurally rather than importing `HostSession` so a test can hand in a fake
 * host without standing up a websocket — and so `perception` never depends on `server`.
 */
export interface PerceptionHost {
  readonly capabilities: readonly HostCapability[];
  capture(what: readonly PerceptionTarget[]): Promise<ContextSnapshotPatch>;
  /**
   * The three Phase 2B methods.
   *
   * Optional on the type because a host is free to advertise fewer capabilities — the
   * Chrome host will never enumerate displays — and because the capability array is the
   * real gate. A host advertising `displays` without these is a wiring mistake, and the
   * tools report it as a refusal rather than throwing, so the turn survives it.
   */
  captureRegion?(params: {
    displayId: number;
    rect: DisplayBounds;
    maxLongSide: number;
  }): Promise<PerceptionCaptureRegionResult>;
  listWindows?(): Promise<PerceptionListWindowsResult>;
  readText?(params: { windowId?: string; maxChars: number }): Promise<PerceptionReadTextResult>;
  /** A screenshot of one listed window, in front or not, behind the `displays` capability. */
  captureWindow?(params: {
    windowId: string;
    maxLongSide: number;
  }): Promise<PerceptionCaptureWindowResult>;
  /** Phase 3B, behind the `recall` capability: a buffered frame from a moment ago. */
  recall?(params: PerceptionRecallParams): Promise<PerceptionRecallResult>;
  /** Phase 3B, behind the `recall` capability: how a display changed since then. */
  diff?(params: PerceptionDiffParams): Promise<PerceptionDiffResult>;
  /** Behind the `pointer` capability: a ring around one thing on screen. Only draws. */
  pointAt?(params: ScreenPointAtParams): Promise<ScreenPointAtResult>;
}
