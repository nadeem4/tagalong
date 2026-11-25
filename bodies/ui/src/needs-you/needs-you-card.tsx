/**
 * The bubble's card for a remote brain's request on this PC: approve a program or
 * sign an expert in. Every fact on it comes from this PC; nothing runs until the person
 * clicks. Contains NeedsYouCard (one request) and NeedsYouBubble (the first open one, and the
 * line after a choice).
 */
import { useEffect, useState } from 'react';
import type { NeedsYouItem } from '../shapes';
import { useNeedsActions, useNeedsYou } from './use-needs-you';
import { PUT_OFF, WORDS, brainFirst, brainLabel } from './words';

const HOLD_MS = 7_000;

function Facts({ item }: { item: NeedsYouItem }) {
  if (item.need === 'signin') {
    return (
      <dl className="card-rows">
        <div>
          <dt>How</dt>
          <dd>A browser tab opens on this PC. Sign in there; Scout never sees your password.</dd>
        </div>
      </dl>
    );
  }
  return (
    <dl className="card-rows">
      <div>
        <dt>What runs</dt>
        <dd>
          {item.what}
          <small>{item.path === null ? 'Not found on this PC.' : item.path}</small>
        </dd>
      </div>
      <div>
        <dt>Asked by</dt>
        <dd>{brainLabel(item)}</dd>
      </div>
      <div>
        <dt>If you allow</dt>
        <dd>
          {brainFirst(item.brain)} may run it whenever Scout needs it. You can take that back in
          Devices.
        </dd>
      </div>
    </dl>
  );
}

export function NeedsYouCard({
  item,
  onAct,
  onNotNow,
}: {
  item: NeedsYouItem;
  onAct: () => void;
  onNotNow: () => void;
}) {
  const working = item.state === 'working';
  return (
    <section className="card" aria-label="Needs you on this PC">
      <div className="card-head">
        <p className="bubble-text">{WORDS[item.need].head(item)}</p>
        <span className="card-chip">Needs you here</span>
      </div>
      <Facts item={item} />
      {working && <p className="card-brief">{WORDS[item.need].working}</p>}
      {item.state === 'failed' && (
        <p className="card-brief" role="alert">
          {item.failure}
        </p>
      )}
      <p className="card-brief">
        Only you can say yes, here on this PC. {brainFirst(item.brain)} cannot do it for you.
      </p>
      <div className="card-actions">
        <button type="button" className="bubble-quiet" disabled={working} onClick={onNotNow}>
          Not now
        </button>
        <button type="button" className="bubble-primary" disabled={working} onClick={onAct}>
          {item.state === 'failed' ? 'Try again' : WORDS[item.need].does}
        </button>
      </div>
    </section>
  );
}

export function NeedsYouBubble() {
  const { act, notNow } = useNeedsActions();
  const items = useNeedsYou();
  const [said, setSaid] = useState<string | null>(null);
  const item = items.find((i) => i.bubble);

  useEffect(() => {
    if (said === null) return;
    const gone = setTimeout(() => setSaid(null), HOLD_MS);
    return () => clearTimeout(gone);
  }, [said]);

  if (item === undefined) {
    return said === null ? null : (
      <p className="bubble-text" role="status">
        {said}
      </p>
    );
  }
  return (
    <NeedsYouCard
      item={item}
      onAct={() => {
        void act(item.id).then((ok) => ok && setSaid(WORDS[item.need].allowed(item)));
      }}
      onNotNow={() => {
        void notNow(item.id).then(() => setSaid(PUT_OFF));
      }}
    />
  );
}
