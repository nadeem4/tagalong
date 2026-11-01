/**
 * Guards the Scout wordmark: no sheet sets the name "Scout" in the pixel font (it made the
 * c read as o). Reads the style sources because the bubble's sheet is not exported.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_CSS } from './home/home-styles';
import { WALKTHROUGH_CSS } from './walkthrough/walkthrough-styles';

const rule = (css: string, selector: string): string =>
  css.split('\n').find((line) => line.startsWith(selector)) ?? '';

describe('Scout wordmark', () => {
  it('is not set in the pixel font on Home', () => {
    const line = rule(HOME_CSS, '.home-nav__who strong');
    expect(line).not.toBe('');
    expect(line).not.toContain('Pixelify');
  });

  it('is not set in the pixel font in the walkthrough', () => {
    const line = rule(WALKTHROUGH_CSS, '.wt-name');
    expect(line).not.toBe('');
    expect(line).not.toContain('Pixelify');
  });

  it('is not set in the pixel font in the bubble', () => {
    const source = readFileSync(join(import.meta.dirname, 'companion-bubble.tsx'), 'utf8');
    const line = source.split('\n').find((l) => l.startsWith('.bubble-head strong')) ?? '';
    expect(line).not.toBe('');
    expect(line).not.toContain('font.pixel');
  });
});
