/**
 * Where a Fix it button lands: the allowlist from FixTarget to a Home page or Settings section.
 * Contains fixPage.
 */

import type { FixTarget } from '@tagalong/ui/shapes';

/**
 * Where each Fix it lands: a Settings section (`settings#<section id>`) or a Home page. The
 * allowlist: a window names a target, never a page, so it cannot open anything else.
 */
const PAGES: Record<FixTarget, string> = {
  voice: 'settings#voice',
  connections: 'connections',
};

/** The Home page to open for `target`; plain Settings when none is named. */
export function fixPage(target: unknown): string {
  if (target === undefined) return 'settings';
  if (typeof target === 'string' && Object.hasOwn(PAGES, target)) {
    return PAGES[target as FixTarget];
  }
  throw new Error(`Tagalong has no fix called ${String(target)}`);
}
