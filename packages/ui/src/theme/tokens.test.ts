/** Tests for the design tokens: text and status colours meet 4.5:1 contrast. */

import { describe, expect, it } from 'vitest';
import { themeTokens } from './tokens';

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
});
