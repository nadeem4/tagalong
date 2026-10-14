import { describe, expect, it } from 'vitest';
import { officeTokens as t } from '../office/tokens';
import { HOME_CSS } from './home-styles';

describe('HOME_CSS', () => {
  it('rings keyboard focus in gold across Home, as Settings does', () => {
    expect(HOME_CSS).toContain(
      `.home :focus-visible {\n  outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px;`,
    );
  });
});
