/**
 * Whether a transcript is Scout's own voice coming back through the mic. A plain match of the
 * words against what is playing: no model and no judgement about meaning. One word never
 * counts, so a lone "stop" always reaches Scout, who sees what it was saying and decides.
 * Imports nothing.
 */

/** Lowercase words with every Unicode punctuation mark and run of spaces removed. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w !== '');
}

/** True when `transcript` has at least two words and they appear in a row inside `playing`. */
export function echoOf(transcript: string, playing: string): boolean {
  const heard = words(transcript);
  if (heard.length < 2) return false;
  const said = words(playing);
  for (let start = 0; start + heard.length <= said.length; start++) {
    if (heard.every((w, i) => said[start + i] === w)) return true;
  }
  return false;
}
