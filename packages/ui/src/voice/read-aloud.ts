/**
 * Whether a typed request asks Scout to read aloud ("read this to me"), or only says to go
 * on after "Shall I go on?". Contains wantsReadAloud and goesOn.
 */

/**
 * A request that starts with "read" or "say" (after "Scout,", "can you" or "please"), or with
 * "translate this and read", and ends within a few words in "aloud", "to me" or "out loud":
 * "read this to me" or "translate it and read it to me", not "read the logs and explain the
 * error to me".
 */
const READ_ALOUD =
  /^(?:(?:hey\s+)?scout\W*\s*)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:translate\b(?:\s+(?!and\b|then\b)[\w'’-]+){0,4}?\s+and\s+(?:then\s+)?)?(?:read|say)\b(?:\s+(?!and\b|then\b)[\w'’-]+){0,4}?\s+(?:aloud|to me|out loud)(?:\s+please)?\W*$/i;

/** A short "go on" in reply to "Shall I go on?": nothing else rides along with it. */
const GOES_ON = /^(?:please\s+)?(?:go on|yes|continue|keep going)(?:\W+please)?\W*$/i;

/**
 * Whether a typed request asks Scout to read something aloud ("read this to me"). The bubble
 * then asks it as a spoken question, so the reading is said whole rather than cut to the
 * first sentence or two.
 */
export function wantsReadAloud(text: string): boolean {
  return READ_ALOUD.test(text.trim());
}

/**
 * Whether a typed reply to "Shall I go on?" only says to go on ("go on", "yes", "continue",
 * "keep going"), so the next part is read whole too. Any other question is asked as typed.
 */
export function goesOn(text: string): boolean {
  return GOES_ON.test(text.trim());
}
