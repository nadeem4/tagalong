import { OfficeFloor } from '../office/office-floor';
import { ROOMS, cursorAbove, deskLayout, roomFurniture, seatAt } from '../office/layout';
import { FURNITURE } from '../office/sprites/furniture';
import { officeTokens } from '../office/tokens';
import type { Theme } from './theme';

/**
 * The Office, Home's first theme, built from the existing office floor: a desk per agent in
 * two columns, two glass meeting rooms of four chairs, and the needs-you marker where the
 * selection cursor would hop.
 */
export const officeTheme: Theme = {
  id: 'office',
  name: 'Office',
  layout: {
    stations: (count) => deskLayout(count),
    rooms: ROOMS.map((room) => ({ name: room.name, seats: roomFurniture(room).chairs })),
    marker: (desk) => cursorAbove(seatAt(desk)),
  },
  sprites: FURNITURE,
  tokens: {
    ground: officeTokens.color.floor,
    grid: officeTokens.color.floorGrid,
    wall: officeTokens.color.wall,
  },
  Scene: OfficeFloor,
};
