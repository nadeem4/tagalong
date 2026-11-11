/**
 * Guards the Scout wordmark: every sheet sets the name "Scout" in Onest at 600, the same
 * face as all other text. Reads the style sources because the bubble's sheet is not exported.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_CSS } from './home/home-styles';
import { WALKTHROUGH_CSS } from './walkthrough/walkthrough-styles';

const rule = (css: string, selector: string): string =>
  css.split('\n').find((line) => line.startsWith(selector)) ?? '';

describe('Scout wordmark', () => {
  it('is set in Onest on Home', () => {
    const line = rule(HOME_CSS, '.home-nav__who strong');
    expect(line).not.toBe('');
    expect(line).toContain("'Onest'");
  });

  it('is set in Onest in the walkthrough', () => {
    const line = rule(WALKTHROUGH_CSS, '.wt-name');
    expect(line).not.toBe('');
    expect(line).toContain("'Onest'");
  });

  it('is set in Onest in the bubble', () => {
    const source = readFileSync(join(import.meta.dirname, 'chat-styles.ts'), 'utf8');
    const start = source.indexOf('.bubble-head strong {');
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, start + 160)).toContain('font-family: ${t.font.wordmark}');
  });
});
