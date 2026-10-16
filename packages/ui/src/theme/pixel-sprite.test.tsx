/** Tests for PixelSprite: size, scale and aria-hidden. */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PixelSprite } from './pixel-sprite';
import { spriteShadow } from './sprites/sprite';

describe('PixelSprite', () => {
  const sprite = { rows: ['ab', '.a', 'b.'], palette: { a: '#111111', b: '#222222' } };

  it('takes up the sprite’s size times its scale, and hides from assistive tech', () => {
    const { container } = render(<PixelSprite sprite={sprite} scale={3} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box.style.width).toBe('6px');
    expect(box.style.height).toBe('9px');
  });

  it('paints the sprite as a box-shadow scaled up from one pixel', () => {
    const { container } = render(<PixelSprite sprite={sprite} scale={2} />);
    const pixel = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(pixel.style.boxShadow).toBe(spriteShadow(sprite));
    expect(pixel.style.transform).toBe('scale(2)');
  });
});
