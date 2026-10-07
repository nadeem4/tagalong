import type { Sprite } from './sprite';

/**
 * The office's furniture as pixel art, drawn at the same 3x scale as the pets. Shading is
 * painted into the pixels, a darker row along each front edge, rather than added with CSS.
 * Each piece is one entry: change a row or a colour here and the floor follows.
 */

/** A monitor facing the viewer: s screen, g glare, o bezel, n stand, b base. */
const MONITOR_ROWS: readonly string[] = [
  'oooooooooooo',
  'oggsssssssso',
  'ogssssssssso',
  'osssssssssso',
  'osssssssssso',
  'osssssssssso',
  'oooooooooooo',
  '.....nn.....',
  '....nnnn....',
  '..bbbbbbbb..',
];

const MONITOR_FRAME = { o: '#23283A', n: '#3E4560', b: '#2B3150' } as const;
const LIT_MONITOR: Sprite = {
  rows: MONITOR_ROWS,
  palette: { ...MONITOR_FRAME, s: '#4FD1C1', g: '#B8F2EA' },
};
const DARK_MONITOR: Sprite = {
  rows: MONITOR_ROWS,
  palette: { ...MONITOR_FRAME, s: '#3A4057', g: '#4A5170' },
};

/** Lit teal while the pet is working, dark while it is at its desk. */
export function monitorSprite(lit: boolean): Sprite {
  return lit ? LIT_MONITOR : DARK_MONITOR;
}

