/**
 * One service in the app search results: its Official version first (one press connects it),
 * then the community versions behind a toggle, each with its one-line "why" and a check card
 * before it can be connected. Contains AppGroupRow.
 */
import { useState } from 'react';
import type { AppGroup, AppRow } from '../shapes';
import { Button } from '../controls/button';
import { CheckCard } from './check-card';

function Tile({ name }: { name: string }) {
  return (
    <span className="home-conn__initial" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AppGroupRow({
  group,
  busy,
  onConnect,
  onConnectAnyway,
}: {
  group: AppGroup;
  /** Ids whose call is running; their Connect is disabled so a double press adds nothing. */
  busy: ReadonlySet<string>;
  onConnect: (row: AppRow) => void;
  onConnectAnyway: (row: AppRow) => void;
}) {
  const { official, others } = group;
  const [open, setOpen] = useState(official === null);
  const [checking, setChecking] = useState<string | null>(null);

  return (
    <li className="conn-group">
      {official !== null ? (
        <div className="home-conn__head">
          <Tile name={official.name} />
          <span className="home-entry__body">
            <span className="home-entry__title">
              {official.name} <span className="tg-chip conn-tag conn-tag--official">Official</span>
            </span>
            <span className="home-entry__preview" title={official.description}>
              {official.description}
            </span>
          </span>
          <Button
            variant="primary"
            aria-label={`Connect ${official.name}`}
            disabled={busy.has(official.id)}
            onClick={() => onConnect(official)}
          >
            Connect
          </Button>
        </div>
      ) : (
        <div className="home-conn__head">
          <Tile name={group.service} />
          <span className="home-entry__body">
            <span className="home-entry__title">{group.service}</span>
            <span className="home-entry__preview">No official version</span>
          </span>
        </div>
      )}

      {official !== null && others.length > 0 && (
        <Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide other versions' : `Show ${others.length} other versions`}
        </Button>
      )}

      {open && (
        <ul className="home-conns__list conn-group__others">
          {others.map((row) => (
            <li key={row.id} className="home-conn">
              <div className="home-conn__head">
                <span className="home-entry__body">
                  <span className="home-entry__title" title={row.id}>
                    {row.id} <span className="tg-chip conn-tag">Community</span>
                  </span>
                  {row.why !== undefined && <span className="home-entry__preview">{row.why}</span>}
                  <span className="home-entry__preview">
                    {row.publisher} ·{' '}
                    {row.runs === 'hosted'
                      ? `Hosted by ${row.host ?? 'a remote server'}`
                      : 'Runs on your PC'}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  aria-label={`Connect ${row.id}`}
                  disabled={busy.has(row.id)}
                  onClick={() => setChecking(row.id)}
                >
                  Connect
                </Button>
              </div>
              {checking === row.id && (
                <CheckCard
                  row={row}
                  busy={busy.has(row.id)}
                  onConnect={() => {
                    setChecking(null);
                    onConnectAnyway(row);
                  }}
                  onBack={() => setChecking(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
