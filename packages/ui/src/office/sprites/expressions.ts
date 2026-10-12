import type { Sprite } from './sprite';

/** What the pet on the dock is doing, as its face and tag show it. */
export type DockMood = 'idle' | 'listening' | 'working' | 'done';

/**
 * Rows 4 to 7 of the shared 16x16 body (brow, eyes, muzzle top) for each mood. Only the
 * eyes move, so every character keeps its own colours and outline.
 */
const FACES: Readonly<Record<Exclude<DockMood, 'idle'>, readonly string[]>> = {
  // Eyes up and wide: it is looking at what you showed it.
  listening: ['offeeffffffeeffo', 'offeeffffffeeffo', 'offffffffffffffo', 'offllllllllllffo'],
  // Eyes down, on the task.
  working: ['offffffffffffffo', 'offffffffffffffo', 'offeeffffffeeffo', 'offllllllllllffo'],
  // A happy squint: the answer is back.
  done: ['offffffffffffffo', 'ofeffeffffeffefo', 'offeffffffffeffo', 'offllllllllllffo'],
};

/** The sprite with the face for a mood; idle, or a sprite of another shape, is left as is. */
export function withMood(sprite: Sprite, mood: DockMood): Sprite {
  if (mood === 'idle' || sprite.rows.length !== 16) return sprite;
  const rows = [...sprite.rows];
  rows.splice(4, 4, ...FACES[mood]);
  return { ...sprite, rows };
}

/** The eyes shut for a blink: a line where the eyes were. Other moods keep their own blink. */
export function withBlink(sprite: Sprite): Sprite {
  if (sprite.rows.length !== 16) return sprite;
  const rows = [...sprite.rows];
  rows.splice(5, 2, 'offffffffffffffo', 'offeeffffffeeffo'.replace(/e/g, 'o'));
  return { ...sprite, rows };
}
