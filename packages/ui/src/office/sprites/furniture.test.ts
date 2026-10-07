import { describe, expect, it } from 'vitest';
import { FURNITURE, monitorSprite } from './furniture';
import type { Sprite } from './sprite';

const ALL: [string, Sprite][] = [
  ...Object.entries(FURNITURE),
  ['monitor (lit)', monitorSprite(true)],
  ['monitor (dark)', monitorSprite(false)],
];

describe('furniture sprites', () => {
  it('includes the desk, monitor, chair, meeting table, window, floor props and the lounge', () => {
    expect(Object.keys(FURNITURE).sort()).toEqual(
      [
        'chair',
        'coffeeTable',
        'desk',
        'meetingTable',
        'rug',
        'shelf',
        'sofa',
        'waterCooler',
        'window',
      ].sort(),
    );
  });

  for (const [name, sprite] of ALL) {
    it(`${name}: every row is the same width`, () => {
      const width = sprite.rows[0]?.length ?? 0;
      expect(width).toBeGreaterThan(0);
      for (const row of sprite.rows) expect(row).toHaveLength(width);
    });

    it(`${name}: uses only palette keys it defines`, () => {
      const keys = new Set(sprite.rows.join('').replaceAll('.', ''));
      for (const key of keys) expect(sprite.palette, `key '${key}'`).toHaveProperty(key);
    });
  }

  it('lights the monitor screen when working and darkens it at the desk', () => {
    expect(monitorSprite(true).palette['s']).not.toBe(monitorSprite(false).palette['s']);
    expect(monitorSprite(true).rows).toBe(monitorSprite(false).rows);
  });
});
