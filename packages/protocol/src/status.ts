/**
 * The status marks the body shows on Scout and in the bubble: a neutral word or two, never a
 * sentence in Scout's voice (only the mind speaks as Scout). Shared by main and the UI.
 * Contains StatusId, StatusMark, FixTarget, STATUS_WORDS, statusTag and topStatus.
 */

import { z } from 'zod';

/** In order: of the marks set, the first one here is the one that shows on Scout. */
export const StatusId = z.enum([
  'brain-offline',
  'brain-outdated',
  'brain-signed-out',
  'brain-no-sign-in',
  'brain-no-key',
  'ears-failed',
  'mic-busy',
  'mic-failed',
  'ears-loading',
  'listening-paused',
  'say-name',
  'listening-on',
]);
export type StatusId = z.infer<typeof StatusId>;

export interface StatusMark {
  id: StatusId;
  /** The speech models' download so far, 0-100: shown on the tag ("Ears 40%"). */
  percent?: number;
}

/** Where a Fix it button lands: a Settings section, or a Home page. */
export type FixTarget = 'brain' | 'voice' | 'browser' | 'privacy' | 'experts' | 'connections';

/**
 * tag: the 1-2 words on Scout. detail: the tooltip, the aria label and the bubble row. A mark
 * with a fix is a problem: Fix it in the row, and the warn colour.
 */
export const STATUS_WORDS: Readonly<
  Record<StatusId, { tag: string; detail: string; fix?: FixTarget }>
> = {
  'brain-offline': { tag: 'Offline', detail: "Scout's brain is not running." },
  'brain-outdated': {
    tag: 'Update',
    detail: 'Update Tagalong to talk to this brain.',
  },
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
  'ears-failed': {
    tag: 'Can’t listen',
    detail: 'Can’t listen: the speech models didn’t load. It retries on its own.',
    fix: 'voice',
  },
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
  'ears-loading': { tag: 'Ears', detail: 'Speech models downloading, about 43 MB.' },
  'listening-paused': {
    tag: 'Not listening',
    detail: 'Always listening is paused for a call, a full-screen window or Welcome.',
  },
  'say-name': { tag: 'Say “Scout”', detail: 'Start with “Scout” to ask.' },
  'listening-on': {
    tag: 'Listening',
    detail: 'Always listening is on. Say “Scout, stop” to switch it off.',
  },
};

/** The words on the tag: the table's, plus the download's percent when there is one. */
export function statusTag(mark: StatusMark): string {
  const { tag } = STATUS_WORDS[mark.id];
  return mark.percent === undefined ? tag : `${tag} ${Math.round(mark.percent)}%`;
}

/** The mark that shows on Scout: the first in StatusId's order, or null when there is none. */
export function topStatus(marks: Iterable<StatusMark>): StatusMark | null {
  const rank = (mark: StatusMark): number => StatusId.options.indexOf(mark.id);
  let top: StatusMark | null = null;
  for (const mark of marks) if (top === null || rank(mark) < rank(top)) top = mark;
  return top;
}
