/** Tests for docking, the pet window's width, the bubble's place and display scale. */

import { describe, expect, it } from 'vitest';
import {
  AVATAR_EDGE_MARGIN,
  AVATAR_SIZE,
  crossesScale,
  panelPosition,
  resolveAvatarPosition,
  stripWidth,
} from './position';

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

describe("the pet window's width", () => {
  it('is one avatar wide per visible pet, and never narrower than one', () => {
    expect(stripWidth(3)).toBe(3 * AVATAR_SIZE);
    expect(stripWidth(0)).toBe(AVATAR_SIZE);
  });

  it('keeps a wide strip on screen at the right edge', () => {
    const position = resolveAvatarPosition({ x: null, y: null }, workArea, stripWidth(3));

    expect(position.x).toBe(1920 - 3 * AVATAR_SIZE - AVATAR_EDGE_MARGIN);
    expect(resolveAvatarPosition({ x: 1900, y: 10 }, workArea, stripWidth(3)).x).toBe(
      1920 - 3 * AVATAR_SIZE,
    );
  });
});

describe('panelPosition', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const pet = { x: 1800, y: 500, width: 96, height: 96 };

  it('sits beside the pet with its bottom level with the pet’s, on the side with room', () => {
    // The pet is at the right edge, so the panel goes to its left.
    // No gap: the bubble's tail reaches across to the pet, so it reads as the pet speaking.
    expect(panelPosition(pet, { width: 420, height: 200 }, area)).toEqual({
      x: 1800 - 420,
      y: 500 + 96 - 200,
      side: 'left',
    });
  });

  it('goes to the right of a pet near the left edge', () => {
    const left = { ...pet, x: 20 };
    expect(panelPosition(left, { width: 420, height: 200 }, area)).toMatchObject({
      x: 20 + 96,
      side: 'right',
    });
  });

  it('stays inside the work area when it is taller than the space above the pet', () => {
    const high = { ...pet, y: 10 };
    expect(panelPosition(high, { width: 420, height: 520 }, area).y).toBe(0);
  });
});

describe('crossesScale', () => {
  it('says when a move goes to a display with another scale, which needs a second pass', () => {
    expect(crossesScale({ scaleFactor: 1.5 }, { scaleFactor: 1 })).toBe(true);
    expect(crossesScale({ scaleFactor: 1 }, { scaleFactor: 1 })).toBe(false);
  });
});
