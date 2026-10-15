import type { FixTarget } from '@tagalong/ui';

/**
 * Where each Fix it lands: a Settings section (`settings#<section id>`) or a Home page. The
 * allowlist: a window names a target, never a page, so it cannot open anything else.
 */
const PAGES: Record<FixTarget, string> = {
  brain: 'settings#brain',
  voice: 'settings#voice',
  browser: 'settings#browser',
  privacy: 'settings#privacy',
  experts: 'experts',
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
