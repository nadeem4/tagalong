/** Tests for SCOUT_SPRITE. */

import { describe, expect, it } from 'vitest';
import { SCOUT_SPRITE } from './characters';

describe('SCOUT_SPRITE', () => {
  it('is the 16x16 body in Scout’s orange fur', () => {
    expect(SCOUT_SPRITE.rows).toHaveLength(16);
    expect(SCOUT_SPRITE.rows.every((row) => row.length === 16)).toBe(true);
    expect(SCOUT_SPRITE.palette['f']).toBe('#E8873A');
  });
});
