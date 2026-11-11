/**
 * Searching the registry for apps on Home's Connections page: the search box (read 300 ms after
 * typing stops), the Popular row while it is empty, results grouped per service and Load more.
 * The brain does the finding, tagging and grouping; this only asks and shows. Only the newest
 * request may write results. Contains AppSearch.
 */
import { useEffect, useRef, useState } from 'react';
import type { AppGroup, AppRow } from '../shapes';
import { Button } from '../controls/button';
import { useHostBridge } from '../host-bridge';
import { AppGroupRow } from './app-group-row';

const DEBOUNCE_MS = 300;
const UNREACHABLE = 'Scout couldn’t reach the registry. Check your connection and try again.';

export function AppSearch({
  busy,
  refresh,
  onConnect,
  onConnectAnyway,
}: {
  /** Ids whose call is running; their Connect is disabled. */
  busy: ReadonlySet<string>;
  /** Changes when the apps changed (a connect finished): search again, the list has moved on. */
  refresh: number;
  onConnect: (row: AppRow, query: string) => void;
  onConnectAnyway: (row: AppRow, query: string) => void;
}) {
  const bridge = useHostBridge();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [popular, setPopular] = useState<AppRow[]>([]);
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [settled, setSettled] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const mine = ++latest.current;
    bridge.setupOverview(term === '' ? undefined : term).then(
      (overview) => {
        if (mine !== latest.current) return;
        setUnreachable(false);
        setSettled(true);
        setPopular(overview.popular);
        setGroups(overview.appGroups);
        setCursor(overview.nextCursor);
      },
      () => {
        if (mine === latest.current) setUnreachable(true);
      },
    );
  }, [bridge, term, refresh]);

  const loadMore = (): void => {
    if (cursor === null) return;
    const mine = ++latest.current;
    bridge.setupOverview(term === '' ? undefined : term, cursor).then(
      (overview) => {
        if (mine !== latest.current) return;
        setGroups((now) => [...now, ...overview.appGroups]);
        setCursor(overview.nextCursor);
      },
      () => {
        if (mine === latest.current) setUnreachable(true);
      },
    );
  };

  const typing = text.trim() !== '';
  return (
    <>
      <label>
        <span className="tg-note">Search the app registry</span>
        <input
          type="search"
          aria-label="Search apps"
          placeholder="Notion, Linear, a calendar…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      {unreachable && (
        <p className="tg-note" role="status">
          {UNREACHABLE}
        </p>
      )}

      {!typing && popular.length > 0 && (
        <section aria-label="Popular">
          <h3 className="home-card__label">Popular</h3>
          <ul className="home-list home-conns__list">
            {popular.map((app) => (
              <AppGroupRow
                key={app.id}
                group={{
                  service: app.name,
                  official: app.official ? app : null,
                  others: app.official ? [] : [app],
                }}
                busy={busy}
                onConnect={(chosen) => onConnect(chosen, term)}
                onConnectAnyway={(chosen) => onConnectAnyway(chosen, term)}
              />
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <ul aria-label="Results" className="home-list home-conns__list">
          {groups.map((group) => (
            <AppGroupRow
              key={group.service}
              group={group}
              busy={busy}
              onConnect={(chosen) => onConnect(chosen, term)}
              onConnectAnyway={(chosen) => onConnectAnyway(chosen, term)}
            />
          ))}
        </ul>
      )}

      {term !== '' && settled && !unreachable && groups.length === 0 && (
        <p className="tg-note">Nothing found. Try another word, or add one by hand.</p>
      )}

      {cursor !== null && (
        <Button variant="secondary" onClick={loadMore}>
          Load more
        </Button>
      )}
    </>
  );
}
