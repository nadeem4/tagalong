/**
 * Cuts a long reply into parts that fit one WhatsApp message (the cap is 4096; we stay
 * under it). Prefers a paragraph, then a line, then a space, and only then breaks hard.
 * A phone is a poor place to read a wall of text, so past `maxParts` the last part is cut
 * and says so.
 */

export const CUT_NOTE = '\n(cut: ask me for the rest)';

export function splitReply(text: string, maxLen = 4000, maxParts = 4): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  // One part past the cap is enough to know the text was cut.
  while (rest.length > maxLen && parts.length <= maxParts) {
    const window = rest.slice(0, maxLen + 1);
    const at = ['\n\n', '\n', ' '].map((sep) => window.lastIndexOf(sep)).find((i) => i > 0);
    let cut = at ?? maxLen;
    // Never cut between the two halves of an emoji or other surrogate pair.
    const before = rest.charCodeAt(cut - 1);
    if (at === undefined && before >= 0xd800 && before <= 0xdbff) cut -= 1;
    const part = rest.slice(0, cut).trim();
    if (part) parts.push(part);
    rest = rest.slice(cut).trim();
  }
  if (rest && parts.length <= maxParts) parts.push(rest);
  if (parts.length <= maxParts) return parts;
  const last = parts[maxParts - 1] as string;
  return [
    ...parts.slice(0, maxParts - 1),
    `${last.slice(0, maxLen - CUT_NOTE.length).trimEnd()}${CUT_NOTE}`,
  ];
}
