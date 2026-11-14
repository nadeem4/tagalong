/**
 * The maths behind Scout gathering from specks while the brain starts: sampling the head into
 * tiles, and where each speck sits, how bright the eyes are and how visible the overlay is at a
 * time. Pure, so the canvas drawing in scout-gather.tsx stays thin. Used by ScoutGather.
 */

export type GatherState = 'idle' | 'starting' | 'ready' | 'failed';

/** One square of the head: its top-left corner and its colour packed as 0xRRGGBB. */
export interface Tile {
  x: number;
  y: number;
  c: number;
}

/** Scout is home within this long after the brain is ready. */
export const GATHER_MS = 900;
const FADE_MS = 300;
const STARTING_K = 0.6;
const FAILED_K = 0.4;
/** How far, in px, a speck sits from its tile when not gathered at all. */
const SCATTER = 36;

const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const unit = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** One tile per `tile` px square, coloured by its centre pixel; transparent ones are skipped. */
export function sampleTiles(data: Uint8ClampedArray, size: number, tile: number): Tile[] {
  const tiles: Tile[] = [];
  const mid = Math.floor(tile / 2);
  for (let y = 0; y + tile <= size; y += tile) {
    for (let x = 0; x + tile <= size; x += tile) {
      const i = ((y + mid) * size + (x + mid)) * 4;
      if ((data[i + 3] ?? 0) === 0) continue;
      tiles.push({
        x,
        y,
        c: ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0),
      });
    }
  }
  return tiles;
}

/** How gathered the specks are: 0 is scattered, 1 is the whole head. `fromK` is where it was. */
export function gatherProgress(
  state: GatherState,
  tMs: number,
  stateAtMs: number,
  fromK = STARTING_K,
): number {
  const dt = tMs - stateAtMs;
  if (state === 'idle') return 1;
  if (state === 'starting') return STARTING_K + 0.05 * Math.sin(tMs / 400);
  if (state === 'ready') return fromK + (1 - fromK) * easeOut(dt / GATHER_MS);
  return fromK - (fromK - FAILED_K) * easeOut(dt / 600);
}

/** Where a speck is drawn: its tile, plus a per-speck drift that shrinks to nothing at k=1. */
export function speckPosition(tile: Tile, k: number, tMs: number, seed: number) {
  const a = unit(seed + 1) * Math.PI * 2;
  const r = (0.4 + unit(seed + 2) * 0.6) * SCATTER * (1 - k);
  const sway = 3 * (1 - k) * Math.sin(tMs / 500 + seed);
  return { x: tile.x + Math.cos(a) * r + sway, y: tile.y + Math.sin(a) * r + sway };
}

/** The eyes: dim while the brain starts, lit once it is ready. */
export function eyeLight(state: GatherState, tMs: number, stateAtMs: number): number {
  if (state === 'ready') return 0.25 + 0.75 * easeOut((tMs - stateAtMs) / GATHER_MS);
  if (state === 'failed') return 0.1;
  return state === 'starting' ? 0.25 : 0;
}

/** The overlay's opacity: full while starting, dimmed when failed, gone just after ready. */
export function gatherAlpha(state: GatherState, tMs: number, stateAtMs: number): number {
  if (state === 'idle') return 0;
  if (state === 'starting') return 1;
  if (state === 'failed') return 0.5;
  return 1 - Math.min(1, Math.max(0, (tMs - stateAtMs - GATHER_MS) / FADE_MS));
}
