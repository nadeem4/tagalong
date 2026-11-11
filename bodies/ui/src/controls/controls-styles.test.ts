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
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(t.type.caption.size);
  });

  it('takes every colour from the design tokens', () => {
    const palette = new Set<string>(Object.values(t.color));
    const colours = CONTROLS_CSS.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(colours.filter((colour) => !palette.has(colour))).toEqual([]);
  });

  it('gives the wordmark class Onest 600', () => {
    const rule = CONTROLS_CSS.match(/\.tg-wordmark\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain(t.font.wordmark);
    expect(rule).toContain('font-weight: 600');
  });

  it('keeps the valid key field border rule as one intact selector', () => {
    expect(CONTROLS_CSS).toContain(
      `.tg-keyfield[data-state='valid'] #tg-api-key { border-color: ${t.color.okInk}; }`,
    );
  });

  it('out-ranks the Settings panel input and select rules', () => {
    // .tg-panel input[type='text'] is (0,2,1) and .tg-panel select is (0,1,1).
    expect(CONTROLS_CSS).toContain(".tg-money .tg-money__row input[type='text'] {");
    expect(CONTROLS_CSS).toContain(
      ".tg-money .tg-money__row input[type='text'][aria-invalid='true']",
    );
    expect(CONTROLS_CSS).toContain('.tg-select .tg-select__wrap select {');
  });

  it('uses the control fill token for light controls', () => {
    expect(CONTROLS_CSS).toContain(`--tg-ctl-bg: ${t.color.controlFill}`);
  });

  it('gives the money stepper buttons AA ink and border on both surfaces', () => {
    const rule = CONTROLS_CSS.match(/\.tg-money \.tg-button\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color: var(--tg-ctl-ink)');
    expect(rule).toContain('border-color: var(--tg-ctl-muted)');
  });

  it('fills the slider track with gold up to the thumb', () => {
    expect(CONTROLS_CSS).toMatch(/slider-runnable-track\s*\{[^}]*gradient[^}]*var\(--fill\)/);
  });

  it('has a visually hidden class', () => {
    expect(CONTROLS_CSS).toContain('.tg-sr-only {');
  });

  it('keeps the limit field and Set in one row at the control height', () => {
    const row = CONTROLS_CSS.match(/\.tg-limitfield__row\s*\{[^}]*\}/)?.[0] ?? '';
    expect(row).toContain('display: flex');
    expect(row).toContain('align-items: center');
    expect(row).toContain(`height: ${t.size.control}px`);
  });

  it('draws the spend meter 6px slim and turns it amber when the limit is reached', () => {
    expect(CONTROLS_CSS).toMatch(/\.tg-spendmeter\s*\{[^}]*height: 6px/);
    expect(CONTROLS_CSS).toMatch(/\.tg-spendmeter--full[^{]*\{[^}]*background: /);
  });
});
