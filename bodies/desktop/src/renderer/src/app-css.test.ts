/**
 * Guards the shared renderer sheet: Onest is the body font, not the browser default, and its
 * colour variables hold the token values (a CSS file cannot import the tokens).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeTokens } from '../../../../ui/src/theme/tokens';

const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8');

describe('app.css', () => {
  it('sets the body font to Onest', () => {
    const body = /(^|\n)body\s*\{([^}]*)\}/.exec(css)?.[2] ?? '';
    expect(body).toMatch(/font-family:\s*'Onest'/);
  });

  it('draws its colours from the tokens', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const vars = Object.fromEntries(
      [...root.matchAll(/--([a-z]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]?.toUpperCase()]),
    );
    const { color } = themeTokens;
    expect(vars).toEqual({
      ink: color.slateInk.toUpperCase(),
      muted: color.slateMuted.toUpperCase(),
      line: color.slateLine.toUpperCase(),
      surface: color.card.toUpperCase(),
      err: color.slateErr.toUpperCase(),
    });
  });
});
