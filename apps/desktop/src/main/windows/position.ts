/**
 * Where Scout's window and the bubble go: docking, a remembered position and display scale. Pure,
 * so it is tested without a screen. Contains resolveAvatarPosition, panelPosition, crossesScale and
 * stripWidth.
 */

/** Edge length of the square avatar window, in device-independent pixels. */
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

/** Scout's window is one avatar wide per visible pet, and never narrower than one. */
export function stripWidth(visiblePets: number): number {
  return Math.max(1, visiblePets) * AVATAR_SIZE;
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
export function resolveAvatarPosition(
  saved: RememberedPosition,
  workArea: Rect,
  width: number = AVATAR_SIZE,
): Point {
  const maxX = workArea.x + workArea.width - width;
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

/**
 * Where the panel goes: right against the pet, on whichever side has room, with its bottom
 * level with the pet's. There is no gap because the bubble draws a tail across its own
 * edge to the pet, so it reads as the pet speaking. `side` says which side of the pet the
 * panel is on, so the bubble knows where to draw the tail. Clamped to the work area.
 */
export function panelPosition(
  pet: Rect,
  panel: { width: number; height: number },
  workArea: Rect,
): Point & { side: 'left' | 'right' } {
  const toTheRight = pet.x + pet.width;
  const right = toTheRight + panel.width <= workArea.x + workArea.width;
  const x = right ? toTheRight : pet.x - panel.width;
  const y = pet.y + pet.height - panel.height;
  return {
    x: Math.max(x, workArea.x),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - panel.height),
    side: right ? 'right' : 'left',
  };
}

/**
 * Whether moving a window between these two displays crosses a scale factor. Electron
 * places such a move with the old display's scale, landing the window far from where it
 * was asked to go; a second, identical move once it is on the new display corrects it.
 */
export function crossesScale(from: { scaleFactor: number }, to: { scaleFactor: number }): boolean {
  return from.scaleFactor !== to.scaleFactor;
}
