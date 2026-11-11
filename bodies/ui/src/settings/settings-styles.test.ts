/** Tests for SETTINGS_CSS: focus ring, type roles, colours from the tokens. */

import { describe, expect, it } from 'vitest';
import { themeTokens as t } from '../theme/tokens';
import { SETTINGS_CSS } from './settings-styles';

describe('SETTINGS_CSS', () => {
  it('no gold focus override: the ring comes from the surface variable', () => {
    expect(SETTINGS_CSS).toContain(
      `:focus-visible {\n  outline: ${t.size.focusRing}px solid var(--tg-focus)`,
    );
    expect(SETTINGS_CSS).not.toMatch(/focus-visible[^}]*#F2C14E/i);
  });

  it('sets no text below the 11px floor', () => {
    const sizes = [...SETTINGS_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(t.type.caption.size);
  });

  it('takes every colour from the design tokens', () => {
    const palette = new Set<string>(Object.values(t.color));
    const colours = SETTINGS_CSS.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(colours.filter((colour) => !palette.has(colour))).toEqual([]);
  });

  it('lets Home set the page width and has no footer or old switch left', () => {
    expect(SETTINGS_CSS).not.toContain('max-width: 820px');
    expect(SETTINGS_CSS).not.toContain('.tg-footer');
    expect(SETTINGS_CSS).not.toContain('.tg-switch');
  });
});
