import type { Sprite } from '../office/sprites/sprite';

/**
 * The desktop companion's state marks, as sprite data like every other piece of pixel art.
 * Each state has its own shape, so none of them is told apart by colour alone. Palettes are
 * art and live here with the sprites, not in the tokens.
 */

const NAVY = '#12162B';
const FROST = '#F6F7FB';
const MUTED = '#A3AAC4';
const DIM = '#6B7290';
const RED = '#E5484D';

/** The capture badge: a wide-open eye with rays, for the second after a look. */
export const LOOKING_EYE: Sprite = {
  // prettier-ignore
  rows: [
    'w...w...w',
    '.w..w..w.',
    '..ooooo..',
    '.owwpwwo.',
    'owwpppwwo',
    '.owwpwwo.',
    '..ooooo..',
  ],
  palette: { o: NAVY, w: FROST, p: NAVY },
};

/** Sight is Always: a small, calm open eye in muted tones that stays while it is on. */
export const ALWAYS_EYE: Sprite = {
  // prettier-ignore
  rows: [
    '..ooooo..',
    '.owwpwwo.',
    'owwpppwwo',
    '.owwpwwo.',
    '..ooooo..',
  ],
  palette: { o: MUTED, w: '#E9ECF5', p: '#2B3150' },
};

/** Sight is paused: the same eye greyed out, with a slash through it. */
export const PAUSED_EYE: Sprite = {
  // prettier-ignore
  rows: [
    '........s',
    '..oooo.s.',
    '.owwpws..',
    'owwppswwo',
    '.owwswwo.',
    '..osooo..',
    '..s......',
  ],
  palette: { o: DIM, w: MUTED, p: DIM, s: NAVY },
};

/** Rolling memory is recording: a round red dot with a light rim. */
export const RECORDING_DOT: Sprite = {
  // prettier-ignore
  rows: [
    '.wwww.',
    'wrrrrw',
    'wrrrrw',
    'wrrrrw',
    'wrrrrw',
    '.wwww.',
  ],
  palette: { w: FROST, r: RED },
};

/** A watch is running: an hourglass. */
export const WATCHING_GLASS: Sprite = {
  // prettier-ignore
  rows: [
    'ooooooo',
    '.owwwo.',
    '..owo..',
    '...o...',
    '..owo..',
    '.owwwo.',
    'ooooooo',
  ],
  palette: { o: NAVY, w: FROST },
};

/** A watch fired: an exclamation mark on a red tile. */
export const WATCH_ALERT: Sprite = {
  // prettier-ignore
  rows: [
    'ooooo',
    'orwro',
    'orwro',
    'orwro',
    'orwro',
    'orrro',
    'orwro',
    'orrro',
    'ooooo',
  ],
  palette: { o: NAVY, r: RED, w: FROST },
};

/** Working: a small speech bubble with three dots. */
export const WORKING_BUBBLE: Sprite = {
  // prettier-ignore
  rows: [
    '.ooooooo.',
    'owwwwwwwo',
    'owdwdwdwo',
    'owwwwwwwo',
    '.ooooooo.',
    '..oo.....',
    '..o......',
  ],
  palette: { o: NAVY, w: FROST, d: NAVY },
};
