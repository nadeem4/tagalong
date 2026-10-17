/**
 * The status marks the body shows on Scout and in the bubble: a neutral word or two, never a
 * sentence in Scout's voice (only the mind speaks as Scout). Shared by main and the UI.
 * Contains StatusId, StatusMark, FixTarget, STATUS_WORDS, STATUS_ORDER, isProblem and topStatus.
 */

import { z } from 'zod';

export const StatusId = z.enum([
  'brain-signed-out',
  'brain-no-sign-in',
  'brain-no-key',
  'ears-failed',
  'mic-busy',
  'mic-failed',
  'ears-loading',
  'say-name',
  'listening-on',
  // A turn's outcome with no text, shown as a bubble row only.
  'declined',
  'stopped',
]);
export type StatusId = z.infer<typeof StatusId>;

/** One mark: which status, plus a download's percent or a more exact sentence when known. */
export interface StatusMark {
  id: StatusId;
  percent?: number;
  /** Replaces the table's sentence, e.g. the ears' own failure message. */
  detail?: string;
}

/** Where a Fix it button lands: a Settings section, or a Home page. */
export type FixTarget = 'brain' | 'voice' | 'browser' | 'privacy' | 'experts' | 'connections';

/** tag: the 1-2 words on Scout. detail: the tooltip, the aria label and the bubble row. */
export const STATUS_WORDS: Readonly<
  Record<StatusId, { tag: string; detail: string; fix?: FixTarget }>
> = {
  'brain-signed-out': {
    tag: 'Signed out',
    detail: 'Can’t think: signed out of Claude.',
    fix: 'brain',
  },
  'brain-no-sign-in': {
    tag: 'No brain',
    detail: 'Can’t think: Claude Code isn’t on this computer.',
    fix: 'brain',
  },
  'brain-no-key': { tag: 'No key', detail: 'Can’t think: no API key.', fix: 'brain' },
  'ears-failed': { tag: 'Can’t listen', detail: 'Listening couldn’t start.', fix: 'voice' },
  'mic-busy': {
    tag: 'Mic busy',
    detail:
      'Another app is using the microphone. Close it and try again, or pick another in Settings.',
    fix: 'voice',
  },
  'mic-failed': {
    tag: 'No mic',
    detail:
      'The microphone could not be opened. Check that Windows lets apps use it, or pick another in Settings.',
    fix: 'voice',
  },
  'ears-loading': { tag: 'Ears', detail: 'Speech models downloading.' },
  'say-name': { tag: 'Say “Scout”', detail: 'Start with “Scout” to ask.' },
  'listening-on': {
    tag: 'Listening',
    detail: 'Always listening is on. Say “Scout, stop” to switch it off.',
  },
  declined: { tag: 'Declined', detail: 'Declined.' },
  stopped: { tag: 'Stopped', detail: 'Stopped.' },
};

/** Problems first, then progress, then hints. Only the top mark shows on Scout. */
export const STATUS_ORDER: readonly StatusId[] = StatusId.options;

const PROBLEMS: ReadonlySet<StatusId> = new Set([
  'brain-signed-out',
  'brain-no-sign-in',
  'brain-no-key',
  'ears-failed',
  'mic-busy',
  'mic-failed',
]);

/** A problem shows in the warn colour; progress and hints in the muted one. */
export function isProblem(id: StatusId): boolean {
  return PROBLEMS.has(id);
}

/** The mark that shows on Scout: the first in STATUS_ORDER, or null when there is none. */
export function topStatus(marks: Iterable<StatusMark>): StatusMark | null {
  let top: StatusMark | null = null;
  for (const mark of marks) {
    if (top === null || STATUS_ORDER.indexOf(mark.id) < STATUS_ORDER.indexOf(top.id)) top = mark;
  }
  return top;
}
