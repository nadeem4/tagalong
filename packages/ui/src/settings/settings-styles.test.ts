/** Tests for SETTINGS_CSS: focus ring, minimum font size, colours from the tokens. */

import { describe, expect, it } from 'vitest';
import { themeTokens as t } from '../theme/tokens';
import { SETTINGS_CSS } from './settings-styles';

describe('SETTINGS_CSS', () => {
  it('rings focus in gold, as Home does', () => {
    expect(SETTINGS_CSS).toContain(
      `:focus-visible {\n  outline: ${t.size.focusRing}px solid ${t.color.gold}`,
    );
  });

  it('sets no text below the 11px floor', () => {
    const sizes = [...SETTINGS_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(t.fontSize.min);
  });

  it('takes every colour from the design tokens', () => {
    const palette = new Set<string>(Object.values(t.color));
    const colours = SETTINGS_CSS.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(colours.filter((colour) => !palette.has(colour))).toEqual([]);
  });
});
