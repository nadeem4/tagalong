import { FURNITURE, monitorSprite } from './sprites/furniture';
import { spriteSize } from './sprites/sprite';
import type { Sprite } from './sprites/sprite';
import { officeTokens } from './tokens';

/**
 * Where things stand on the office floor, as data. Every coordinate is in floor pixels
 * from the top-left corner; components place things here and decide nothing themselves.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export const FLOOR = { width: 600, height: 736, wallHeight: 28 } as const;

/** The windows along the top wall. */
export const WINDOW_XS: readonly number[] = [24, 120, 216, 312, 408, 504];
/** How far below the ceiling the windows hang. */
export const WINDOW_Y = 7;

export const PLANTS: readonly Point[] = [
  { x: 252, y: 40 },
  { x: 16, y: 680 },
  { x: 252, y: 680 },
];

/** Furniture along the bottom wall, below the last row of desks. */
export const PROPS: readonly (Point & { sprite: 'shelf' | 'waterCooler' })[] = [
  { sprite: 'shelf', x: 60, y: 676 },
  { sprite: 'waterCooler', x: 196, y: 682 },
];

export interface Room extends Rect {
  name: string;
  /** How far below the room's top edge its table sits. */
  tableOffset: number;
}

/** Fixed at two until the office gets its own settings. */
export const ROOM_COUNT = 2;

export const ROOMS: readonly Room[] = [
  { name: 'ROOM 1', x: 300, y: 56, width: 272, height: 250, tableOffset: 128 },
  { name: 'ROOM 2', x: 300, y: 332, width: 272, height: 330, tableOffset: 150 },
];

export const DOOR = { width: 8, height: 52, fromBottom: 80 } as const;

/** A meeting room's table and its four chairs. */
export function roomFurniture(room: Room): { table: Point; chairs: Point[] } {
  const table = { x: room.x + 70, y: room.y + room.tableOffset };
  const chairs = [
    { x: room.x + 92, y: table.y - 18 },
    { x: room.x + 158, y: table.y - 18 },
    { x: room.x + 92, y: table.y + 62 },
    { x: room.x + 158, y: table.y + 62 },
  ];
  return { table, chairs };
}

/** Furniture sprites, scaled: what a piece covers on the floor. */
function scaled(sprite: Sprite): { width: number; height: number } {
  const { width, height } = spriteSize(sprite);
  const scale = officeTokens.spriteScale.furniture;
  return { width: width * scale, height: height * scale };
}

export const DESK_SIZE = scaled(FURNITURE.desk);

/** Two columns of desks to the left of the rooms. */
const DESK_COLUMNS = [44, 176] as const;
const FIRST_DESK_ROW = 120;
const DESK_ROW_GAP = 160;

/** As many desks as the floor holds: two columns of four rows. */
export const MAX_DESKS = 8;

/** One desk per pet, filling rows left to right. Pets past the capacity get no desk. */
export function deskLayout(petCount: number): Point[] {
  const count = Math.max(0, Math.min(petCount, MAX_DESKS));
  return Array.from({ length: count }, (_, index) => ({
    x: DESK_COLUMNS[index % DESK_COLUMNS.length] ?? 0,
    y: FIRST_DESK_ROW + Math.floor(index / DESK_COLUMNS.length) * DESK_ROW_GAP,
  }));
}

/** Where a pet sits at its desk: behind its left half, head and shoulders above the top. */
export function seatAt(desk: Point): Point {
  return { x: desk.x + 8, y: desk.y - 36 };
}

/** Where the selection cursor hops, centred above a pet. */
export function cursorAbove(seat: Point): Point {
  return { x: seat.x + 17, y: seat.y - 14 };
}

/** The monitor on a desk's right half, beside the pet, its screen facing the viewer. */
export function monitorAt(desk: Point): Rect {
  const { width, height } = scaled(monitorSprite(false));
  return { x: desk.x + 56, y: desk.y + 6 - height, width, height };
}

/** The name plate under a desk. */
export function plateAt(desk: Point): Point {
  return { x: desk.x, y: desk.y + 50 };
}

/**
 * Everything a desk owns on the floor: the cursor above the pet down to the name plate.
 * Used to prove desks never overlap each other or the rooms.
 */
export function deskFootprint(desk: Point): Rect {
  const top = cursorAbove(seatAt(desk)).y;
  const bottom = plateAt(desk).y + 14;
  return { x: desk.x, y: top, width: DESK_SIZE.width, height: bottom - top };
}
