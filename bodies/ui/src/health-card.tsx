/**
 * The health card in the bubble: a headline, then one row per check with a dot, a plain
 * line and Fix it or Set up, and Open logs folder. Contains HealthCard.
 */

import { healthHeadline } from './health';
import type { FixTarget, HealthRow } from './health';
import { themeTokens as t } from './theme/tokens';

/** The words beside each dot, so a state never rests on colour alone. */
const STATE_WORDS: Record<HealthRow['state'], string> = {
  ok: 'Working',
  broken: 'Needs you',
  info: 'Optional',
  unknown: 'Not checked',
};

/**
 * "Scout, what's wrong?": a headline, then one row per check with a dot and a plain line.
 * A broken row has Fix it; an optional one (voice off) has Set up. `rows` is
 * null while the facts are still being read. Without `onFix` the card only reports.
 * `onOpenLogs` adds Open logs folder, so the person chooses what log to send.
 */
export function HealthCard({
  rows,
  onFix,
  onOpenLogs,
}: {
  rows: readonly HealthRow[] | null;
  onFix?: (target: FixTarget) => void;
  onOpenLogs?: () => void;
}) {
  return (
    <section className="card health" aria-label="Health check">
      <style>{HEALTH_CSS}</style>
      {rows === null ? (
        <p className="bubble-text" role="status">
          Checking…
        </p>
      ) : (
        <>
          <p className="bubble-text">{healthHeadline(rows)}</p>
          <ul className="health-rows">
            {rows.map((row) => (
              <li key={row.id} className="health-row" data-state={row.state}>
                <span className="health-dot" aria-hidden="true" />
                <span className="health-what">
                  <strong>{row.label}</strong>
                  <span className="bubble-sr"> ({STATE_WORDS[row.state]}): </span>
                  <span>{row.line}</span>
                </span>
                {row.fix !== undefined && onFix !== undefined && (
                  <button
                    type="button"
                    className={
                      row.state === 'broken' ? 'bubble-primary health-fix' : 'bubble-quiet'
                    }
                    aria-label={`${row.state === 'broken' ? 'Fix' : 'Set up'} ${row.label}`}
                    onClick={() => onFix(row.fix as FixTarget)}
                  >
                    {row.state === 'broken' ? 'Fix it' : 'Set up'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {onOpenLogs !== undefined && (
            <button type="button" className="bubble-quiet health-logs" onClick={onOpenLogs}>
              Open logs folder
            </button>
          )}
        </>
      )}
    </section>
  );
}

const HEALTH_CSS = `
.health-rows { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.health-row { display: flex; align-items: center; gap: 10px; font-size: 13px; line-height: 1.45; }
.health-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: ${t.color.fieldLine}; }
.health-row[data-state='ok'] .health-dot { background: #7FD1A4; }
.health-row[data-state='broken'] .health-dot { background: #FF8A9A; }
.health-row[data-state='info'], .health-row[data-state='unknown'] { color: ${t.color.textMuted}; }
.health-what { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.health-what strong { font-size: 12px; font-weight: 600; }
.health-fix { height: 28px; padding: 0 12px; font-size: 12px; }
.health-logs { align-self: flex-start; font-size: 12px; }
`;
