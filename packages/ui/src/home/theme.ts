import type { ComponentType } from 'react';
import type { Point } from '../office/layout';
import type { OfficeMember } from '../office/member';
import type { Sprite } from '../office/sprites/sprite';

/**
 * Home's centre scene is a theme: pure decoration. Home's chrome — the top bar, the agent
 * list, the activity view and the agent controls — sits outside it and is the same in every
 * theme. A theme is data (layout, sprites, scene tokens) plus one renderer, so adding one
 * never touches the chrome or the engine.
 */

/** Where an agent is, in engine terms. Meetings and needs-you arrive with the Meetings phase. */
export type Whereabouts =
  { kind: 'alone' } | { kind: 'meeting'; room: number } | { kind: 'needs-you' };

/** Where the scene draws one agent. */
export type Placement =
  | { agentId: string; where: 'station'; station: Point }
  | { agentId: string; where: 'room'; room: number; seat: Point; station: Point }
  | { agentId: string; where: 'marker'; station: Point; marker: Point };

/** A theme's floor plan, as data. */
export interface ThemeLayout {
  /** One station per agent in crew order: a desk, a counter, a bench. Fewer past capacity. */
  stations(count: number): readonly Point[];
  /** Where meetings happen, and their seats in the order they fill. */
  rooms: readonly { name: string; seats: readonly Point[] }[];
  /** Where the needs-you marker hangs for an agent at this station. */
  marker(station: Point): Point;
}

/** The colours a scene paints its own world with. Chrome colours are never here. */
export interface SceneTokens {
  ground: string;
  grid: string;
  wall: string;
}

export interface SceneProps {
  members: readonly OfficeMember[];
  selectedId: string | null;
  placements: readonly Placement[];
}

export interface Theme {
  id: string;
  /** What the user calls it: "Office". */
  name: string;
  layout: ThemeLayout;
  /** The scene's furniture and props, as sprite data. */
  sprites: Readonly<Record<string, Sprite>>;
  tokens: SceneTokens;
  Scene: ComponentType<SceneProps>;
}

/**
 * Maps what each agent is doing to a spot in a theme's scene: working alone at its own
 * station, in a meeting at the next free seat of its room (its station stays its own), or
 * at its station under a marker when it needs you. A room that is full or missing leaves
 * the agent at its station; an agent past the scene's capacity gets no spot.
 */
export function placeAgents(
  layout: ThemeLayout,
  agents: readonly { id: string; whereabouts: Whereabouts }[],
): Placement[] {
  const stations = layout.stations(agents.length);
  const taken = layout.rooms.map(() => 0);
  const placed: Placement[] = [];
  agents.forEach(({ id, whereabouts }, index) => {
    const station = stations[index];
    if (station === undefined) return;
    if (whereabouts.kind === 'meeting') {
      const seat = layout.rooms[whereabouts.room]?.seats[taken[whereabouts.room] ?? 0];
      if (seat !== undefined) {
        taken[whereabouts.room] = (taken[whereabouts.room] ?? 0) + 1;
        placed.push({ agentId: id, where: 'room', room: whereabouts.room, seat, station });
        return;
      }
    }
    if (whereabouts.kind === 'needs-you') {
      placed.push({ agentId: id, where: 'marker', station, marker: layout.marker(station) });
      return;
    }
    placed.push({ agentId: id, where: 'station', station });
  });
  return placed;
}
