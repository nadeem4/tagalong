/**
 * Home's "Needs you on this PC": every request a remote brain has open here, each with its own
 * buttons, so a "not now" in the bubble is never lost. Shows nothing when there are none.
 * Contains NeedsYouSection.
 */
import type { NeedsYouItem } from '../shapes';
import { Button } from '../controls/button';
import { useHostBridge } from '../host-bridge';
import { useNeedsYou } from './use-needs-you';
import { DO, WORKING, title, upFirst } from './words';

function Row({ item }: { item: NeedsYouItem }) {
  const bridge = useHostBridge();
  const working = item.state === 'working';
  const meta =
    item.state === 'failed'
      ? (item.failure ?? 'It did not finish.')
      : working
        ? WORKING[item.need]
        : `Asked by ${item.brain}${item.path === null ? '' : ` · ${item.path}`}`;
  return (
    <li className="cx-item needs-row">
      <div className="needs-row__body">
        <span className="needs-row__title">{title(item)}</span>
        <span className="cx-meta" role={item.state === 'failed' ? 'alert' : undefined}>
          {meta}
        </span>
      </div>
      <div className="needs-row__act">
        <Button
          variant="primary"
          disabled={working}
          onClick={() => void bridge.needsYouAct(item.id).catch(() => undefined)}
        >
          {item.state === 'failed' ? 'Try again' : DO[item.need]}
        </Button>
        {item.bubble && (
          <Button
            variant="quiet"
            disabled={working}
            onClick={() => void bridge.needsYouNotNow(item.id)}
          >
            Not now
          </Button>
        )}
      </div>
    </li>
  );
}

export function NeedsYouSection() {
  const items = useNeedsYou();
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
        {upFirst(items[0]?.brain ?? '')} asked for {items.length === 1 ? 'this' : 'these'}. Nothing
        runs here until you say yes, on this PC.
      </p>
      <ul className="cx-list">
        {items.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
