/**
 * The Apps tab on Home's Connections page: "Your apps" (Official, then Community, each with status,
 * on/off, Restart, Remove) and "Add an app": search the registry (Official first, a check card
 * before community) and "Add it yourself" for anything not listed. Contains AppsTab.
 */
import type { AppAddParams, AppInfo, AppRow } from '../shapes';
import { AppSearch } from './app-search';
import { ConnectionRow } from './connection-row';
import type { Outcome } from './outcome';

export function AppsTab({
  apps,
  officialIds,
  offline,
  busy,
  refresh,
  onSwitch,
  onRestart,
  onSignIn,
  onRemove,
  onAdd,
  onAddAnyway,
  onAddApp,
}: {
  apps: AppInfo[];
  /** Ids of the installed apps that are Official; null when the brain could not say, so no groups. */
  officialIds: ReadonlySet<string> | null;
  offline: boolean;
  busy: ReadonlySet<string>;
  refresh: number;
  onSwitch: (app: AppInfo) => void;
  onRestart: (app: AppInfo) => void;
  onSignIn: (app: AppInfo) => void;
  onRemove: (app: AppInfo) => void;
  onAdd: (row: AppRow, query: string) => Promise<Outcome | null>;
  onAddAnyway: (row: AppRow, query: string) => Promise<Outcome | null>;
  onAddApp: (params: AppAddParams) => Promise<boolean>;
}) {
  const rowFor = (app: AppInfo, trust: 'official' | 'community' | null) => (
    <ConnectionRow
      key={app.id}
      app={app}
      trust={trust}
      onSwitch={() => onSwitch(app)}
      onRestart={() => onRestart(app)}
      onSignIn={() => onSignIn(app)}
      onRemove={() => onRemove(app)}
    />
  );
  const official = officialIds === null ? [] : apps.filter((app) => officialIds.has(app.id));
  const community = officialIds === null ? [] : apps.filter((app) => !officialIds.has(app.id));

  return (
    <>
      <section className="home-card" aria-label="Your apps">
        <h2 className="home-card__label">Your apps</h2>
        {officialIds === null && apps.length > 0 && (
          <ul aria-label="Apps" className="cx-list">
            {apps.map((app) => rowFor(app, null))}
          </ul>
        )}
        {official.length > 0 && (
          <>
            <p className="cx-group-label">Official</p>
            <ul aria-label="Official apps" className="cx-list">
              {official.map((app) => rowFor(app, 'official'))}
            </ul>
          </>
        )}
        {community.length > 0 && (
          <>
            <p className="cx-group-label">Community</p>
            <p className="cx-grp-note">
              Made by other people. Scout asks before it changes anything with them.
            </p>
            <ul aria-label="Community apps" className="cx-list">
              {community.map((app) => rowFor(app, 'community'))}
            </ul>
          </>
        )}
        {apps.length === 0 && !offline && (
          <p className="tg-note">No apps yet. Search for one below.</p>
        )}
      </section>

      <section className="home-card" aria-label="Add an app">
        <h2 className="home-card__label">Add an app</h2>
        <AppSearch
          busy={busy}
          apps={apps}
          refresh={refresh}
          offline={offline}
          onAdd={onAdd}
          onAddAnyway={onAddAnyway}
          onAddApp={onAddApp}
        />
      </section>
    </>
  );
}
