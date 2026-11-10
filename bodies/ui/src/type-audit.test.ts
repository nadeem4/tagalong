/**
 * Guards the type system: every style sheet sets text in the seven roles only (sizes, weights),
 * with no capitals, no letter spacing and no pixel font. Checks the evaluated sheets that are
 * exported and the source of the rest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANSWER_CSS } from './answer';
import { CARD_CSS } from './card-styles';
import { CHAT_CSS } from './chat-styles';
import { CONTROLS_CSS } from './controls/controls-styles';
import { HOME_CSS } from './home/home-styles';
import { SETTINGS_CSS } from './settings/settings-styles';
import { themeTokens } from './theme/tokens';
import { WALKTHROUGH_CSS } from './walkthrough/walkthrough-styles';

const uiSrc = import.meta.dirname;
const bodies = join(uiSrc, '..', '..');
const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8');

const sheets: Record<string, string> = {
  'answer.tsx': ANSWER_CSS,
  'card-styles.ts': CARD_CSS,
  'chat-styles.ts': CHAT_CSS,
  'controls-styles.ts': CONTROLS_CSS,
  'home-styles.ts': HOME_CSS,
  'settings-styles.ts': SETTINGS_CSS,
  'walkthrough-styles.ts': WALKTHROUGH_CSS,
  // Not exported: read as source.
  'companion-bubble.tsx': read(uiSrc, 'companion-bubble.tsx'),
  'dock-pet.tsx': read(uiSrc, 'dock-pet.tsx'),
  'health-card.tsx': read(uiSrc, 'health-card.tsx'),
  'memory-view.tsx': read(uiSrc, 'home', 'memory-view.tsx'),
  'status-mark.tsx': read(uiSrc, 'status-mark.tsx'),
  'desktop app.css': read(bodies, 'desktop', 'src', 'renderer', 'src', 'app.css'),
  'desktop home.css': read(bodies, 'desktop', 'src', 'renderer', 'src', 'home.css'),
  'popup.css': read(bodies, 'browser', 'src', 'popup', 'popup.css'),
};

const roleSizes = new Set<number>([
  ...Object.values(themeTokens.type).map((r) => r.size),
  themeTokens.dockTag,
]);

function offenders(test: (css: string) => string[]): string[] {
  return Object.entries(sheets).flatMap(([name, css]) => test(css).map((hit) => `${name}: ${hit}`));
}

describe('type audit', () => {
  it('has no capitals', () => {
    expect(offenders((css) => css.match(/text-transform:\s*uppercase/g) ?? [])).toEqual([]);
  });

  it('has no letter spacing', () => {
    const bad = (css: string): string[] =>
      (css.match(/letter-spacing:\s*[^;]+/g) ?? []).filter(
        (m) => !/:\s*(0|normal)$/.test(m.trim()),
      );
    expect(offenders(bad)).toEqual([]);
  });

  it('sets every size on a role', () => {
    const bad = (css: string): string[] =>
      [...css.matchAll(/font-?[sS]ize:\s*([\d.]+)(px)?/g)]
        .filter((m) => !roleSizes.has(Number(m[1])))
        .map((m) => m[0]);
    expect(offenders(bad)).toEqual([]);
  });

  it('sets weights 400 or 600 only', () => {
    const bad = (css: string): string[] =>
      [...css.matchAll(/font-?[wW]eight:\s*(\d+)/g)]
        .filter((m) => m[1] !== '400' && m[1] !== '600')
        .map((m) => m[0]);
    expect(offenders(bad)).toEqual([]);
  });

  it('names no pixel font', () => {
    expect(offenders((css) => css.match(/Pixelify/gi) ?? [])).toEqual([]);
  });

  it('sets money and counts in tabular numerals', () => {
    for (const selector of ['.home-spend', '.apv-summary b', '.tg-spent']) {
      const sheet = Object.values(sheets).find((css) => css.includes(`${selector} {`)) ?? '';
      const line = sheet.split('\n').find((l) => l.startsWith(`${selector} {`)) ?? '';
      expect(line, selector).toContain('tabular-nums');
    }
  });
});
