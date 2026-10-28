/** Tests for HOME_CSS: the gold focus ring. */

import { describe, expect, it } from 'vitest';
import { themeTokens as t } from '../theme/tokens';
import { HOME_CSS } from './home-styles';

describe('HOME_CSS', () => {
  it('rings keyboard focus in gold across Home, as Settings does', () => {
    expect(HOME_CSS).toContain(
      `.home :focus-visible {\n  outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px;`,
    );
  });

  it('shows the where-things-run status dots and keeps the wrap rule to that card', () => {
    expect(HOME_CSS).toContain(
      '.home-card--run .home-dot { display: inline-block; margin-right: 6px; }',
    );
    expect(HOME_CSS).toContain('.home-card--run .home-card__row strong { min-width: 0;');
    expect(HOME_CSS).not.toContain('\n.home-card__row strong');
  });
});
