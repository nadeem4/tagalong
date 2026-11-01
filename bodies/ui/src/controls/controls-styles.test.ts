/** Tests for CONTROLS_CSS: focus ring variable per surface, 11px floor, colours from tokens. */
import { describe, expect, it } from 'vitest';
import { themeTokens as t } from '../theme/tokens';
import { CONTROLS_CSS } from './controls-styles';

describe('CONTROLS_CSS', () => {
  it('defines the focus ring navy on light and gold on navy', () => {
    expect(CONTROLS_CSS).toContain(`--tg-focus: ${t.color.focusOnLight}`);
    expect(CONTROLS_CSS).toMatch(new RegExp(`.on-navy[^}]*--tg-focus: ${t.color.focusOnNavy}`));
  });

  it('rings keyboard focus with the variable', () => {
    expect(CONTROLS_CSS).toContain('outline: 2px solid var(--tg-focus)');
  });

  it('sets no text below the 11px floor', () => {
    const sizes = [...CONTROLS_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(t.fontSize.min);
  });

  it('takes every colour from the design tokens', () => {
    const palette = new Set<string>(Object.values(t.color));
    const colours = CONTROLS_CSS.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(colours.filter((colour) => !palette.has(colour))).toEqual([]);
  });

  it('gives the wordmark class Onest 600', () => {
    expect(CONTROLS_CSS).toContain('.tg-wordmark');
  });
});
