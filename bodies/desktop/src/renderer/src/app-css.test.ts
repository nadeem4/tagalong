/** Guards the shared renderer sheet: Onest is the body font, not the browser default. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app.css', () => {
  it('sets the body font to Onest', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8');
    const body = /(^|\n)body\s*\{([^}]*)\}/.exec(css)?.[2] ?? '';
    expect(body).toMatch(/font-family:\s*'Onest'/);
  });
});
