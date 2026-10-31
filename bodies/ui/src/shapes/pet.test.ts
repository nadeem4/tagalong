/** Tests for the Pet schema: only what the body draws. */
import { describe, expect, it } from 'vitest';
import { Pet } from './pet';

const valid = { id: 'scout', name: 'Scout', avatar: '🔎' };

describe('Pet', () => {
  it('parses a minimal pet as it is', () => {
    expect(Pet.parse(valid)).toEqual(valid);
  });

  it('has exactly the keys the body draws: id, name, avatar', () => {
    expect(Object.keys(Pet.shape).sort()).toEqual(['avatar', 'id', 'name']);
  });

  it('rejects an empty name', () => {
    expect(Pet.safeParse({ ...valid, name: '' }).success).toBe(false);
  });
});
