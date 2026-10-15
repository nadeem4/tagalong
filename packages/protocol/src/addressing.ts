/**
 * Whether a spoken turn is meant for Scout. With Always listening on, only a turn that
 * starts with the name is acted on. A plain transcript check: no model, no wake-word engine.
 * Imports nothing.
 */

/** Whitespace and any Unicode punctuation: commas, dashes, ellipses, quotes. */
const PUNCTUATION = '\\s\\p{P}';

/**
 * "Scout" at the start, after an optional "hey", "ok" or "okay"; the rest is captured.
 * Not "Scout's" or "Scout-like": that is talk about Scout, not to it.
 */
const ADDRESSED = new RegExp(
  `^\\s*(?:(?:hey|okay|ok)\\b[${PUNCTUATION}]*)?scout\\b(?!['’-])(.*)$`,
  'isu',
);
const LEADING_PUNCTUATION = new RegExp(`^[${PUNCTUATION}]+`, 'u');
const STOP = new RegExp(`^stop(?:\\s+listening)?[${PUNCTUATION}]*$`, 'iu');

/**
 * What follows the name, ready to send as the question; null when the turn does not start
 * with "Scout" or nothing follows it.
 */
export function addressedToScout(text: string): string | null {
  const match = ADDRESSED.exec(text);
  if (!match) return null;
  const rest = (match[1] ?? '').replace(LEADING_PUNCTUATION, '').trim();
  return rest === '' ? null : rest;
}

/** "stop" or "stop listening", the rest of "Scout, stop.": switches Always listening off. */
export function isStopListening(question: string): boolean {
  return STOP.test(question.trim());
}

const TRAILING_PUNCTUATION = new RegExp(`[${PUNCTUATION}]+$`, 'u');

/**
 * Words heard so far that could still grow into "stop listening" ("st", "stop list"): a
 * partial like this is not a question yet, so it must not bring the bubble up or cut Scout off.
 */
export function mightBeStop(question: string): boolean {
  const words = question.trim().replace(TRAILING_PUNCTUATION, '').replace(/\s+/gu, ' ');
  return words !== '' && 'stop listening'.startsWith(words.toLowerCase());
}
