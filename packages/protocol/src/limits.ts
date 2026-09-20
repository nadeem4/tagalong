/**
 * Character budgets, in the one module that imports nothing.
 *
 * They live here rather than beside the schemas that use them because both sides need
 * them: `settings.ts` bounds the configurable window budget, and `methods.ts` bounds the
 * per-call one. `methods.ts` already imports `settings.ts`, so a budget defined in either
 * would put the other in a cycle — and these are used at module-init time, inside schema
 * builders, which is exactly where a cycle stops being harmless and becomes a constant
 * that is still in its temporal dead zone.
 *
 * Their original modules re-export them, so no existing import had to change.
 */

/** A selection is always kept whole up to this length; beyond it the host truncates. */
export const MAX_SELECTION_CHARS = 20_000;

/** Readable page text ceiling. The prompt budget in settings may cut it further. */
export const MAX_PAGE_TEXT_CHARS = 40_000;

/**
 * How much of one window's text a read returns unless asked otherwise.
 *
 * Eight thousand characters is roughly 2,000 tokens: enough for a terminal's scrollback or
 * an email body, small enough that a pet reading three windows has not quietly spent a
 * whole context window.
 */
export const DEFAULT_WINDOW_TEXT_CHARS = 8_000;

/**
 * The ceiling a caller — or the user in settings — may raise the per-window budget to.
 *
 * The same cap as page text, because it is the same kind of spend. Past it one window can
 * outweigh everything else in an assembled prompt, and someone dragging a slider has no
 * way to see that coming.
 */
export const MAX_WINDOW_TEXT_CHARS = MAX_PAGE_TEXT_CHARS;
