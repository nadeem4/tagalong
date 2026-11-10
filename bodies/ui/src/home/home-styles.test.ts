/** Tests for HOME_CSS: the focus ring follows the surface, never a fixed gold. */

import { describe, expect, it } from 'vitest';
import { themeTokens as t } from '../theme/tokens';
import { HOME_CSS } from './home-styles';

describe('HOME_CSS', () => {
  it('no gold focus override: the ring comes from the surface variable', () => {
    expect(HOME_CSS).toContain(
      `.home :focus-visible {\n  outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px;`,
    );
    expect(HOME_CSS).not.toMatch(/focus-visible[^}]*#F2C14E/i);
  });

  it('shows the where-things-run status dots and keeps the wrap rule to that card', () => {
    expect(HOME_CSS).toContain(
      '.home-card--run .home-dot { display: inline-block; margin-right: 6px; }',
    );
    expect(HOME_CSS).toContain('.home-card--run .home-card__row strong { min-width: 0;');
    expect(HOME_CSS).not.toContain('\n.home-card__row strong');
  });

  it('caps the page at 920px with one inset from the tokens', () => {
    expect(HOME_CSS).toContain(`.home-page { max-width: 920px;`);
    expect(HOME_CSS).toContain(`padding: 0 ${t.space.page}px`);
  });

  it('never wraps a time', () => {
    expect(HOME_CSS).toMatch(/\.home-time[^{]*\{[^}]*white-space: nowrap/);
    expect(HOME_CSS).toMatch(/\.apv-row__time[^{]*\{[^}]*white-space: nowrap/);
  });

  it('gives the permissions card no width or margin of its own', () => {
    expect(HOME_CSS).not.toMatch(/\.home-perms\s*\{[^}]*(max-width|margin)/);
  });

  it('draws the job log in mono on the navy shell with every ANSI colour from the tokens', () => {
    expect(HOME_CSS).toMatch(new RegExp(`\\.job-log \\{[^}]*background: ${t.color.page}`));
    expect(HOME_CSS).toContain(`font-family: ${t.font.mono}`);
    for (const [name, hex] of Object.entries(t.ansi)) {
      expect(HOME_CSS).toContain(`.ansi-${name} { color: ${hex}; }`);
    }
  });

  it('stops the job spinner for reduced motion', () => {
    expect(HOME_CSS).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{[^}]*\.job-log__glyph--running[^}]*animation: none/,
    );
  });

  it('styles the app search group, tags and check card from tokens', () => {
    for (const name of ['.conn-group', '.conn-tag--official', '.conn-check']) {
      expect(HOME_CSS).toContain(`${name} {`);
    }
    expect(HOME_CSS).toContain('.conn-tag {');
    expect(HOME_CSS).toMatch(new RegExp(`\\.conn-check \\{[^}]*${t.color.warnFill}`));
  });
});
