/** Tests that arrows drawn by CSS carry an empty alt text, so screen readers do not read them in names. */

import { describe, expect, it } from 'vitest';
import { WALKTHROUGH_CSS } from './walkthrough-styles';

describe('walkthrough CSS glyphs', () => {
  it.each([
    ['.wt-back::before', '←'],
    ['.wt-next::after', '→'],
    ['.wt-flow > li:not(:last-child)::after', '→'],
    ['.wt-moments .wt-help::before', '→'],
  ])('%s uses the alt-text form', (selector, glyph) => {
    const line = WALKTHROUGH_CSS.split('\n').find((l) => l.startsWith(selector)) ?? '';
    expect(line).toMatch(new RegExp(`content: '${glyph}[ ]*' / ''`));
  });
});
