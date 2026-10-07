import { describe, expect, it } from 'vitest';
import { OFFICE_CSS } from './office-styles';
import { officeTokens } from './tokens';

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

describe('office tokens', () => {
  const { color } = officeTokens;

  it('keeps body text on the dark chrome at 4.5:1 or better', () => {
    expect(contrast(color.text, color.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.textMuted, color.sidebar)).toBeGreaterThanOrEqual(4.5);
  });

  it('paints the floor a neutral pale concrete, with readable desk plates and room labels', () => {
    for (const hex of [color.floor, color.floorGrid]) {
      const [r, , b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
      // No blue bias, and no cream either: the channels stay within a few steps.
      expect(b).toBeLessThanOrEqual(r ?? 0);
      expect((r ?? 0) - (b ?? 0)).toBeLessThanOrEqual(8);
    }
    expect(luminance(color.floorGrid)).toBeLessThan(luminance(color.floor));
    expect(contrast(color.plate, color.floor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.roomLabel, color.floor)).toBeGreaterThanOrEqual(4.5);
  });

  it('dims a disabled control’s label below normal text but keeps it at 3:1 or better', () => {
    const disabled = contrast(color.disabledInk, color.page);
    expect(disabled).toBeGreaterThanOrEqual(3);
    expect(disabled).toBeLessThan(contrast(color.textMuted, color.page));
  });

  it('styles disabled buttons from the disabled tokens', () => {
    const rule = /^\.office-btn:disabled\s*\{([^}]*)\}/m.exec(OFFICE_CSS)?.[1] ?? '';
    expect(rule).toContain(`color: ${color.disabledInk}`);
    expect(rule).toContain(`border-color: ${color.disabledLine}`);
  });

  it('gives each role class an ink that reads on the party list and is never gold', () => {
    const inks = Object.values(officeTokens.roleInk);
    expect(Object.keys(officeTokens.roleInk).sort()).toEqual([
      'backend-engineer',
      'frontend-engineer',
      'generalist',
      'researcher',
      'writer',
    ]);
    for (const ink of inks) {
      expect(contrast(ink, color.sidebar)).toBeGreaterThanOrEqual(4.5);
      expect(ink.toUpperCase()).not.toBe(color.gold.toUpperCase());
    }
    expect(new Set(inks.map((ink) => ink.toUpperCase())).size).toBe(inks.length);
  });
});
