/**
 * Whether a spoken turn is meant for Scout. With Always listening on, only a turn that
 * starts with the name (or a word that sounds like it: speech to text often hears "Scott")
 * is acted on, or any turn in the short follow-up window after Scout answered aloud. A plain
 * transcript check: no model, no wake-word engine. Imports nothing.
 */

/** Whitespace and any Unicode punctuation: commas, dashes, ellipses, quotes. */
const PUNCTUATION = '\\s\\p{P}';

/**
 * The first word, after an optional "hey", "ok" or "okay"; the rest is captured. The word
 * must end there: "Scout's" or "Scout-like" is talk about Scout, not to it.
 */
const LEADING = new RegExp(
  `^\\s*(?:(?:hey|okay|ok)\\b[${PUNCTUATION}]*)?(\\p{L}+)(?![\\p{L}'’-])(.*)$`,
  'isu',
);
const LEADING_PUNCTUATION = new RegExp(`^[${PUNCTUATION}]+`, 'u');
const STOP = new RegExp(`^stop(?:\\s+listening)?[${PUNCTUATION}]*$`, 'iu');

/** How long after Scout finishes an answer aloud a reply needs no name. */
export const FOLLOW_UP_MS = 20_000;

/**
 * A word that sounds like "Scout": it starts "sc" (or "sk") and is at most one letter added,
 * dropped or changed away ("Scott", "Scot", "Scoot", "Skout", "Scouts"). "Shout", "scope",
 * "about" and "count" are not.
 */
function soundsLikeScout(word: string): boolean {
  const heard = word.toLowerCase().replace(/^sk/u, 'sc');
  return heard.startsWith('sc') && editDistance(heard, 'scout') <= 1;
}

/** Letters added, dropped or changed to turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const change = a[i - 1] === b[j - 1] ? 0 : 1;
      next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + change));
    }
    row = next;
  }
  return row[b.length]!;
}

/**
 * What follows the name, ready to send as the question; null when the turn does not start
 * with "Scout" (or a word that sounds like it) or nothing follows it. In the follow-up window
 * (`followUp`) the whole turn is the question, without the name if it was said.
 */
export function addressedToScout(text: string, options?: { followUp?: boolean }): string | null {
  const match = LEADING.exec(text);
  if (match !== null && soundsLikeScout(match[1] ?? '')) {
    const rest = (match[2] ?? '').replace(LEADING_PUNCTUATION, '').trim();
    return rest === '' ? null : rest;
  }
  if (options?.followUp !== true) return null;
  const whole = text.trim();
  return whole === '' ? null : whole;
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
