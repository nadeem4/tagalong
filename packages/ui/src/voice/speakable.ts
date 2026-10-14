/** Said after a line that was cut short, so the listener knows there is more to read. */
export const REST_IN_BUBBLE = 'The rest is in the bubble.';

/** Said when nothing in an answer can be read aloud: it was all code, a list or a table. */
export const ONLY_IN_BUBBLE = 'The answer is in the bubble.';

/** How many sentences are spoken before the rest is left to the bubble. */
const MAX_SENTENCES = 2;

/** A spoken line longer than this is cut, at a word. About fifteen seconds of speech. */
const MAX_CHARS = 200;

/** Below this a line is short enough that the local voice says it badly on its own. */
const SHORT_LINE = 40;

/**
 * Turns a bubble line into what Scout says aloud: markdown stripped, code blocks, lists,
 * tables and bare URLs left out, and only the first sentence or two. Anything cut ends
 * with "The rest is in the bubble.", so a listener who is not looking knows to look.
 *
 * `whole` is a piece of a spoken answer (Talk to Scout), said as it streams: shaped the
 * same way but never cut, and nothing at all when the piece has nothing to say.
 */
export function toSpeakable(text: string, { whole = false }: { whole?: boolean } = {}): string {
  if (text.trim() === '') return '';
  let cut = false;

  const withoutCode = text.replace(/```[\s\S]*?(?:```|$)/g, () => {
    cut = true;
    return '\n';
  });
  const lines = withoutCode.split('\n').filter((line) => {
    const listOrTable = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line) || /^\s*\|/.test(line);
    if (listOrTable) cut = true;
    return !listOrTable;
  });
  const plain = lines
    .map((line) => line.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, ''))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|\*/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();

  if (whole) return plain;
  if (plain === '') return ONLY_IN_BUBBLE;

  const sentences = (plain.match(/[^.!?]*[.!?]+["')\]]*(?=\s|$)|[^.!?]+$/g) ?? [plain])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
  if (sentences.length > MAX_SENTENCES) cut = true;
  let spoken = sentences.slice(0, MAX_SENTENCES).join(' ');
  if (spoken.length > MAX_CHARS && sentences.length > 1) {
    spoken = sentences[0]!;
    cut = true;
  }
  if (spoken.length > MAX_CHARS) {
    const at = spoken.lastIndexOf(' ', MAX_CHARS);
    spoken = spoken.slice(0, at > 0 ? at : MAX_CHARS);
    cut = true;
  }
  return cut ? `${spoken} ${REST_IN_BUBBLE}` : spoken;
}

/**
 * Joins consecutive short lines into one. The local voice is weak on very short input
 * ("Done." alone comes out clipped), and lines that arrive together read naturally as one.
 */
export function mergeShortLines(lines: readonly string[]): string[] {
  const merged: string[] = [];
  for (const line of lines) {
    const last = merged.at(-1);
    if (last !== undefined && last.length < SHORT_LINE)
      merged[merged.length - 1] = `${last} ${line}`;
    else merged.push(line);
  }
  return merged;
}
