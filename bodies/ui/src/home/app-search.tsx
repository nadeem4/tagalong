/**
 * "Add an app" on Home's Connections page: the search box (read 300 ms after typing stops), the
 * curated Popular list with Show more, results grouped per service with Show more, the empty
 * state and "Add it yourself". The brain does the finding, tagging and grouping; this only asks
 * and shows. Only the newest request may write results. Contains AppSearch.
 */
import { useEffect, useRef, useState } from 'react';
import type { AppAddParams, AppGroup, AppRow } from '../shapes';
import { Button } from '../controls/button';
import { useHostBridge } from '../host-bridge';
import { Icon } from '../setup/icons';
import { SearchField } from '../setup/search-field';
import { AddForm } from './add-form';
import { AppGroupRow } from './app-group-row';
import { useOutcomes, type Outcome } from './outcome';

const DEBOUNCE_MS = 300;
const UNREACHABLE = "Scout couldn't load the app list. Check your internet and try again.";

export function AppSearch({
  busy,
  refresh,
  offline,
  onAdd,
  onAddAnyway,
  onAddApp,
}: {
  /** The brain is away: the page already says so once, so the list error stays quiet. */
  offline: boolean;
  /** Ids whose call is running; they show "Waiting for you…". */
  busy: ReadonlySet<string>;
  /** Changes when the apps changed (an add finished): search again, the list has moved on. */
  refresh: number;
  onAdd: (row: AppRow, query: string) => Promise<Outcome | null>;
  onAddAnyway: (row: AppRow, query: string) => Promise<Outcome | null>;
  onAddApp: (params: AppAddParams) => Promise<boolean>;
}) {
  const bridge = useHostBridge();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [popular, setPopular] = useState<AppRow[]>([]);
  const [popularMore, setPopularMore] = useState<AppRow[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [byHand, setByHand] = useState(false);
  const { outcomes, track, clear } = useOutcomes();
  const latest = useRef(0);
  // While an outcome is on a row, the brain no longer lists that app; keep the list as it is.
  const frozen = useRef(false);
  useEffect(() => {
    frozen.current = outcomes.size > 0;
  }, [outcomes]);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (frozen.current) return;
    const mine = ++latest.current;
    setLoading(true);
    bridge.setupOverview(term === '' ? undefined : term).then(
      (overview) => {
        if (mine !== latest.current) return;
        setUnreachable(false);
        setSettled(true);
        setLoading(false);
        setPopular(overview.popular);
        setPopularMore(overview.popularMore);
        setGroups(overview.appGroups);
        setCursor(overview.nextCursor);
      },
      () => {
        if (mine !== latest.current) return;
        // A failed search shows its one line, never the list of an earlier search beside it.
        setUnreachable(true);
        setLoading(false);
        setPopular([]);
        setPopularMore([]);
        setGroups([]);
        setCursor(null);
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
  // Until the newest search has answered, the last list stays, dimmed, so the card does not jump.
  const pending = typing && (loading || term !== text.trim());
  const rowFor = (app: AppRow) => (
    <AppGroupRow
      key={app.id}
      group={{
        service: app.name,
        official: app.official ? app : null,
        others: app.official ? [] : [app],
      }}
      busy={busy}
      outcomes={outcomes}
      onAdd={(chosen) => void track(chosen.id, onAdd(chosen, term))}
      onAddAnyway={(chosen) => void track(chosen.id, onAddAnyway(chosen, term))}
    />
  );
  const empty = !pending && term !== '' && settled && !unreachable && groups.length === 0;

  return (
    <>
      <SearchField
        label="Search apps"
        placeholder="Notion, Linear, a calendar…"
        value={text}
        onChange={(value) => {
          setText(value);
          clear();
        }}
        loading={pending}
        note={typing && !pending && groups.length > 0 ? `Results for "${term}"` : undefined}
      />

      {unreachable && !offline && (
        <p className="tg-error" role="alert">
          {UNREACHABLE}
        </p>
      )}

      {byHand ? (
        <AddForm onAdd={onAddApp} onCancel={() => setByHand(false)} />
      ) : (
        <>
          {(!typing || (pending && groups.length === 0)) && popular.length > 0 && (
            <section aria-label="Popular" className={typing ? 'cx-section cx-stale' : 'cx-section'}>
              <p className="cx-group-label">Popular</p>
              <ul className="cx-list">
                {popular.map(rowFor)}
                {showMore && popularMore.map(rowFor)}
              </ul>
            </section>
          )}

          {groups.length > 0 && (
            <ul aria-label="Results" className={pending ? 'cx-list cx-stale' : 'cx-list'}>
              {groups.map((group) => (
                <AppGroupRow
                  key={group.service}
                  group={group}
                  busy={busy}
                  outcomes={outcomes}
                  onAdd={(chosen) => void track(chosen.id, onAdd(chosen, term))}
                  onAddAnyway={(chosen) => void track(chosen.id, onAddAnyway(chosen, term))}
                />
              ))}
            </ul>
          )}

          {empty && (
            <div className="cx-empty">
              <p className="cx-empty__lead">No apps match &quot;{term}&quot;.</p>
              <p>Try another word, or add it yourself.</p>
            </div>
          )}

          <div className="cx-foot">
            {!typing && !showMore && popularMore.length > 0 && (
              <span className="cx-foot__more">
                <Button variant="secondary" onClick={() => setShowMore(true)}>
                  Show more
                </Button>
                <span className="cx-meta">{popularMore.map((app) => app.name).join(', ')}…</span>
              </span>
            )}
            {cursor !== null && (
              <Button variant="secondary" onClick={loadMore}>
                Show more
              </Button>
            )}
            <button type="button" className="cx-linkbtn" onClick={() => setByHand(true)}>
              Can&apos;t find it? Add it yourself
              <Icon name="chevRight" />
            </button>
          </div>
        </>
      )}
    </>
  );
}
