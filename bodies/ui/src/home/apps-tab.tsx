/**
 * The Apps tab on Home's Connections page: the Connected list (status, on/off, Restart, Remove),
 * then Add an app: search the registry (Official first, a check card before community) and, for
 * anything not listed, "Add one by hand". Contains AppsTab.
 */
import { useState } from 'react';
import type { AppAddParams, AppInfo, AppRow } from '../shapes';
import { Button } from '../controls/button';
import { AddForm } from './add-form';
import { AppSearch } from './app-search';
import { ConnectionRow } from './connection-row';

export function AppsTab({
  apps,
  offline,
  busy,
  refresh,
  onSwitch,
  onRestart,
  onSignIn,
  onRemove,
  onConnect,
  onConnectAnyway,
  onAdd,
}: {
  apps: AppInfo[];
  offline: boolean;
  busy: ReadonlySet<string>;
  refresh: number;
  onSwitch: (app: AppInfo) => void;
  onRestart: (app: AppInfo) => void;
  onSignIn: (app: AppInfo) => void;
  onRemove: (app: AppInfo) => void;
  onConnect: (row: AppRow, query: string) => void;
  onConnectAnyway: (row: AppRow, query: string) => void;
  onAdd: (params: AppAddParams) => Promise<boolean>;
}) {
  const [byHand, setByHand] = useState(false);
  return (
    <>
      <section className="home-card" aria-label="Connected apps">
        <h2 className="home-card__label">Connected</h2>
        {apps.length > 0 && (
          <ul aria-label="Apps" className="home-list home-conns__list">
            {apps.map((app) => (
              <ConnectionRow
                key={app.id}
                app={app}
                onSwitch={() => onSwitch(app)}
                onRestart={() => onRestart(app)}
                onSignIn={() => onSignIn(app)}
                onRemove={() => onRemove(app)}
              />
            ))}
          </ul>
        )}
        {apps.length === 0 && !offline && (
          <p className="tg-note">No apps yet. Search for one below.</p>
        )}
      </section>

      <section className="home-card home-conns" aria-label="Add an app">
        <h2 className="home-card__label">Add an app</h2>
        <AppSearch
          busy={busy}
          refresh={refresh}
          onConnect={onConnect}
          onConnectAnyway={onConnectAnyway}
        />
        <Button variant="quiet" aria-expanded={byHand} onClick={() => setByHand(!byHand)}>
          Add one by hand
        </Button>
        {byHand && (
          <div className="tg-panel home-conns__form-host">
            <AddForm onAdd={onAdd} />
          </div>
        )}
      </section>
    </>
  );
}
