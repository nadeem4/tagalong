/**
 * Home's "Needs you on this PC": every request a remote brain has open here, each with its own
 * buttons, so a "not now" in the bubble is never lost. Shows nothing when there are none.
 * Contains NeedsYouSection.
 */
import type { NeedsYouItem } from '../shapes';
import { Button } from '../controls/button';
import { useNeedsActions } from './use-needs-you';
import { WORDS, brainFirst } from './words';

const META = {
  failed: (item: NeedsYouItem) => item.failure ?? 'It did not finish.',
  working: (item: NeedsYouItem) => WORDS[item.need].working,
  waiting: (item: NeedsYouItem) => WORDS[item.need].meta(item),
  done: (item: NeedsYouItem) => WORDS[item.need].allowed(item),
};

function Row({ item }: { item: NeedsYouItem }) {
  const { act, notNow } = useNeedsActions();
  const working = item.state === 'working';
  const words = WORDS[item.need];
  return (
    <li className="cx-item needs-row">
      <div className="needs-row__body">
        <span className="needs-row__title">{words.title(item)}</span>
        <span className="cx-meta" role={item.state === 'failed' ? 'alert' : undefined}>
          {META[item.state](item)}
        </span>
      </div>
      {item.state !== 'done' && (
        <div className="needs-row__act">
          <Button variant="primary" disabled={working} onClick={() => void act(item.id)}>
            {item.state === 'failed' ? 'Try again' : words.does}
          </Button>
          {item.bubble && (
            <Button variant="quiet" disabled={working} onClick={() => void notNow(item.id)}>
              Not now
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function NeedsYouSection({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="tg-card" aria-labelledby="needs-you-title">
      <div className="dv-group">
        <h2 id="needs-you-title" className="tg-card__label">
          Needs you on this PC
        </h2>
        <span className="cx-meta">{items.length} waiting</span>
      </div>
      <p>
        {brainFirst(items[0]?.brain ?? '')} asked for {items.length === 1 ? 'this' : 'these'}.
        Nothing runs here until you say yes, on this PC.
      </p>
      <ul className="cx-list">
        {items.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
