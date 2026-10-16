/**
 * Draws a Sprite as crisp pixel art: one box-shadow per pixel on a 1px element, scaled up.
 * Contains PixelSprite. Used by the dock pet, Home and the Welcome window.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { spriteShadow, spriteSize } from './sprites/sprite';
import type { Sprite } from './sprites/sprite';

export interface PixelSpriteProps {
  sprite: Sprite;
  /** A whole number: pixel art scaled by a fraction smears. */
  scale: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Any sprite, drawn as a box-shadow on a single pixel and scaled up. Decorative: the
 * name next to it is what assistive tech reads.
 */
export function PixelSprite({ sprite, scale, className, style }: PixelSpriteProps) {
  const shadow = useMemo(() => spriteShadow(sprite), [sprite]);
  const { width, height } = spriteSize(sprite);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        position: 'relative',
        display: 'block',
        width: width * scale,
        height: height * scale,
        ...style,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          transformOrigin: '0 0',
          transform: `scale(${scale})`,
          boxShadow: shadow,
        }}
      />
    </span>
  );
}
