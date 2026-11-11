/**
 * The Timers tab on the Tasks page: one row per timer waiting to fire (its note, when it fires
 * in local time, "every N min" when it repeats) and a Cancel. The brain owns the timers; the
 * page above reads them and passes them in. Contains TimersTab.
 */
import { useState } from 'react';
import type { TimerRow } from '../shapes';
import { Button } from '../controls/button';

const WHEN: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

export function TimersTab({
  timers,
  onCancel,
}: {
  timers: TimerRow[];
  onCancel: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const cancel = (id: string): void => {
    setBusy((current) => new Set(current).add(id));
    void Promise.resolve(onCancel(id)).finally(() =>
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    );
  };
  return (
    <section className="tg-card" aria-label="Timers">
      <h2 className="tg-card__label">Timers</h2>
      {timers.length === 0 ? (
        <p>No timers.</p>
      ) : (
        <ul aria-label="Timers" className="loops-list">
          {timers.map((timer) => (
            <li key={timer.id} className="loops-row">
              <span className="loops-row__body">
                <span className="loops-row__title">{timer.note}</span>
                <span className="loops-row__meta">
                  <span className="home-time">
                    {new Date(timer.nextAt).toLocaleString('en-US', WHEN)}
                  </span>
                  {timer.repeatMinutes !== null && <span>every {timer.repeatMinutes} min</span>}
                </span>
              </span>
              {/* A fired timer Scout has not heard yet cannot be cancelled: it is already on its way. */}
              {!timer.pending && (
                <Button
                  variant="quiet"
                  aria-label={`Cancel ${timer.note}`}
                  disabled={busy.has(timer.id)}
                  onClick={() => cancel(timer.id)}
                >
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
