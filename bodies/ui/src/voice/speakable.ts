/**
 * Turns a bubble line into what Scout says aloud: Markdown stripped, show-only blocks left
 * out. The mind decides what is said; this only shapes it for the voice. Contains
 * toSpeakable, mergeShortLines and SHORT_LINE.
 */

/** Below this a line is short enough that the local voice says it badly on its own. */
export const SHORT_LINE = 40;

/**
 * Turns a bubble line into what Scout says aloud, all of it: the mind chose what to write,
 * so nothing is cut. Show-only blocks are left out (a fenced code block; a table
 * row; a quoted `>` line, which mostly holds a translation the English voice would mangle),
 * as are bare URLs. A list item is read with its marker stripped. Nothing is added: an answer
 * that is all blocks says nothing.
 */
export function toSpeakable(text: string): string {
  if (text.trim() === '') return '';
  const withoutBlocks = text.replace(/```[\s\S]*?(?:```|$)/g, '\n');
  return withoutBlocks
    .split('\n')
    .filter((line) => !/^\s*(?:>|\|)/.test(line))
    .map((line) => line.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, ''))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|\*/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
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
