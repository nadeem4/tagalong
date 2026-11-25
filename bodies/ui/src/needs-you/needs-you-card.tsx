/**
 * The bubble's card for a remote brain's request on this PC: approve a program, sign an expert
 * in or finish an app's web sign-in. Every fact on it comes from this PC; approving and signing
 * an expert in run nothing until the person clicks. Contains NeedsYouCard (one request) and
 * NeedsYouBubble (the first open one, and the line after a choice).
 */
import { useEffect, useState } from 'react';
import { Icon } from '../setup/icons';
import { DONE_HOLD_MS, type NeedsYouItem } from '../shapes';
import { useNeedsActions, useNeedsYou } from './use-needs-you';
import { PUT_OFF, WORDS, brainFirst, brainLabel } from './words';

function Facts({ item }: { item: NeedsYouItem }) {
  if (item.need === 'app_signin') {
    return (
      <p className="card-brief">
        {item.what}'s page opened in your browser. When you say yes there, it returns to this PC,
        and I pass it straight to {item.brain}. The sign-in is kept on {item.brain}, not here.
      </p>
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
  // The page is already open, so opening it again sits first and as quietly as Not now.
  const failed = item.state === 'failed';
  const again = item.need === 'app_signin' && !failed;
  const act = (
    <button
      type="button"
      className={again ? 'bubble-quiet' : 'bubble-primary'}
      disabled={working}
      onClick={onAct}
    >
      {failed ? 'Try again' : WORDS[item.need].does}
    </button>
  );
  const notNow = (
    <button type="button" className="bubble-quiet" disabled={working} onClick={onNotNow}>
      Not now
    </button>
  );
  return (
    <section className="card" aria-label="Needs you on this PC">
      <div className="card-head">
        <p className="bubble-text">{WORDS[item.need].head(item)}</p>
        <span className="card-chip">Needs you here</span>
      </div>
      {!(item.need === 'app_signin' && failed) && <Facts item={item} />}
      {item.state === 'waiting' && WORDS[item.need].waiting !== undefined && (
        <p className="card-brief">{WORDS[item.need].waiting?.(item)}</p>
      )}
      {working && <p className="card-brief">{WORDS[item.need].working}</p>}
      {failed && (
        <div className="bubble-error" role="alert">
          <Icon name="error" />
          <span>{item.failure}</span>
        </div>
      )}
      {item.need !== 'app_signin' && (
        <p className="card-brief">
          Only you can say yes, here on this PC. {brainFirst(item.brain)} cannot do it for you.
        </p>
      )}
      <div className="card-actions">
        {again ? act : notNow}
        {again ? notNow : item.canRetry !== false && act}
      </div>
    </section>
  );
}

export function NeedsYouBubble() {
  const { act, notNow } = useNeedsActions();
  const items = useNeedsYou();
  const [said, setSaid] = useState<string | null>(null);
  const item = items.find((i) => i.bubble && i.state !== 'done');
  const finished = items.find((i) => i.state === 'done');

  useEffect(() => {
    if (said === null) return;
    const gone = setTimeout(() => setSaid(null), DONE_HOLD_MS);
    return () => clearTimeout(gone);
  }, [said]);

  if (item === undefined) {
    const line = finished === undefined ? said : WORDS[finished.need].allowed(finished);
    return line === null ? null : (
      <p className="bubble-text" role="status">
        {line}
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
