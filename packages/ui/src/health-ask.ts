/**
 * "Scout, what's wrong?": the questions the bubble answers with a health check instead of a
 * turn, so the check works when Scout cannot think. Only the whole question counts: "what's
 * wrong with this code" is a real question for Scout.
 */
const ASKS: readonly RegExp[] = [
  /^(what's|what is) (wrong|the matter|broken)( with you)?$/,
  /^are you (ok|okay|alright|all right|working)$/,
  /^((run|do) )?(a )?health check$/,
  /^is (something|anything) (wrong|broken)$/,
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
  return asked !== '' && ASKS.some((pattern) => pattern.test(asked));
}
