/**
 * The one call and full-screen rule: when the front window is a call or full screen, Scout
 * keeps out of the way. Contains isMeeting and callOrFullScreenInFront.
 */
import type { WindowEntry } from '@tagalong/ui/shapes';
import { normalizeProcessName } from './platform/exclusions';

/** Call and meeting apps, by process: the pet never speaks over a call. */
const MEETING_PROCESSES = new Set(['teams', 'ms-teams', 'zoom']);
/** The same in a browser: a Google Meet tab, a Zoom meeting window. */
const MEETING_TITLE = /^Meet [-–] |Google Meet|Zoom Meeting/i;

export function isMeeting(window: WindowEntry): boolean {
  return (
    MEETING_PROCESSES.has(normalizeProcessName(window.processName)) ||
    MEETING_TITLE.test(window.title)
  );
}

/**
 * A call or a full-screen window in front, and Scout keeps out of the way. It is the front
 * window that counts, so a Teams window in front counts even with no call, and a call
 * behind another window does not. Always listening follows this check.
 */
export function callOrFullScreenInFront(windows: readonly WindowEntry[]): boolean {
  const front = windows.find((window) => window.state === 'foreground');
  return front !== undefined && (front.fullScreen === true || isMeeting(front));
}
