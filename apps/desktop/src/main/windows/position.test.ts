import { describe, expect, it } from 'vitest';
import { AVATAR_EDGE_MARGIN, AVATAR_SIZE, resolveAvatarPosition } from './position';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe('resolveAvatarPosition', () => {
  it('docks to the right edge when nothing was remembered', () => {
    const position = resolveAvatarPosition({ x: null, y: null }, workArea);

    expect(position.x).toBe(1920 - AVATAR_SIZE - AVATAR_EDGE_MARGIN);
    expect(position.y).toBe(Math.round((1040 - AVATAR_SIZE) / 2));
  });

  it('honours a remembered position', () => {
    expect(resolveAvatarPosition({ x: 300, y: 200 }, workArea)).toEqual({ x: 300, y: 200 });
  });

  it('pulls a position back on screen after the display layout changed', () => {
    const position = resolveAvatarPosition({ x: 4000, y: -500 }, workArea);

    expect(position.x).toBe(1920 - AVATAR_SIZE);
    expect(position.y).toBe(0);
  });

  it('respects a work area that does not start at the origin', () => {
    const secondary = { x: 1920, y: 0, width: 1280, height: 720 };

    const position = resolveAvatarPosition({ x: null, y: null }, secondary);

    expect(position.x).toBe(1920 + 1280 - AVATAR_SIZE - AVATAR_EDGE_MARGIN);
  });
});