export const FURNITURE = {
  /** A front-facing white desk with a drawer: t top, e top edge, f front, d drawer, k handle, h shading row, o outline. */
  desk: {
    rows: [
      'oooooooooooooooooooooooooooooooo',
      'otttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttto',
      'oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo',
      'offfffffffffffffffffddddddddddfo',
      'offfffffffffffffffffdffffffffdfo',
      'offfffffffffffffffffdfffkkfffdfo',
      'offfffffffffffffffffdffffffffdfo',
      'offfffffffffffffffffddddddddddfo',
      'offffffffffffffffffffffffffffffo',
      'ohhhhhhhhhhhhhhhhhhhhhhhhhhhhhho',
      'oooooooooooooooooooooooooooooooo',
      '.oh..........................ho.',
      '.oo..........................oo.',
    ],
    palette: {
      o: '#7D8396',
      t: '#FBFCFD',
      e: '#E3E6EC',
      f: '#EEF0F4',
      d: '#C9CDD6',
      k: '#5E6478',
      h: '#C9CDD6',
    },
  },
  /** An office chair seen from the front: b back, s seat, h shading row, o frame. */
  chair: {
    rows: ['.ooooo.', 'obbbbbo', 'obbbbbo', 'ooooooo', 'ossssso', 'ohhhhho', '.o...o.'],
    palette: { o: '#2B3150', b: '#3E4560', s: '#4E567A', h: '#353B58' },
  },
  /** A meeting-room table: t top, g a runner down the middle, e edge, f front, h shading row, o outline. */
  meetingTable: {
    rows: [
      'oooooooooooooooooooooooooooooooooooooooooooo',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'ottttttggggggggggggggggggggggggggggggtttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'otttttttttttttttttttttttttttttttttttttttttto',
      'oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo',
      'offffffffffffffffffffffffffffffffffffffffffo',
      'offffffffffffffffffffffffffffffffffffffffffo',
      'ohhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhho',
      'oooooooooooooooooooooooooooooooooooooooooooo',
      '.oh......................................ho.',
      '.oo......................................oo.',
    ],
    palette: { o: '#7D8396', t: '#FBFCFD', g: '#EEF0F4', e: '#E3E6EC', f: '#DADDE5', h: '#B9BECA' },
  },
  /** A wall window: w sky highlight, g glass, h sill shade, o frame. */
  window: {
    rows: [
      'oooooooooooooooooooooo',
      'owwwwwwwwwowwwwwwwwwwo',
      'ogggggggggoggggggggggo',
      'ohhhhhhhhhohhhhhhhhhho',
      'oooooooooooooooooooooo',
    ],
    palette: { o: '#4A5170', w: '#CFEAF5', g: '#9FD3EA', h: '#7DBFD9' },
  },
  /** A low bookshelf: w wood, x shelf boards, r b y g book spines, p a plant pot, o outline. */
  shelf: {
    rows: [
      'oooooooooooooooo',
      'owwwwwwwwwwwwwwo',
      'ow.rrb.yyg.bbr.o',
      'owrrrbbyygbbbr.o',
      'owrrrbbyygbbbrwo',
      'oxxxxxxxxxxxxxxo',
      'ow.gg.rr.yyy.b.o',
      'owggbbrryyyy.bwo',
      'owggbbrryyyybbwo',
      'oxxxxxxxxxxxxxxo',
      'ow.....pp.....wo',
      'ow....pppp....wo',
      'ow....pppp....wo',
      'oxxxxxxxxxxxxxxo',
      'owwwwwwwwwwwwwwo',
      'oooooooooooooooo',
      '.o............o.',
      '.o............o.',
    ],
    palette: {
      o: '#4A3A2C',
      w: '#B98A5A',
      x: '#8A6440',
      r: '#D9534F',
      b: '#4C7BD9',
      y: '#F2C14E',
      g: '#5DBB63',
      p: '#7CC36A',
    },
  },
  /** A water cooler: l water, w a glint, f body, k taps, h shading rows, o outline. */
  waterCooler: {
    rows: [
      '..oooo..',
      '.ollllo.',
      '.ollllo.',
      '.olwllo.',
      '.ollllo.',
      '..oooo..',
      '.oooooo.',
      'offffffo',
      'offffffo',
      'offkffko',
      'offffffo',
      'offffffo',
      'ohhhhhho',
      'offffffo',
      'ohhhhhho',
      '.oooooo.',
    ],
    palette: { o: '#3E4560', l: '#9FD3EA', w: '#E6F6FC', f: '#F4F5F8', k: '#4C7BD9', h: '#C9CDD6' },
  },
  /** A two-seat sofa, calm slate fabric: b back, a arms, c cushions, h shading row, o outline. */
  sofa: {
    rows: [
      '..oooooooooooooooooooooooooo..',
      '.obbbbbbbbbbbbbbbbbbbbbbbbbbo.',
      '.obbbbbbbbbbbbbbbbbbbbbbbbbbo.',
      '.obbbbbbbbbbbbbbbbbbbbbbbbbbo.',
      'oooobbbbbbbbbbbbbbbbbbbbbboooo',
      'oaaoccccccccccocccccccccccoaao',
      'oaaoccccccccccocccccccccccoaao',
      'oaaoccccccccccccccccccccccoaao',
      'oaaooooooooooooooooooooooooaao',
      'ohhhhhhhhhhhhhhhhhhhhhhhhhhhho',
      'oooooooooooooooooooooooooooooo',
      '.o..........................o.',
    ],
    palette: { o: '#3B4A55', b: '#6F8F94', a: '#5E7C82', c: '#86A6AA', h: '#4E676C' },
  },
  /** A pale rug under the lounge: e edge, f field, s inner border, h shading row. */
  rug: {
    rows: [
      '.eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.',
      'effffffffffffffffffffffffffffffffffffffe',
      'efssssssssssssssssssssssssssssssssssssfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efsffffffffffffffffffffffffffffffffffsfe',
      'efssssssssssssssssssssssssssssssssssssfe',
      'effffffffffffffffffffffffffffffffffffffe',
      '.hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh.',
    ],
    palette: { e: '#AEB7B8', f: '#C9D0CF', s: '#B8C1C1', h: '#9EA7A8' },
  },
  /** A small white coffee table: t top, e edge, h shading row, o outline. */
  coffeeTable: {
    rows: [
      'oooooooooooooo',
      'otttttttttttto',
      'otttttttttttto',
      'oeeeeeeeeeeeeo',
      'ohhhhhhhhhhhho',
      'oooooooooooooo',
      '.o..........o.',
    ],
    palette: { o: '#7D8396', t: '#FBFCFD', e: '#E3E6EC', h: '#C9CDD6' },
  },
} as const satisfies Record<string, Sprite>;
