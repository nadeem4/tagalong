/** "read" or "say", then "aloud", "to me" or "out loud" later in the same request. */
const READ_ALOUD = /\b(?:read|say)\b.*\b(?:aloud|to me|out loud)\b/i;

/**
 * Whether a typed request asks Scout to read something aloud ("read this to me"). The bubble
 * then asks it as a spoken question, so the reading is said whole rather than cut to the
 * first sentence or two.
 */
export function wantsReadAloud(text: string): boolean {
  return READ_ALOUD.test(text);
}
