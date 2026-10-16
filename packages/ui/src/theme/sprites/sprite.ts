/**
 * A pixel-art sprite as plain data, and how to draw it. Each character in a row is one pixel:
 * `.` is transparent, any other character is looked up in the palette. Contains Sprite,
 * spriteSize and spriteShadow.
 */
export interface Sprite {
  readonly rows: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
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
  const pixels: string[] = [];
  grid.forEach((row, y) => {
    row.forEach((key, x) => {
      const color = key === '.' ? undefined : sprite.palette[key];
      if (color !== undefined) pixels.push(`${x}px ${y}px 0 0 ${color}`);
    });
  });
  return pixels.join(', ');
}
