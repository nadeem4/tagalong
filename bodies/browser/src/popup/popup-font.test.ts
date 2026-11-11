/**
 * Guards the add-on's type: the popup and the mic page set text in Onest (bundled, not fetched)
 * at the role sizes, like the desktop app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string =>
  readFileSync(join(import.meta.dirname, ...parts), 'utf8');

describe('popup and mic page type', () => {
  it('popup and mic page use Onest', () => {
    expect(read('popup.css')).toContain("'Onest'");
    expect(read('..', 'permission', 'mic.html')).toContain("'Onest'");
    for (const entry of [read('popup.ts'), read('..', 'permission', 'mic.ts')]) {
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
});
