/**
 * Where a routine's result shows on the desktop: the line beside Scout, its voice, a notification.
 * Contains routineDelivery.
 */

import type { RoutineResultParams } from '@tagalong/protocol';

const PREVIEW_CHARS = 180;

export interface RoutineDelivery {
  /** The quiet line beside Scout, which opens to the full answer. */
  line: boolean;
  /** Said aloud, in Scout's voice. */
  speak: boolean;
  /** A Windows notification, or null. */
  notice: { title: string; body: string } | null;
}

/**
 * Where a routine's result goes on the desktop, from what the routine chose and what is on
 * screen. The line never covers a bubble the person is using, and never shows beside a
 * hidden Scout: a notification carries it then, so a chosen bubble is never silently lost.
 */
export function routineDelivery(
  result: RoutineResultParams,
  screen: { avatarVisible: boolean; panelVisible: boolean },
): RoutineDelivery {
  const { deliver } = result;
  const line = deliver.bubble && screen.avatarVisible && !screen.panelVisible;
  const notify = deliver.notification || (deliver.bubble && !line);
  const text = result.text.trim().replace(/\s+/g, ' ');
  const body = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
  const title =
    result.state === 'error'
      ? `${result.name} did not run`
      : result.late
        ? `${result.name} (ran late)`
        : result.name;
  return {
    line,
    speak: deliver.voice,
    notice: notify ? { title, body: body || result.line } : null,
  };
}
