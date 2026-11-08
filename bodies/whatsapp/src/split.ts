/**
 * Cuts a long reply into parts that fit one WhatsApp message (the cap is 4096; we stay
 * under it). Prefers a paragraph, then a line, then a space, and only then breaks hard.
 */

export function splitReply(text: string, maxLen = 4000): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > maxLen) {
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
  if (rest) parts.push(rest);
  return parts;
}
