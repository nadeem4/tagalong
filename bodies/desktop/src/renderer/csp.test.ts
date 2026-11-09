/**
 * Every window's page sets script-src itself. Left to fall back on default-src, Chromium
 * prints a "script-src was not explicitly set" note that the log file recorded as an ERROR
 * on every launch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('window pages', () => {
  it.each(['avatar', 'home', 'panel', 'walkthrough'])('%s.html names script-src', (page) => {
    const html = readFileSync(join(__dirname, `${page}.html`), 'utf8');
    expect(html).toContain("script-src 'self'");
  });
});
