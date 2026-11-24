/**
 * Where an app or expert runs, as Home's Runs on control reads and sets it: the brain's
 * placement_list as rows keyed by kind and id, and the four choices (the brain's machine, this
 * PC, both with a first try, ask each time) mapped onto brain/src/brain/placements.py.
 * Contains parsePlacements, choiceOf, placeOf, PlacementsState, Place and RunsChoice.
 */
import { z } from 'zod';

const Wire = z.object({
  placements: z.array(
    z.object({
      kind: z.enum(['app', 'expert']),
      id: z.string(),
      mode: z.enum(['brain', 'body', 'both']),
      body_id: z.string().nullable(),
      prefer: z.enum(['body', 'brain', 'ask']).nullable(),
    }),
  ),
});

export interface Place {
  mode: 'brain' | 'body' | 'both';
  /** The node on the person's PC; null for the brain. */
  bodyId: string | null;
  prefer: 'body' | 'brain' | 'ask' | null;
}

export interface PlacementsState {
  /** The body id of the node this PC runs beside a remote brain. */
  thisPc: string;
  /** Keyed `app:<id>` or `expert:<id>`; a tool with no entry runs on the brain. */
  places: Record<string, Place>;
}

export type RunsChoice = 'brain' | 'body' | 'both' | 'ask';
export type TryFirst = 'body' | 'brain';

export const placeKey = (kind: 'app' | 'expert', id: string): string => `${kind}:${id}`;

export function parsePlacements(json: unknown, thisPc: string): PlacementsState {
  const places: Record<string, Place> = {};
  for (const row of Wire.parse(json).placements) {
    places[placeKey(row.kind, row.id)] = {
      mode: row.mode,
      bodyId: row.body_id,
      prefer: row.prefer,
    };
  }
  return { thisPc, places };
}

export function choiceOf(place: Place | undefined): { choice: RunsChoice; tryFirst: TryFirst } {
  if (place === undefined || place.mode === 'brain') return { choice: 'brain', tryFirst: 'body' };
  if (place.mode === 'body') return { choice: 'body', tryFirst: 'body' };
  if (place.prefer === 'ask') return { choice: 'ask', tryFirst: 'body' };
  return { choice: 'both', tryFirst: place.prefer ?? 'body' };
}

export function placeOf(choice: RunsChoice, tryFirst: TryFirst, thisPc: string): Place {
  if (choice === 'brain') return { mode: 'brain', bodyId: null, prefer: null };
  if (choice === 'body') return { mode: 'body', bodyId: thisPc, prefer: null };
  return { mode: 'both', bodyId: thisPc, prefer: choice === 'ask' ? 'ask' : tryFirst };
}

const WHERE_ASK = /^Where should (.+) run: on the brain, or on .+\?$/;

/** The app a brain's "where should it run" question is about, or null for any other question. */
export const whereAskApp = (summary: string): string | null => WHERE_ASK.exec(summary)?.[1] ?? null;
