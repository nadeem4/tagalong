import { describe, expect, it } from 'vitest';
import {
  FLOOR,
  MAX_DESKS,
  PROPS,
  ROOMS,
  ROOM_COUNT,
  deskFootprint,
  deskLayout,
  monitorAt,
  seatAt,
} from './layout';
import { FURNITURE } from './sprites/furniture';
import { spriteSize } from './sprites/sprite';
import { officeTokens } from './tokens';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('deskLayout', () => {
  it('matches the office design for the first desks', () => {
    expect(deskLayout(3)).toEqual([
      { x: 44, y: 120 },
      { x: 176, y: 120 },
      { x: 44, y: 280 },
    ]);
  });

  it('gives one desk per pet, up to the floor’s capacity', () => {
    for (let count = 0; count <= MAX_DESKS; count += 1) {
      expect(deskLayout(count)).toHaveLength(count);
    }
    expect(deskLayout(MAX_DESKS + 3)).toHaveLength(MAX_DESKS);
  });

  for (let count = 1; count <= 8; count += 1) {
    it(`keeps ${count} desk(s) on the floor, clear of the rooms and of each other`, () => {
      const footprints = deskLayout(count).map(deskFootprint);
      for (const [index, desk] of footprints.entries()) {
        expect(desk.x).toBeGreaterThanOrEqual(0);
        expect(desk.y).toBeGreaterThanOrEqual(FLOOR.wallHeight);
        expect(desk.x + desk.width).toBeLessThanOrEqual(FLOOR.width);
        expect(desk.y + desk.height).toBeLessThanOrEqual(FLOOR.height);
        for (const room of ROOMS) expect(overlaps(desk, room)).toBe(false);
        for (const other of footprints.slice(index + 1)) expect(overlaps(desk, other)).toBe(false);
      }
    });
  }
});

describe('ROOMS', () => {
  it('has two rooms for now', () => {
    expect(ROOM_COUNT).toBe(2);
    expect(ROOMS).toHaveLength(ROOM_COUNT);
  });
});

describe('desk furniture', () => {
  it('stands the monitor beside the pet, so its screen faces the viewer uncovered', () => {
    for (const desk of deskLayout(MAX_DESKS)) {
      const pet = seatAt(desk);
      const monitor = monitorAt(desk);
      const petWidth = 16 * officeTokens.spriteScale.floor;
      expect(monitor.x).toBeGreaterThanOrEqual(pet.x + petWidth);
      const deskWidth = spriteSize(FURNITURE.desk).width * officeTokens.spriteScale.furniture;
      expect(monitor.x + monitor.width).toBeLessThanOrEqual(desk.x + deskWidth);
    }
  });
});

describe('PROPS', () => {
  it('furnish the floor without touching a desk, a room or the walls', () => {
    const desks = deskLayout(MAX_DESKS).map(deskFootprint);
    for (const prop of PROPS) {
      const { width, height } = spriteSize(FURNITURE[prop.sprite]);
      const scale = officeTokens.spriteScale.furniture;
      const rect = { x: prop.x, y: prop.y, width: width * scale, height: height * scale };
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(FLOOR.wallHeight);
      expect(rect.x + rect.width).toBeLessThanOrEqual(FLOOR.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(FLOOR.height);
      for (const desk of desks) expect(overlaps(rect, desk)).toBe(false);
      for (const room of ROOMS) expect(overlaps(rect, room)).toBe(false);
    }
  });
});
