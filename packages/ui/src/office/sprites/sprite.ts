/**
 * A pixel-art sprite as plain data: a map of rows, a palette, and optional overlay pixels.
 *
 * Each character in a row is one pixel; `.` is transparent, any other character is looked
 * up in the palette. Overlays paint over the base map (a headset, glasses) so characters
 * can share one body and differ only in a few pixels.
 */
export interface Sprite {
  readonly rows: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
  /** `[x, y, paletteKey]` pixels painted over `rows`. */
  readonly overlay?: readonly (readonly [number, number, string])[];
}

/** The sprite's size in pixels, before scaling. */
export function spriteSize(sprite: Sprite): { width: number; height: number } {
  return {
    width: Math.max(0, ...sprite.rows.map((row) => row.length)),
    height: sprite.rows.length,
  };
}

/**
 * The sprite as a CSS `box-shadow`: one unblurred 1px shadow per painted pixel. Drawn on a
 * 1px element and scaled up with `transform`, it renders crisp pixel art with no images.
 */
export function spriteShadow(sprite: Sprite): string {
  const grid = sprite.rows.map((row) => row.split(''));
  for (const [x, y, key] of sprite.overlay ?? []) {
    const row = grid[y];
    if (row !== undefined && x >= 0 && x < row.length) row[x] = key;
  }
  const pixels: string[] = [];
  grid.forEach((row, y) => {
    row.forEach((key, x) => {
      const color = key === '.' ? undefined : sprite.palette[key];
      if (color !== undefined) pixels.push(`${x}px ${y}px 0 0 ${color}`);
    });
  });
  return pixels.join(', ');
}
