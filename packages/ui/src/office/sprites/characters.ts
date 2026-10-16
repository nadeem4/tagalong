/**
 * How Scout looks: the 16x16 body and Scout's palette. Contains SCOUT_SPRITE.
 */

import type { Sprite } from './sprite';

/**
 * Scout's 16x16 body. Palette keys: o outline, f fur, p inner ear,
 * l muzzle, e eyes, n nose, c shirt, d shirt shade, a badge.
 */
const BODY: readonly string[] = [
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

/** Scout as the desktop, Home and Welcome draw it: the orange fox. */
export const SCOUT_SPRITE: Sprite = {
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
};
