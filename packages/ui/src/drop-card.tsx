/**
 * The drop card: something dropped on Scout, with Explain, Hand it to an expert and Cancel,
 * or the refusal for a secrets file. Contains DropCard and DropOffer. Used by the bubble.
 */

import { useState } from 'react';
import type { Dropped } from '@tagalong/protocol';

/**
 * Something dropped on Scout's figure, as the card shows it: the item, named but not yet
 * read, and whether Scout may explain it (a link, a PDF or a Word file goes to an expert
 * only); or the refusal for a secrets file.
 */
export type DropOffer = { dropped: Dropped; explain: boolean } | { refusal: string };

/** What the card calls the item: the file's name, the link, or "That text". */
function labelOf(dropped: Dropped): string {
  if (dropped.kind === 'text') return 'That text';
  if (dropped.kind === 'link') return dropped.text ?? 'That link';
  return dropped.name ?? 'That file';
}

/**
 * The drop card: "report.md: want me to explain it, or hand it to an expert?" with
 * Explain, Hand it to an expert and Cancel, and a line for the person's own words.
 * Nothing is read or sent until a button is pressed; `onAsk` sends the drop with it.
 */
export function DropCard({
  offer,
  onAsk,
  onCancel,
}: {
  offer: DropOffer;
  onAsk: (text: string) => void;
  onCancel: () => void;
}) {
  const [words, setWords] = useState('');

  if ('refusal' in offer) {
    return (
      <section className="handoff" aria-label="Dropped on Scout">
        <p className="bubble-text" role="status">
          {offer.refusal}
        </p>
      </section>
    );
  }

  const { dropped, explain } = offer;
  const own = words.trim();
  const label = labelOf(dropped);
  const where = dropped.path ?? (dropped.kind === 'link' ? dropped.text : undefined);
  const handOff = (): void =>
    onAsk(
      `Hand this to an expert: ${own === '' ? 'have a look at it' : own}` +
        (where === undefined ? '' : ` (${where})`),
    );

  return (
    <section className="handoff" aria-label="Dropped on Scout">
      <p className="bubble-text">
        {label}:{' '}
        {explain
          ? 'want me to explain it, or hand it to an expert?'
          : 'want me to hand it to an expert?'}
      </p>
      <label className="bubble-field">
        <span>Add your own words (optional)</span>
        <input
          aria-label="Add your own words (optional)"
          value={words}
          onChange={(event) => setWords(event.target.value)}
        />
      </label>
      <div className="bubble-row">
        {explain && (
          <button
            type="button"
            className="bubble-primary"
            onClick={() => onAsk(own === '' ? 'Explain this.' : own)}
          >
            Explain
          </button>
        )}
        <button
          type="button"
          className={explain ? 'bubble-quiet' : 'bubble-primary'}
          onClick={handOff}
        >
          Hand it to an expert
        </button>
        <button type="button" className="bubble-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
