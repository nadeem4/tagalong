import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { BODY, CHARACTERS, characterFor, shade } from './characters';

function pet(overrides: Partial<Pet>): Pet {
  return {
    id: 'pet',
    name: 'Pet',
    avatar: '🐾',
    roleId: 'generalist',
    roleVersion: 1,
    model: 'fake',
    providerId: 'fake',
    toolGrants: {},
    replyStyle: 'text',
    ...overrides,
  };
}

describe('characterFor', () => {
  it('gives each default pet its own character from the office design', () => {
    expect(characterFor(pet({ id: 'scout' }))).toBe(CHARACTERS['scout']);
    expect(characterFor(pet({ id: 'ink' }))).toBe(CHARACTERS['ink']);
    expect(characterFor(pet({ id: 'bolt' }))).toBe(CHARACTERS['bolt']);
  });

  it('draws Scout as the orange fox, Ink as the black cat and Bolt in a headset', () => {
    expect(CHARACTERS['scout']?.sprite.palette['f']).toBe('#E8873A');
    expect(CHARACTERS['ink']?.sprite.palette['f']).toBe('#3B3B52');
    expect(CHARACTERS['bolt']?.sprite.palette['f']).toBe('#4C7BD9');
    expect(CHARACTERS['bolt']?.sprite.overlay?.length).toBeGreaterThan(0);
  });

  it('recolours the base body from any other pet’s colour', () => {
    const character = characterFor(pet({ id: 'sage', color: '#5dbb63' }));
    expect(character.sprite.rows).toBe(BODY);
    expect(character.sprite.palette['f']).toBe('#5dbb63');
    expect(character.sprite.palette['o']).toBe(shade('#5dbb63', -0.6));
    expect(character.jobLabel).toBe('CREW');
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
