import { describe, expect, it } from 'vitest';
import { placeAgents } from './theme';
import type { ThemeLayout } from './theme';
import { THEMES, themeById } from './themes';

/** A tiny layout: stations in a row, one room of two seats, the marker above a station. */
const layout: ThemeLayout = {
  stations: (count) => Array.from({ length: Math.min(count, 3) }, (_, i) => ({ x: i * 10, y: 0 })),
  rooms: [
    {
      name: 'ROOM 1',
      seats: [
        { x: 100, y: 0 },
        { x: 110, y: 0 },
      ],
    },
  ],
  marker: (station) => ({ x: station.x, y: station.y - 5 }),
};

describe('placeAgents', () => {
  it('puts an agent working alone at its own station, in crew order', () => {
    expect(
      placeAgents(layout, [
        { id: 'scout', whereabouts: { kind: 'alone' } },
        { id: 'ink', whereabouts: { kind: 'alone' } },
      ]),
    ).toEqual([
      { agentId: 'scout', where: 'station', station: { x: 0, y: 0 } },
      { agentId: 'ink', where: 'station', station: { x: 10, y: 0 } },
    ]);
  });

  it('seats agents in a meeting in that room, keeping their stations', () => {
    const placed = placeAgents(layout, [
      { id: 'scout', whereabouts: { kind: 'meeting', room: 0 } },
      { id: 'ink', whereabouts: { kind: 'meeting', room: 0 } },
    ]);
    expect(placed).toEqual([
      { agentId: 'scout', where: 'room', room: 0, seat: { x: 100, y: 0 }, station: { x: 0, y: 0 } },
      { agentId: 'ink', where: 'room', room: 0, seat: { x: 110, y: 0 }, station: { x: 10, y: 0 } },
    ]);
  });

  it('keeps an agent at its station when the room is full or does not exist', () => {
    const placed = placeAgents(layout, [
      { id: 'a', whereabouts: { kind: 'meeting', room: 0 } },
      { id: 'b', whereabouts: { kind: 'meeting', room: 0 } },
      { id: 'c', whereabouts: { kind: 'meeting', room: 0 } },
    ]);
    expect(placed[2]).toEqual({ agentId: 'c', where: 'station', station: { x: 20, y: 0 } });
    expect(
      placeAgents(layout, [{ id: 'a', whereabouts: { kind: 'meeting', room: 4 } }])[0],
    ).toEqual({ agentId: 'a', where: 'station', station: { x: 0, y: 0 } });
  });

  it('marks an agent that needs you above its station', () => {
    expect(placeAgents(layout, [{ id: 'scout', whereabouts: { kind: 'needs-you' } }])).toEqual([
      { agentId: 'scout', where: 'marker', station: { x: 0, y: 0 }, marker: { x: 0, y: -5 } },
    ]);
  });

  it('leaves an agent past the scene’s capacity unplaced', () => {
    const crew = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      whereabouts: { kind: 'alone' as const },
    }));
    expect(placeAgents(layout, crew).map((p) => p.agentId)).toEqual(['a', 'b', 'c']);
  });
});

describe('the theme registry', () => {
  it('ships one theme, the Office, and finds it by id', () => {
    expect(THEMES.map((theme) => [theme.id, theme.name])).toEqual([['office', 'Office']]);
    expect(themeById('office')).toBe(THEMES[0]);
    // An unknown or retired theme falls back to the Office rather than an empty scene.
    expect(themeById('restaurant')).toBe(THEMES[0]);
  });

  it('builds the Office from today’s floor: two columns of desks and two rooms of four', () => {
    const office = themeById('office');
    expect(office.layout.stations(3)).toEqual([
      { x: 44, y: 120 },
      { x: 176, y: 120 },
      { x: 44, y: 280 },
    ]);
    expect(office.layout.rooms.map((room) => [room.name, room.seats.length])).toEqual([
      ['ROOM 1', 4],
      ['ROOM 2', 4],
    ]);
    expect(office.tokens.ground).toBe('#DCDBD7');
  });
});
