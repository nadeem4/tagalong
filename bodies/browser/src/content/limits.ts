/**
 * Size budgets for a page read. Kept import-free because the page reader is injected into
 * the user's tab on every read and whatever it imports ships with it.
 */
export const MAX_PAGE_TEXT_CHARS = 40_000;
export const MAX_SELECTION_CHARS = 20_000;
export const TRUNCATED_NOTE = '\n[truncated at 40,000 characters]';
