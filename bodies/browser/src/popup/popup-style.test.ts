/**
 * Guards the add-on's style: the popup and the mic page set text in Onest (bundled, not fetched)
 * at the role sizes, like the desktop app, and their colour variables hold the token values
 * (plain CSS cannot import the tokens, so this test is the link).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeTokens } from '../../../ui/src/theme/tokens';

const read = (...parts: string[]): string =>
  readFileSync(join(import.meta.dirname, ...parts), 'utf8');

describe('popup and mic page style', () => {
  it('popup and mic page use Onest', () => {
    expect(read('popup.css')).toContain("'Onest'");
    expect(read('..', 'permission', 'mic.html')).toContain("'Onest'");
    expect(read('..', 'permission', 'permission.html')).toContain("'Onest'");
    for (const entry of [
      read('popup.ts'),
      read('..', 'permission', 'mic.ts'),
      read('..', 'permission', 'permission.ts'),
    ]) {
      expect(entry).toContain("import '@fontsource/onest/latin-400.css'");
      expect(entry).toContain("import '@fontsource/onest/latin-600.css'");
    }
  });

  it('sets popup text on the role sizes and weights', () => {
    const css = read('popup.css');
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect([11, 12, 13, 14, 16, 20, 26]).toContain(size);
    const weights = [...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]);
    for (const weight of weights) expect(['400', '600']).toContain(weight);
  });

  it('draws its colours from the tokens, light and dark', () => {
    const { color } = themeTokens;
    const vars = (block: string | undefined): Record<string, string | undefined> =>
      Object.fromEntries(
        [...(block ?? '').matchAll(/--([a-z]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
          m[1],
          m[2]?.toUpperCase(),
        ]),
      );
    const css = read('popup.css');
    expect(vars(/:root\s*\{([^}]*)\}/.exec(css)?.[1])).toEqual({
      bg: color.panel.toUpperCase(),
      card: color.controlFill.toUpperCase(),
      text: color.panelText.toUpperCase(),
      muted: color.panelMuted.toUpperCase(),
      line: color.panelLine.toUpperCase(),
      link: color.link.toUpperCase(),
      err: color.errInk.toUpperCase(),
    });
    expect(vars(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1])).toEqual({
      bg: color.page.toUpperCase(),
      card: color.field.toUpperCase(),
      text: color.text.toUpperCase(),
      muted: color.textMuted.toUpperCase(),
      line: color.fieldLine.toUpperCase(),
      link: color.sky.toUpperCase(),
      err: color.errNavyInk.toUpperCase(),
    });
    for (const page of ['mic.html', 'permission.html']) {
      const html = read('..', 'permission', page);
      expect(vars(/:root\s*\{([^}]*)\}/.exec(html)?.[1])).toEqual({
        ink: color.panelText.toUpperCase(),
        page: color.card.toUpperCase(),
      });
      expect(vars(/dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(html)?.[1])).toEqual({
        ink: color.text.toUpperCase(),
        page: color.page.toUpperCase(),
      });
    }
  });
});
