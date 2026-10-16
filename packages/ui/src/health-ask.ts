/**
 * Which typed or spoken questions get the health card instead of a turn, so the check works
 * when Scout cannot think. Contains wantsHealthCheck.
 *
 * Only the whole question counts: "what's wrong with this code" is a real question for
 * Scout. Words that also fit the person's work ("what's broken?", "is anything broken?",
 * "are you working?") stay with Scout.
 */
const ASKS: readonly RegExp[] = [
  /^(what's|what is) (wrong|the matter)( with you)?$/,
  /^are you (ok|okay|alright|all right)$/,
  /^((run|do) )?(a )?health check$/,
  /^is (something|anything) wrong with you$/,
  /^why can't you (hear|see) me$/,
];

/** Lower case, plain apostrophes, no punctuation, and without "hey" or Scout's name. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey )?scout /, '')
    .replace(/ scout$/, '')
    .replace(/ please$/, '')
    .trim();
}

export function wantsHealthCheck(text: string): boolean {
  const asked = normalise(text);
  return ASKS.some((pattern) => pattern.test(asked));
}
