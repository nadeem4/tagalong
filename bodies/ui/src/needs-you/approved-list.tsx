/**
 * Devices' "Approved on this PC": what the paired brain may run here, read from this PC's own
 * list, with a revoke per line. Contains ApprovedOnThisPc.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ApprovedItem } from '../shapes';
import { Button } from '../controls/button';
import { useHostBridge } from '../host-bridge';

const day = (iso: string | undefined): string => {
  const at = iso === undefined ? null : new Date(iso);
  return at === null || Number.isNaN(at.getTime())
    ? ''
    : ` · allowed ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
};

export function ApprovedOnThisPc() {
  const bridge = useHostBridge();
  const [items, setItems] = useState<ApprovedItem[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const read = useCallback(() => {
    bridge.approvedList().then(setItems, () => setItems([]));
  }, [bridge]);
  useEffect(read, [read]);

  if (items === null) return null;
  return (
    <section className="tg-card" aria-labelledby="approved-here">
      <div className="dv-group">
        <h2 id="approved-here" className="tg-card__label">
          Approved on this PC
        </h2>
        {items.length > 0 && (
          <span className="cx-meta">
            {items.length} {items.length === 1 ? 'line' : 'lines'}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p>
          Nothing is approved yet. When Scout&rsquo;s brain wants to run something here, Scout asks
          you first, and the answer appears in this list.
        </p>
      ) : (
        <>
          <p>What other computers may run here. Nothing outside this list can run.</p>
          <ul className="cx-list">
            {items.map((item) => (
              <li className="cx-item needs-row" key={item.key}>
                {asking === item.key ? (
                  <>
                    <div className="needs-row__body">
                      <span className="needs-row__title">Stop the brain running {item.what}?</span>
                      <span className="cx-meta">
                        Jobs that need it will wait, and Scout will ask you again next time.
                      </span>
                    </div>
                    <div className="needs-row__act">
                      <Button variant="quiet" onClick={() => setAsking(null)}>
                        Keep it
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setAsking(null);
                          void bridge.approvedRevoke(item.key).then(read);
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="needs-row__body">
                      <span className="needs-row__title">{item.what}</span>
                      <span className="cx-meta">{`${item.path ?? 'An address'}${day(item.at)}`}</span>
                    </div>
                    <Button variant="quiet" onClick={() => setAsking(item.key)}>
                      Revoke
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="cx-meta">
        You can also edit this from a terminal with <code>tagalong node allow</code>. It changes the
        same list.
      </p>
    </section>
  );
}
