/** Tests for CONNECTIONS_CSS: the row grid, chips, check card, and only the type sizes and weights the type roles define. */

import { describe, expect, it } from 'vitest';
import { themeTokens as t } from '../theme/tokens';
import { CONNECTIONS_CSS } from './connections-styles';

describe('CONNECTIONS_CSS', () => {
  it('lays a row out as a 36px tile, the text and the actions', () => {
    expect(CONNECTIONS_CSS).toMatch(/\.cx-row \{[^}]*grid-template-columns: 36px 1fr auto/);
  });

  it('draws the Official chip from the ok tokens', () => {
    expect(CONNECTIONS_CSS).toMatch(
      new RegExp(`\\.cx-chip--official \\{[^}]*${t.color.okFill}[^}]*${t.color.okInk}`),
    );
  });

  it('draws the check card on the warning fill', () => {
    expect(CONNECTIONS_CSS).toMatch(new RegExp(`\\.cx-check \\{[^}]*${t.color.warnFill}`));
  });

  it('dims the old results while a search runs', () => {
    expect(CONNECTIONS_CSS).toMatch(/\.cx-stale \{[^}]*opacity: \.45/);
  });

  it('stops the spinner for reduced motion', () => {
    expect(CONNECTIONS_CSS).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{[^}]*\.cx-spin[^}]*animation: none/,
    );
  });

  it('uses only the sizes and weights of the type roles, so the type system maps on mechanically', () => {
    const sizes = [...CONNECTIONS_CSS.matchAll(/font-size: (\d+)px/g)].map((m) => Number(m[1]));
    for (const size of sizes) expect([26, 20, 16, 14, 13, 12, 11]).toContain(size);
    const weights = [...CONNECTIONS_CSS.matchAll(/font-weight: (\d+)/g)].map((m) => Number(m[1]));
    for (const weight of weights) expect([400, 600]).toContain(weight);
    expect(sizes.length).toBeGreaterThan(5);
  });
});
