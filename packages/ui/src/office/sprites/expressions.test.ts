import { describe, expect, it } from 'vitest';
import { CHARACTERS } from './characters';
import { withMood, type DockMood } from './expressions';

const base = CHARACTERS['scout']!.sprite;
const MOODS: readonly DockMood[] = ['listening', 'working', 'done', 'dozing', 'wince', 'cheer'];

describe('the dock faces', () => {
  it.each(MOODS)('%s changes only rows 4 to 7', (mood) => {
    const rows = withMood(base, mood).rows;
    expect(rows).toHaveLength(16);
    expect(rows.slice(0, 4)).toEqual(base.rows.slice(0, 4));
    expect(rows.slice(8)).toEqual(base.rows.slice(8));
    for (const row of rows) expect(row).toHaveLength(16);
  });

  it('gives each mood a face of its own', () => {
    const faces = MOODS.map((mood) => withMood(base, mood).rows.join('\n'));
    expect(new Set([base.rows.join('\n'), ...faces]).size).toBe(MOODS.length + 1);
  });

  it('closes the eyes to a line while dozing: no eye pixels left', () => {
    expect(withMood(base, 'dozing').rows.slice(4, 8).join('')).not.toContain('e');
  });
});
