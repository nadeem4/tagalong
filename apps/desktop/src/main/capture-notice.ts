import type { CaptureBlock } from '@tagalong/core';
import type { CaptureNotice } from '../shared/ipc';

export interface CaptureNoticeInput {
  at: Date;
  /** True when a screenshot was attempted, whether or not it was allowed. */
  screenshot: boolean;
  blocked?: CaptureBlock | null;
}

/** Local wall-clock HH:MM. The user reads this next to their own taskbar clock. */
function atTime(iso: string): string {
  const when = new Date(iso);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/**
 * Says what was read, in one sentence.
 *
 * A refusal names the exclusion entry the user wrote and nothing else — repeating the
 * window title of a password manager back at them would leak exactly what the exclusion
 * list exists to keep out of this app.
 */
function describe(input: CaptureNoticeInput): string {
  if (input.blocked) {
    const where = input.blocked.rule === 'processName' ? 'this app' : 'this window title';
    return `Capture is blocked here — the exclusion "${input.blocked.entry}" matches ${where}.`;
  }
  return input.screenshot
    ? 'Tagalong captured the screen.'
    : 'Tagalong read the selection and the active window.';
}

/** Builds the notice the renderer badges and the tray reports. */
export function captureNotice(input: CaptureNoticeInput): CaptureNotice {
  return {
    at: input.at.toISOString(),
    screenshot: input.screenshot,
    message: describe(input),
    ...(input.blocked ? { blocked: input.blocked } : {}),
  };
}

/**
 * The tray tooltip after a capture.
 *
 * The tray is the one surface that is always there, so it carries the record of the last
 * capture with its time — the answer to "did that thing just look at my screen?" has to be
 * reachable without opening anything.
 */
export function captureTooltip(notice: CaptureNotice): string {
  const time = atTime(notice.at);
  if (notice.blocked) return `Tagalong did not capture at ${time} — blocked in this app`;
  return notice.screenshot
    ? `Tagalong captured the screen at ${time}`
    : `Tagalong read the selection at ${time}`;
}
