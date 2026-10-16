/** Tests for characterFor and shade. */

import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { BODY, CHARACTERS, characterFor, shade } from './characters';

function pet(overrides: Partial<Pet>): Pet {
  return {
    id: 'pet',
    name: 'Pet',
    avatar: '🐾',
    roleId: 'generalist',
    model: 'fake',
    providerId: 'fake',
    ...overrides,
  };
}

describe('characterFor', () => {
  it('gives Scout its own character: the orange fox', () => {
    expect(characterFor(pet({ id: 'scout' }))).toBe(CHARACTERS['scout']);
    expect(CHARACTERS['scout']?.sprite.palette['f']).toBe('#E8873A');
  });

  it('recolours the base body from any other pet’s colour', () => {
    const character = characterFor(pet({ id: 'sage', color: '#5dbb63' }));
    expect(character.sprite.rows).toBe(BODY);
    expect(character.sprite.palette['f']).toBe('#5dbb63');
    expect(character.sprite.palette['o']).toBe(shade('#5dbb63', -0.6));
  });

  it('falls back to a neutral colour for a pet saved without one', () => {
    expect(characterFor(pet({ id: 'old' })).sprite.palette['f']).toBe('#64748b');
  });
});

describe('shade', () => {
  it('mixes toward white for a positive amount and black for a negative one', () => {
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#000000', 1)).toBe('#ffffff');
    expect(shade('#ffffff', -1)).toBe('#000000');
    expect(shade('#ff0000', -0.5)).toBe('#800000');
  });
});
