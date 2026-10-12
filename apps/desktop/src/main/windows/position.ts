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

/** The crew strip is one avatar wide per visible pet, and never narrower than one. */
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

/** Gap between the pet and its panel, so the pet is not covered by its own bubble. */
export const PANEL_GAP = 12;

/**
 * Where the panel goes: beside the pet, on whichever side has room, with its bottom level
 * with the pet's so a short bubble reads as the pet speaking. Clamped to the work area.
 */
export function panelPosition(
  pet: Rect,
  panel: { width: number; height: number },
  workArea: Rect,
): Point {
  const toTheRight = pet.x + pet.width + PANEL_GAP;
  const x =
    toTheRight + panel.width <= workArea.x + workArea.width
      ? toTheRight
      : pet.x - panel.width - PANEL_GAP;
  const y = pet.y + pet.height - panel.height;
  return {
    x: Math.max(x, workArea.x),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - panel.height),
  };
}
