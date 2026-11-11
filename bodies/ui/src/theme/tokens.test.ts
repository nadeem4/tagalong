/** Tests for the design tokens: text and status colours meet 4.5:1 contrast. */

import { describe, expect, it } from 'vitest';
import { themeTokens, typeCss } from './tokens';

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('design tokens', () => {
  const { color } = themeTokens;

  it('has a token for your own message tile, readable text on it', () => {
    expect(color.mine).toBe('#2A3160');
    expect(contrast(color.text, color.mine)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps status chips, links and errors readable on the light page', () => {
    expect(contrast(color.okInk, color.okFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.warnInk, color.warnFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.errInk, color.errFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.errInk, color.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.link, color.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps body text on the dark chrome at 4.5:1 or better', () => {
    expect(contrast(color.text, color.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.textMuted, color.sidebar)).toBeGreaterThanOrEqual(4.5);
  });

  it('sets the UI font to Onest first', () => {
    expect(themeTokens.font.ui.startsWith("'Onest'")).toBe(true);
  });

  it('keeps the Scout wordmark out of the pixel font', () => {
    expect(themeTokens.font.wordmark).toContain('Onest');
    expect(themeTokens.font.wordmark).not.toContain('Pixelify');
    expect(themeTokens.fontWeight.wordmark).toBe(600);
  });

  it('has seven roles with the agreed sizes', () => {
    const rows = Object.entries(themeTokens.type).map(([k, v]) => [k, v.size, v.line]);
    expect(rows).toEqual([
      ['display', 26, 32],
      ['heading', 20, 28],
      ['title', 16, 22],
      ['bodyLead', 14, 21],
      ['body', 13, 20],
      ['small', 12, 16],
      ['caption', 11, 14],
    ]);
    expect(themeTokens.dockTag).toBe(9);
    expect(typeCss('body')).toBe('font-size:13px;line-height:20px;font-weight:400');
    expect(typeCss('title')).toBe('font-size:16px;line-height:22px;font-weight:600');
  });

  it('uses weights 400 or 600 only', () => {
    for (const role of Object.values(themeTokens.type)) expect([400, 600]).toContain(role.weight);
    expect(themeTokens.fontWeight).toEqual({ regular: 400, semibold: 600, wordmark: 600 });
  });

  it('has no pixel font and no letter spacing', () => {
    expect('pixel' in themeTokens.font).toBe(false);
    expect('letterSpacing' in themeTokens).toBe(false);
    expect('fontSize' in themeTokens).toBe(false);
  });

  it('rings focus navy on light and gold on navy, each readable on its surface', () => {
    expect(color.focusOnLight).not.toBe(color.focusOnNavy);
    expect(contrast(color.focusOnLight, color.panel)).toBeGreaterThanOrEqual(3);
    expect(contrast(color.focusOnNavy, color.page)).toBeGreaterThanOrEqual(3);
  });

  it('has a white control fill readable under panel text', () => {
    expect(color.controlFill).toBe('#FFFFFF');
    expect(contrast(color.panelText, color.controlFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws keycaps readable on their fill', () => {
    expect(contrast(color.keycapInk, color.keycapFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('has three radii and a space scale that only grows', () => {
    expect(themeTokens.radius).toEqual({ card: 12, pill: 999, sm: 8 });
    const steps = Object.values(themeTokens.space).sort((a, b) => a - b);
    expect(steps).toEqual([2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48]);
  });

  it('reads on-navy text and the card surface', () => {
    expect(contrast(color.textSoft, color.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.errNavyInk, color.errNavyFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.recInk, color.recFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.panelText, color.card)).toBeGreaterThanOrEqual(4.5);
  });
});
