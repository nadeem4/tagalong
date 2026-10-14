import type { Pet } from '@tagalong/protocol';
import { officeTokens } from '../tokens';
import type { Sprite } from './sprite';

/** A neutral colour for a pet saved before pets had one. */
export const DEFAULT_PET_COLOR = '#64748b';

/**
 * The 16x16 body every character shares. Palette keys: o outline, f fur, p inner ear,
 * l muzzle, e eyes, n nose, c shirt, d shirt shade, a badge.
 */
export const BODY: readonly string[] = [
  '..oo........oo..',
  '.oppo......oppo.',
  '.offfoooooofffo.',
  'offffffffffffffo',
  'offffffffffffffo',
  'offeeffffffeeffo',
  'offeeffffffeeffo',
  'offllllllllllffo',
  '.offlllnnlllffo.',
  '..offllllllffo..',
  '...oooooooooo...',
  '..occccaacccco..',
  '.ocddccccccddco.',
  '.occcccccccccco.',
  '..offo....offo..',
  '..oooo....oooo..',
];

/** How one pet looks on the desktop. */
export interface Character {
  readonly sprite: Sprite;
}

/** The default pet's character, keyed by pet id. Adding a character is adding an entry. */
export const CHARACTERS: Readonly<Record<string, Character>> = {
  scout: {
    sprite: {
      rows: BODY,
      palette: {
        o: '#2A1B14',
        f: '#E8873A',
        p: '#F6B8A0',
        l: '#FFF1E0',
        e: '#1B1B2A',
        n: '#2A1B14',
        c: '#3E8E5A',
        d: '#2E6B44',
        a: '#F2C14E',
      },
    },
  },
};

/** Mixes a `#rrggbb` colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const weight = Math.abs(amount);
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16);
    const mixed = Math.round(value + (target - value) * weight);
    return mixed.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

/**
 * The one place a pet becomes a character: Scout by id, anyone else as the
 * base body recoloured from the pet's own colour.
 */
export function characterFor(pet: Pet): Character {
  const known = Object.hasOwn(CHARACTERS, pet.id) ? CHARACTERS[pet.id] : undefined;
  if (known !== undefined) return known;
  const color = pet.color ?? DEFAULT_PET_COLOR;
  return {
    sprite: {
      rows: BODY,
      palette: {
        o: shade(color, -0.6),
        f: color,
        p: shade(color, 0.45),
        l: shade(color, 0.8),
        e: '#1B1B2A',
        n: shade(color, -0.6),
        c: shade(color, -0.25),
        d: shade(color, -0.45),
        a: officeTokens.color.gold,
      },
    },
  };
}
