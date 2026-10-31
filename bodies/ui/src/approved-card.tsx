/**
 * The report card for an ask Scout approved under one of the person's preferences: what was
 * approved and the sentence it was approved under. Quiet by design: no Scout speech, no
 * buttons, and it leaves by itself after the same hold a quiet line gets. Hosted by the desktop panel through ApprovedReport.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useHostBridge } from './host-bridge';

interface ApprovedNote {
  tool: string;
  text: string;
  preference: string;
  /** True when main brought the hidden panel up for this card, so the card must hide it again. */
  cameUp?: boolean;
}

/** How long the card stays: the quiet line's hold. */
export const APPROVED_HOLD_MS = 7_000;

/**
 * Hosts the card for the whole panel, not the bubble: a quiet line or remark shows
 * GreetingLine instead of the bubble, and the card must still appear. When main brought the
 * hidden panel up for the card (`cameUp`), `onHide` runs as the hold ends: a panel shown
 * without focus never blurs and would otherwise stay up empty.
 */
export function ApprovedReport({ onHide }: { onHide: () => void }) {
  const bridge = useHostBridge();
  const [note, setNote] = useState<ApprovedNote | null>(null);
  const opened = useRef(false);
  const arrive = useEffectEvent((next: ApprovedNote) => {
    // A second approval while the card is up keeps the first one's verdict.
    if (note === null) opened.current = next.cameUp === true;
    setNote(next);
  });
  useEffect(() => bridge.onApproved?.(arrive), [bridge]);
  if (note === null) return null;
  return (
    <ApprovedCard
      note={note}
      onDone={() => {
        setNote(null);
        if (opened.current) onHide();
        opened.current = false;
      }}
    />
  );
}

function ApprovedCard({ note, onDone }: { note: ApprovedNote; onDone: () => void }) {
  const done = useEffectEvent(onDone);
  // A newer approval replaces the note and restarts the hold.
  useEffect(() => {
    const gone = setTimeout(() => done(), APPROVED_HOLD_MS);
    return () => clearTimeout(gone);
  }, [note]);
  return (
    <section className="card" role="status" aria-label="Approved for you">
      <p className="bubble-text">Approved for you: {note.text}</p>
      <p className="card-brief">{`per '${note.preference}'`}</p>
    </section>
  );
}
