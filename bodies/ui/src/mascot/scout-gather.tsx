/**
 * ScoutGather: while the brain starts, Scout's head is drawn as loose specks that drift and
 * gather, then settle into the head when the brain is ready. A 2D canvas over the dock, with one
 * frame loop that runs only while it is needed. Reduced motion draws one still frame, no loop.
 * Used by DockPet; the maths is in scout-gather-math.ts.
 */

import { useEffect, useRef } from 'react';
import { themeTokens as t } from '../theme/tokens';
import { GLYPH_BOXES, GLYPH_EYES, type GlyphBox } from '../scout-mark';
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
  /** Called once the overlay has finished fading after ready, so the face can take over. */
  onDone?: () => void;
}

const TILE = 3;
/** The head fills this share of the box, as the still ScoutGlyph in ScoutFace does. */
const HEAD_SHARE = 0.7;
/** Failed stops moving once it has settled. */
const FAILED_SETTLED_MS = 1200;
/** Reduced motion: the still head's opacity per state, then a fade out on ready. */
const STILL_FADE_MS = 300;
const STILL_OPACITY = { idle: 0, starting: 0.4, failed: 0.25, ready: 0 } as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The head without its eyes (they are drawn live), from the shapes ScoutGlyph draws. */
function drawHead(ctx: CanvasRenderingContext2D, size: number) {
  const s = (size * HEAD_SHARE) / 32;
  const o = (size - size * HEAD_SHARE) / 2;
  for (const b of GLYPH_BOXES) {
    ctx.fillStyle = b.fill;
    ctx.beginPath();
    ctx.roundRect(o + b.x * s, o + b.y * s, b.w * s, b.h * s, b.r * s);
    ctx.fill();
  }
}

function drawEyes(ctx: CanvasRenderingContext2D, size: number, light: number) {
  const s = (size * HEAD_SHARE) / 32;
  const o = (size - size * HEAD_SHARE) / 2;
  ctx.globalAlpha *= light;
  ctx.fillStyle = t.color.sky;
  for (const e of GLYPH_EYES as readonly GlyphBox[]) {
    ctx.beginPath();
    ctx.roundRect(o + e.x * s, o + e.y * s, e.w * s, e.h * s, e.r * s);
    ctx.fill();
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function ScoutGather({ state, size, onDone }: ScoutGatherProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // The tiles and their colour strings, made once so no frame builds strings.
  const sampled = useRef<{ tiles: Tile[]; colours: string[] } | null>(null);
  // Where the specks were when the last state began: the next state eases on from there.
  const lastK = useRef(1);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
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
    if (sampled.current === null) {
      // Draw the head once on an offscreen canvas, then cut it into tiles.
      const off = document.createElement('canvas');
      off.width = size;
      off.height = size;
      const octx = off.getContext('2d');
      if (octx === null) return;
      drawHead(octx, size);
      const tiles = sampleTiles(octx.getImageData(0, 0, size, size).data, size, TILE);
      sampled.current = { tiles, colours: tiles.map((tile) => hex(tile.c)) };
    }
    const { tiles, colours } = sampled.current;
    const startedAt = performance.now();
    const fromK = state === 'starting' ? 0.6 : lastK.current;
    const draw = (now: number, still: boolean) => {
      clear();
      ctx.globalAlpha = still ? 1 : gatherAlpha(state, now, startedAt);
      const k = still ? 1 : gatherProgress(state, now, startedAt, fromK);
      lastK.current = k;
      tiles.forEach((tile, i) => {
        const p = speckPosition(tile, k, now, i);
        ctx.fillStyle = colours[i] ?? '#000000';
        ctx.fillRect(p.x, p.y, TILE, TILE);
      });
      drawEyes(ctx, size, still ? 0.25 : eyeLight(state, now, startedAt));
      ctx.globalAlpha = 1;
    };
    if (reduced) {
      draw(startedAt, true);
      // The still head fades out over the CSS transition, then the face may take over.
      if (state !== 'ready') return;
      const id = setTimeout(() => done.current?.(), STILL_FADE_MS);
      return () => clearTimeout(id);
    }
    let raf = 0;
    let stopped = false;
    const frame = (now: number) => {
      if (stopped) return;
      draw(now, false);
      if (state === 'ready' && gatherAlpha(state, now, startedAt) === 0) {
        clear();
        done.current?.();
      } else if (state !== 'failed' || now - startedAt <= FAILED_SETTLED_MS) {
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
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
        ...(reduced
          ? { opacity: STILL_OPACITY[state], transition: `opacity ${STILL_FADE_MS}ms ease` }
          : {}),
      }}
    />
  );
}
