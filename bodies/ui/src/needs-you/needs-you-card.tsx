/**
 * The bubble's card for a remote brain's request on this PC: approve a program, install an
 * expert, or sign one in. Every fact on it comes from this PC; nothing runs until the person
 * clicks. Contains NeedsYouCard (one request) and NeedsYouBubble (the first open one, and the
 * line after a choice).
 */
import { useEffect, useState } from 'react';
import type { NeedsYouItem } from '../shapes';
import { useHostBridge } from '../host-bridge';
import { useNeedsYou } from './use-needs-you';
import { ALLOWED, DO, PUT_OFF, WORKING, expertName, upFirst } from './words';

const HOLD_MS = 7_000;

function Facts({ item }: { item: NeedsYouItem }) {
  if (item.need === 'install') {
    return (
      <dl className="card-rows">
        <div>
          <dt>Installs</dt>
          <dd>{expertName(item.expert)}, from Tagalong&rsquo;s registry.</dd>
        </div>
        <div>
          <dt>Then</dt>
          <dd>It signs in with your own account, on this PC.</dd>
        </div>
      </dl>
    );
  }
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
        <dd>{item.brain}</dd>
      </div>
      <div>
        <dt>If you allow</dt>
        <dd>
          {upFirst(item.brain)} may run it whenever Scout needs it. You can take that back in
          Devices.
        </dd>
      </div>
    </dl>
  );
}

const HEAD: Record<NeedsYouItem['need'], (item: NeedsYouItem) => string> = {
  approve: (i) => `Scout on ${i.brain} wants to run ${i.what} here.`,
  install: (i) => `${expertName(i.expert)} is not on this PC yet.`,
  signin: (i) => `${expertName(i.expert)} needs you to sign in on this PC.`,
};

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
        <p className="bubble-text">{HEAD[item.need](item)}</p>
        <span className="card-chip">Needs you here</span>
      </div>
      <Facts item={item} />
      {working && <p className="card-brief">{WORKING[item.need]}</p>}
      {item.state === 'failed' && (
        <p className="card-brief" role="alert">
          {item.failure}
        </p>
      )}
      <p className="card-brief">
        Only you can say yes, here on this PC. {upFirst(item.brain)} cannot do it for you.
      </p>
      <div className="card-actions">
        <button type="button" className="bubble-quiet" disabled={working} onClick={onNotNow}>
          Not now
        </button>
        <button type="button" className="bubble-primary" disabled={working} onClick={onAct}>
          {item.state === 'failed' ? 'Try again' : DO[item.need]}
        </button>
      </div>
    </section>
  );
}

export function NeedsYouBubble() {
  const bridge = useHostBridge();
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
        bridge.needsYouAct(item.id).then(
          () => setSaid(ALLOWED(item)),
          () => undefined,
        );
      }}
      onNotNow={() => {
        void bridge.needsYouNotNow(item.id).then(() => setSaid(PUT_OFF));
      }}
    />
  );
}
