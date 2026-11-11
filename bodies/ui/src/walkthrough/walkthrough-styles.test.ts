/** Tests that arrows drawn by CSS carry an empty alt text, so screen readers do not read them in names. */

import { describe, expect, it } from 'vitest';
import { themeTokens, typeCss } from '../theme/tokens';
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

describe('walkthrough CSS rules', () => {
  it('gives Finish and Done the shared 96px final-button width', () => {
    expect(WALKTHROUGH_CSS).toMatch(/\.wt-final \{[^}]*min-width: 96px/);
  });

  it('sets the Ready to use rows at body size and the status dot from the ok token', () => {
    expect(WALKTHROUGH_CSS).toContain(`.wt-ready .wt-keylist li { ${typeCss('body')}; }`);
    expect(WALKTHROUGH_CSS).toContain(
      `.wt .home-dot { width: 8px; height: 8px; border-radius: 50%; background: ${themeTokens.color.okDot};`,
    );
  });
});
