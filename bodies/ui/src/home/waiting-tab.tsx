/**
 * The Waiting tab on the Tasks page: news Scout has not told yet (each with its kind, where it
 * came from and how long it has waited, and a mark on the ones Scout gave up on), then the
 * mail-loops panel as it is. The page above reads the events and passes them in. Contains
 * WaitingTab.
 */
import type { WaitingEvent } from '../shapes';
import { LoopsPanel, waited } from './loops-panel';

export function WaitingTab({ events }: { events: WaitingEvent[] }) {
  return (
    <>
      <section className="tg-card" aria-label="Waiting">
        <h2 className="tg-card__label">Waiting</h2>
        {events.length === 0 ? (
          <p>Nothing is waiting to be told.</p>
        ) : (
          <ul aria-label="Waiting news" className="loops-list">
            {events.map((event) => (
              <li key={event.id} className="loops-row">
                <span className="loops-row__body">
                  <span className="loops-row__title">{event.gist}</span>
                  <span className="loops-row__meta">
                    <span>{event.kind}</span>
                    <span>{event.source}</span>
                    <span>{waited(event.ageS)}</span>
                    {event.gaveUp && (
                      <span className="tg-chip tg-chip--warn">Scout could not finish</span>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <LoopsPanel />
    </>
  );
}
