/** Edge length of the square companion window: one pet, its plate and its badges. */
export const AVATAR_SIZE = 96;

/** Breathing room between the avatar and the screen edge it docks to. */
export const AVATAR_EDGE_MARGIN = 16;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** What settings remembers: null on either axis means "dock to the default edge". */
export interface RememberedPosition {
  x: number | null;
  y: number | null;
}

/**
 * Where the avatar window goes.
 *
 * A remembered position is clamped to the current work area rather than trusted: a user
 * who unplugs the monitor the pet was sitting on would otherwise restart into an avatar
 * parked off screen, with no visible way to get it back.
 */
export function resolveAvatarPosition(saved: RememberedPosition, workArea: Rect): Point {
  const maxX = workArea.x + workArea.width - AVATAR_SIZE;
  const maxY = workArea.y + workArea.height - AVATAR_SIZE;

  if (saved.x === null || saved.y === null) {
    return {
      x: maxX - AVATAR_EDGE_MARGIN,
      y: workArea.y + Math.round((workArea.height - AVATAR_SIZE) / 2),
    };
  }

  return {
    x: Math.min(Math.max(saved.x, workArea.x), maxX),
    y: Math.min(Math.max(saved.y, workArea.y), maxY),
  };
}
