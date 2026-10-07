import type { Pet } from '@tagalong/protocol';
import { DEFAULT_PET_COLOR } from '../../crew-strip';
import { officeTokens } from '../tokens';
import type { Sprite } from './sprite';

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

export const PLANT: Sprite = {
  rows: [
    '..gg.g..',
    '.gGgggG.',
    'gGggGggg',
    '.ggGggg.',
    '..gggg..',
    '...tt...',
    '..pppp..',
    '..pPPp..',
    '..pPPp..',
    '...pp...',
  ],
  palette: { g: '#4E9F5B', G: '#7CC36A', t: '#6B4A2B', p: '#E8EAEF', P: '#C9CED8' },
};

/** The gold marker that hops above the selected pet. */
export const CURSOR: Sprite = {
  rows: ['GGGGGGG', '.GGGGG.', '..GGG..', '...G...'],
  palette: { G: officeTokens.color.gold },
};

/** How one pet looks in the office. Its job label comes from its role, not from here. */
export interface Character {
  readonly sprite: Sprite;
}

/**
 * The default crew's characters, keyed by pet id. Adding a character is adding an entry.
 */
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
  ink: {
    sprite: {
      rows: BODY,
      palette: {
        o: '#121222',
        f: '#3B3B52',
        p: '#E58FB0',
        l: '#6A6A86',
        e: '#F2C14E',
        n: '#E58FB0',
        c: '#8B6CEF',
        d: '#6A4FD0',
        a: '#F2C14E',
      },
    },
  },
  bolt: {
    sprite: {
      rows: BODY,
      palette: {
        o: '#16203A',
        f: '#4C7BD9',
        p: '#9FC0F5',
        l: '#EEF3FF',
        e: '#16203A',
        n: '#16203A',
        c: '#2E3E66',
        d: '#222E4F',
        a: '#F2A93B',
        h: '#1B1B2A',
      },
      // The headset: ear cups, the band over the head, and the mic.
      overlay: [
        [0, 4, 'h'],
        [0, 5, 'h'],
        [0, 6, 'h'],
        [15, 4, 'h'],
        [15, 5, 'h'],
        [15, 6, 'h'],
        [5, 1, 'h'],
        [6, 1, 'h'],
        [7, 1, 'h'],
        [8, 1, 'h'],
        [9, 1, 'h'],
        [10, 1, 'h'],
        [1, 7, 'h'],
        [2, 8, 'h'],
        [3, 8, 'h'],
      ],
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
 * The one place a pet becomes a character: the default crew by id, anyone else as the
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
