/**
 * The report card for an ask Scout approved under one of the person's preferences: what was
 * approved and the sentence it was approved under. Quiet by design: no Scout speech, no
 * buttons, and it leaves by itself after the same hold a quiet line gets. Used by the bubble.
 */

import { useEffect, useEffectEvent } from 'react';

export interface ApprovedNote {
  tool: string;
  text: string;
  preference: string;
}

/** How long the card stays: the quiet line's hold. */
export const APPROVED_HOLD_MS = 7_000;

export function ApprovedCard({ note, onDone }: { note: ApprovedNote; onDone: () => void }) {
  const done = useEffectEvent(onDone);
  // A newer approval replaces the note and restarts the hold.
  useEffect(() => {
    const gone = setTimeout(() => done(), APPROVED_HOLD_MS);
    return () => clearTimeout(gone);
  }, [note]);
  return (
    <section className="handoff" role="status" aria-label="Approved for you">
      <p className="bubble-text">Approved for you: {note.text}</p>
      <p className="handoff-brief">{`per '${note.preference}'`}</p>
    </section>
  );
}
