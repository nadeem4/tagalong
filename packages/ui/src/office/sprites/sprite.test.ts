/** Tests for spriteShadow. */

import { describe, expect, it } from 'vitest';
import { spriteShadow } from './sprite';

describe('spriteShadow', () => {
  it('draws one 1px shadow per painted pixel, row by row', () => {
    const shadow = spriteShadow({ rows: ['ab', '.a'], palette: { a: '#111111', b: '#222222' } });
    expect(shadow).toBe('0px 0px 0 0 #111111, 1px 0px 0 0 #222222, 1px 1px 0 0 #111111');
  });

  it('skips transparent pixels and keys the palette does not name', () => {
    expect(spriteShadow({ rows: ['.z.'], palette: { a: '#111111' } })).toBe('');
  });
});
