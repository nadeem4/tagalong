/**
 * The "How Scout reads your screen" group inside Home's "Where things run": one row per way
 * Scout reads this PC (window text, text from pictures) with a Working / Needs a fix / Not
 * working chip, plain words first and the engine second. A missing language pack gets a short
 * box with "Ask Scout to fix it" and a Windows Settings link. Contains ReadingRows.
 */

import type { ReadingRowView } from '../shapes';
import { Button } from '../controls/button';
import { useHostBridge } from '../host-bridge';

// Words always sit beside the colour; these reuse the app chips' look.
const CHIP: Record<ReadingRowView['state'], { chip: string; dot: string }> = {
  working: { chip: 'tg-chip tg-chip--ok', dot: 'home-dot' },
  'needs-language-pack': { chip: 'tg-chip tg-chip--warn', dot: 'home-dot home-dot--warn' },
  'not-working': { chip: 'tg-chip tg-chip--err', dot: 'home-dot home-dot--err' },
};

// What Home says as the person, so Scout's own ask still gates the install.
const FIX_REQUEST = 'Fix text from pictures';

export function ReadingRows({ rows }: { rows: ReadingRowView[] }) {
  const bridge = useHostBridge();
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="tg-card__group">How Scout reads your screen</h3>
      {rows.map((row) => {
        const look = CHIP[row.state];
        return (
          <div key={row.capability} className="home-reading">
            <p className="tg-card__row tg-card__row--app">
              <span className="home-conn__initial" aria-hidden="true">
                {row.title.slice(0, 1)}
              </span>
              <span className="home-entry__body">
                <strong>{row.title}</strong>
                <span className="home-entry__preview">
                  {row.engineLabel} · {row.whereLabel}
                </span>
              </span>
              <span className={look.chip}>
                <span className={look.dot} aria-hidden="true" /> {row.stateLabel}
              </span>
            </p>
            {row.state !== 'working' && (
              <div className="home-reading__fix">
                <p>{row.plain}</p>
                {(row.fixable || row.capability === 'text-from-pictures') && (
                  <div className="home-reading__actions">
                    {row.fixable && (
                      <Button variant="primary" onClick={() => void bridge.askScout(FIX_REQUEST)}>
                        Ask Scout to fix it
                      </Button>
                    )}
                    {row.capability === 'text-from-pictures' && (
                      <button
                        type="button"
                        className="job-overview__link"
                        onClick={() => void bridge.openLanguageSettings()}
                      >
                        Do it myself in Windows Settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
