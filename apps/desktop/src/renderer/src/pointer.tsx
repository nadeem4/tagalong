/**
 * The pointer window's page: the ring Scout draws round one thing on screen when it points
 * (it never clicks). Contains PointerRingView; main sends each ring.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/onest/latin-600.css';
import type { PointerRing } from '../../shared/ipc';
import './pointer.css';

/** Space between the element and the ring, so the ring frames it rather than covers it. */
const PAD = 6;

/** Room a label above the ring needs; nearer the top than this, it goes below. */
const LABEL_ROOM = 34;

/** The ring around one rect, in DIP relative to this display, with its label. Only draws. */
export function PointerRingView({
  ring,
  reducedMotion,
}: {
  ring: PointerRing;
  reducedMotion: boolean;
}) {
  const top = ring.rect.y - PAD;
  const classes = ['pointer-ring'];
  if (reducedMotion) classes.push('still');
  if (top < LABEL_ROOM) classes.push('label-below');
  return (
    <div
      className={classes.join(' ')}
      style={{
        left: ring.rect.x - PAD,
        top,
        width: ring.rect.width + PAD * 2,
        height: ring.rect.height + PAD * 2,
      }}
    >
      {ring.label === '' ? null : <span className="pointer-label">{ring.label}</span>}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The overlay page: the latest ring main sent, re-keyed so each one starts its animation over. */
function Pointer() {
  const [shown, setShown] = useState<{ ring: PointerRing; key: number } | null>(null);
  useEffect(
    () =>
      window.tagalongHost.onPointer((ring) =>
        setShown((last) => ({ ring, key: (last?.key ?? 0) + 1 })),
      ),
    [],
  );
  if (shown === null) return null;
  return (
    <PointerRingView key={shown.key} ring={shown.ring} reducedMotion={prefersReducedMotion()} />
  );
}

const root = typeof document === 'undefined' ? null : document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Pointer />
    </StrictMode>,
  );
}
