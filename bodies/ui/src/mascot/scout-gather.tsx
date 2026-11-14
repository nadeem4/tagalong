/**
 * ScoutGather: while the brain starts, Scout's head is drawn as loose specks that drift and
 * gather, then settle into the head when the brain is ready. A 2D canvas over the dock, with one
 * frame loop that runs only while it is needed. Reduced motion draws one still frame, no loop.
 * Used by DockPet; the maths is in scout-gather-math.ts.
 */

import { useEffect, useRef } from 'react';
import { themeTokens as t } from '../theme/tokens';
import {
  eyeLight,
  gatherAlpha,
  gatherProgress,
  sampleTiles,
  speckPosition,
  type GatherState,
  type Tile,
} from './scout-gather-math';

export interface ScoutGatherProps {
  state: GatherState;
  size: number;
}

const TILE = 3;
/** The head fills this share of the box, as the still ScoutGlyph in ScoutFace does. */
const HEAD_SHARE = 0.7;
/** Failed stops moving once it has settled. */
const FAILED_SETTLED_MS = 1200;
/** Reduced motion: the still head's opacity per state, then a fade out on ready. */
const STILL_OPACITY = { idle: 0, starting: 0.4, failed: 0.25, ready: 0 } as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The head without its eyes (they are drawn live), in the same shapes as ScoutGlyph's 32 box. */
function drawHead(ctx: CanvasRenderingContext2D, size: number) {
  const s = (size * HEAD_SHARE) / 32;
  const o = (size - size * HEAD_SHARE) / 2;
  const box = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(o + x * s, o + y * s, w * s, h * s, r * s);
    ctx.fill();
  };
  box(15.4, 3.5, 1.2, 3.5, 0, t.color.textMuted);
  box(14.3, 1.3, 3.4, 3.4, 1.7, t.color.sky);
  box(0.8, 13, 3.2, 7.5, 1.6, t.color.keycapLine);
  box(28, 13, 3.2, 7.5, 1.6, t.color.keycapLine);
  box(3, 7, 26, 19, 7, t.color.gold);
  box(6, 10, 20, 13, 4.5, t.color.goldInk);
}

function drawEyes(ctx: CanvasRenderingContext2D, size: number, light: number) {
  const s = (size * HEAD_SHARE) / 32;
  const o = (size - size * HEAD_SHARE) / 2;
  ctx.globalAlpha *= light;
  ctx.fillStyle = t.color.sky;
  for (const x of [10.5, 17.9]) {
    ctx.beginPath();
    ctx.roundRect(o + x * s, o + 14 * s, 3.6 * s, 5.2 * s, 1.8 * s);
    ctx.fill();
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function ScoutGather({ state, size }: ScoutGatherProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tiles = useRef<Tile[] | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null) return;
    const clear = () => ctx.clearRect(0, 0, size, size);
    if (state === 'idle') {
      clear();
      return;
    }
    if (tiles.current === null) {
      // Draw the head once on an offscreen canvas, then cut it into tiles.
      const off = document.createElement('canvas');
      off.width = size;
      off.height = size;
      const octx = off.getContext('2d');
      if (octx === null) return;
      drawHead(octx, size);
      tiles.current = sampleTiles(octx.getImageData(0, 0, size, size).data, size, TILE);
    }
    const specks = tiles.current;
    const startedAt = performance.now();
    const draw = (now: number, still: boolean) => {
      clear();
      ctx.globalAlpha = still ? 1 : gatherAlpha(state, now, startedAt);
      const k = still ? 1 : gatherProgress(state, now, startedAt);
      specks.forEach((tile, i) => {
        const p = speckPosition(tile, k, now, i);
        ctx.fillStyle = hex(tile.c);
        ctx.fillRect(p.x, p.y, TILE, TILE);
      });
      drawEyes(ctx, size, still ? 0.25 : eyeLight(state, now, startedAt));
      ctx.globalAlpha = 1;
    };
    if (reduced) {
      draw(startedAt, true);
      return;
    }
    let cancelled = false;
    const frame = (now: number) => {
      if (cancelled) return;
      draw(now, false);
      const over =
        state === 'ready'
          ? gatherAlpha(state, now, startedAt) === 0
          : state === 'failed' && now - startedAt > FAILED_SETTLED_MS;
      if (state === 'ready' && over) clear();
      else if (!over) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
    };
  }, [state, size, reduced]);

  return (
    <canvas
      ref={canvas}
      data-testid="scout-gather-canvas"
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: size,
        height: size,
        pointerEvents: 'none',
        // Only reduced motion uses this: the still head fades out instead of animating.
        ...(reduced ? { opacity: STILL_OPACITY[state], transition: 'opacity 300ms ease' } : {}),
      }}
    />
  );
}
