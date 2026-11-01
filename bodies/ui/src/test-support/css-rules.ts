/**
 * Reads rules out of a style sheet string for tests: one rule's body, and the smallest padding
 * it sets (the padding rule: nothing bordered or filled holds text closer than 8px to its edge).
 */

/** The declarations of the rule whose selector is exactly `selector`. */
export function ruleOf(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1] ?? '';
}

/**
 * The smallest padding a rule sets, in px, or null when it sets none. A side set to 0 only
 * counts as padded when the rule fixes a height (the text is centred in it).
 */
export function minPadding(css: string, selector: string): number | null {
  const body = ruleOf(css, selector);
  const shorthand = body.match(/(?:^|[;\s])padding:\s*([^;]+);/);
  if (shorthand === null) return null;
  const parts = (shorthand[1] ?? '')
    .trim()
    .split(/\s+/)
    .map((part) => parseFloat(part));
  const [top = 0, right = top, bottom = top, left = right] = parts;
  const fixedHeight = /(?:^|[;\s])(?:min-)?height:/.test(body);
  const sides = fixedHeight ? [right, left] : [top, right, bottom, left];
  return Math.min(...sides);
}
