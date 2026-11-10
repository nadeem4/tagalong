/**
 * The Timers tab on the Tasks page: one row per timer waiting to fire (its note, when it fires
 * in local time, "every N min" when it repeats) and a Cancel. The brain owns the timers; the
 * page above reads them and passes them in. Contains TimersTab.
 */
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
  onCancel: (id: string) => void;
}) {
  return (
    <section className="home-card" aria-label="Timers">
      <h2 className="home-card__label">TIMERS</h2>
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
              <Button
                variant="quiet"
                aria-label={`Cancel ${timer.note}`}
                onClick={() => onCancel(timer.id)}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
