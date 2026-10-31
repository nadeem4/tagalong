/**
 * Walkthrough step 8: you stay in charge. What Scout asks first, what it remembers, and the
 * daily spending limit, staged here and saved through the brain only on Next. Contains
 * StepEight. Words are the spec's step copy.
 */

import { useEffect, useState } from 'react';
import { useStepSave } from './use-step-save';
import type { WalkthroughHost } from './walkthrough-host';

const DEFAULT_LIMIT = 5;

/** A dollar amount as typed: finite and above 0, or null. */
function parseLimit(text: string): number | null {
  const usd = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(usd) && usd > 0 ? usd : null;
}

function LimitForm({
  host,
  start,
}: {
  host: Pick<WalkthroughHost, 'setDailyLimit'>;
  start: number;
}) {
  const [text, setText] = useState(String(start));

  useStepSave(async () => {
    const usd = parseLimit(text);
    if (usd === null) throw new Error('Enter an amount above $0.');
    if (usd !== start) await host.setDailyLimit(usd);
  });

  const step = (by: number) => {
    const now = parseLimit(text) ?? start;
    setText(String(Math.max(1, Math.round(now) + by)));
  };

  return (
    <div className="wt-row">
      <button type="button" className="wt-quiet" aria-label="Less" onClick={() => step(-1)}>
        −
      </button>
      <input
        aria-label="Daily spending limit"
        type="number"
        min="0"
        step="any"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="button" className="wt-quiet" aria-label="More" onClick={() => step(1)}>
        +
      </button>
      <span className="wt-help">US dollars a day (default ${DEFAULT_LIMIT})</span>
    </div>
  );
}

export function StepEight({
  host,
}: {
  host: Pick<WalkthroughHost, 'keyStatus' | 'setDailyLimit'>;
}) {
  const [start, setStart] = useState<number | null>(null);
  const { keyStatus } = host;

  useEffect(() => {
    // Offline, the default stands; saving a changed amount then says the brain is not there.
    keyStatus().then(
      (status) => setStart(status.dailyLimitUsd),
      () => setStart(DEFAULT_LIMIT),
    );
  }, [keyStatus]);

  return (
    <section>
      <h1>You stay in charge</h1>
      <p className="wt-lead">
        Scout reads and answers on its own. Nothing is sent, changed or handed off without your OK.
      </p>
      <div className="wt-cols">
        <ul className="wt-facts">
          <li>
            <h3>It asks first</h3>
            <p>
              When Scout wants to change something, like filing an issue in an app you’ve connected,
              a card in the bubble shows exactly what and waits for Allow once. Home &gt; Approvals
              keeps every ask and how it ended.
            </p>
          </li>
          <li>
            <h3>Daily spending limit</h3>
            {start !== null && <LimitForm host={host} start={start} />}
            <p>
              Scout’s thinking is billed to your API key. When today’s spend reaches this, Scout
              pauses until tomorrow. Home &gt; Overview shows what’s spent.
            </p>
          </li>
          <li>
            <h3>What it remembers</h3>
            <p>
              Tell Scout “I prefer short answers” and it remembers. See or delete anything in Home
              &gt; What Scout remembers, or say “Scout, forget that”.
            </p>
          </li>
        </ul>
        <div aria-hidden="true">
          <span className="wt-label">What it looks like</span>
          <div className="wt-example">
            <span className="wt-chip">File this as an issue in GitHub?</span>
            <p>App GitHub · shop-api</p>
            <p>New issue: “Empty cart throws in checkout”</p>
            <span className="wt-fake-button">Cancel</span>{' '}
            <span className="wt-fake-button">Allow once</span>
          </div>
        </div>
      </div>
    </section>
  );
}
