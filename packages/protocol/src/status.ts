/**
 * The status marks the body shows on Scout and in the bubble: a neutral word or two, never a
 * sentence in Scout's voice (only the mind speaks as Scout). Shared by main and the UI.
 * Contains StatusId, StatusMark, FixTarget, STATUS_WORDS and topStatus.
 */

import { z } from 'zod';

/** In order: of the marks set, the first one here is the one that shows on Scout. */
export const StatusId = z.enum([
  'brain-signed-out',
  'brain-no-sign-in',
  'brain-no-key',
  'listening-on',
]);
export type StatusId = z.infer<typeof StatusId>;

export interface StatusMark {
  id: StatusId;
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
  'listening-on': {
    tag: 'Listening',
    detail: 'Always listening is on. Say “Scout, stop” to switch it off.',
  },
};

/** The mark that shows on Scout: the first in StatusId's order, or null when there is none. */
export function topStatus(marks: Iterable<StatusMark>): StatusMark | null {
  const rank = (mark: StatusMark): number => StatusId.options.indexOf(mark.id);
  let top: StatusMark | null = null;
  for (const mark of marks) if (top === null || rank(mark) < rank(top)) top = mark;
  return top;
}
