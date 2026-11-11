/**
 * Home's Connections page, two tabs. Apps: "Your apps", then a registry search (Official first, a
 * check card before community) and Add it yourself. Experts: the installed coding agents and the
 * registry's. The brain owns every list and the keys; this page only asks and reads again, and
 * hands each add's outcome back to the row that was pressed. Contains ConnectionsPanel; the tabs
 * are apps-tab.tsx and experts-tab.tsx, the add form add-form.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppAddParams, AppInfo, AppRow, SetupOverview, SetupResult } from '../shapes';
import { failure } from '../failure';
import { useHostBridge } from '../host-bridge';
import { Button } from '../controls/button';
import { AppsTab } from './apps-tab';
import { ExpertsTab } from './experts-tab';
import { JobTabs, panelId, tabId } from './job-tabs';
import type { Outcome } from './outcome';

type Status = { text: string; error: boolean } | null;
type Tab = 'apps' | 'experts';
const TABS = [
  { id: 'apps', label: 'Apps' },
  { id: 'experts', label: 'Experts' },
];

const BRAIN_OFFLINE = 'brain offline';

// The page's own words for what the brain answers with a short token. A refusal that is not a
// problem (the person said no, it is already done) is a note; the rest are errors.
type Words = { text: string; error: boolean };
const SETUP_REFUSALS: Record<string, Words> = {
  denied: { text: 'Okay, nothing was changed.', error: false },
  already_installing: { text: 'That is already being set up.', error: false },
  already_ready: { text: 'That is already set up.', error: false },
  already_added: { text: 'That app is already added.', error: false },
  already_logged_in: { text: 'Already logged in.', error: false },
  version_changed: {
    text: 'The list changed while you were deciding. Have another look, then try again.',
    error: true,
  },
  registry_unavailable: {
    text: "Scout couldn't load the app list. Check your internet and try again.",
    error: true,
  },
};
const LOGIN_WAITING = 'Finish logging in in the window that opened.';
const SETUP_FAILED: Words = { text: 'Setting that up didn’t work.', error: true };

/**
 * Home's Connections page. Scout reads with an app on its own and asks before every change;
 * which tools ask is set in Permissions, not here.
 */
export function ConnectionsPanel() {
  const bridge = useHostBridge();
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [offline, setOffline] = useState(false);
  const [setup, setSetup] = useState<SetupOverview | null>(null);
  const [asking, setAsking] = useState<ReadonlySet<string>>(new Set());
  const [tab, setTab] = useState<Tab>('apps');
  // Counts finished changes so the app search reads again; not bumped on first load.
  const [refresh, setRefresh] = useState(0);
  const [setupFailed, setSetupFailed] = useState(false);

  const reloadSetup = useCallback(() => {
    // A failure is shown on the Experts tab as one plain line; the apps list says when the brain is away.
    bridge.setupOverview().then(
      (latest) => {
        setSetupFailed(false);
        setSetup(latest);
      },
      () => {
        setSetup(null);
        setSetupFailed(true);
      },
    );
  }, [bridge]);

  const reload = useCallback(() => {
    reloadSetup();
    bridge
      .listConnections()
      .then((latest) => {
        setOffline(false);
        setApps(latest.apps);
      })
      .catch((error: unknown) => {
        setApps((current) => current ?? []);
        if (failure(error) === BRAIN_OFFLINE) setOffline(true);
        else setStatus({ text: failure(error), error: true });
      });
  }, [bridge, reloadSetup]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      bridge.onTurnEvent((event) => {
        if (event.type === 'connections.changed') {
          setRefresh((n) => n + 1);
          reload();
        }
      }),
    [bridge, reload],
  );
  // An install moves on (progress, done, failed): read the overview again.
  useEffect(
    () => bridge.onBrainChanged((what) => what === 'setup' && reloadSetup()),
    [bridge, reloadSetup],
  );

  if (apps === null) return <p className="home-note">Loading connections…</p>;

  // Run a call, then read the list again whatever it said: the brain is the truth.
  const act = async (call: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setStatus(null);
    try {
      await call();
      if (done !== undefined) setStatus({ text: done, error: false });
      return true;
    } catch (error) {
      // Offline gets the note under the intro, not a second red line.
      if (failure(error) === BRAIN_OFFLINE) setOffline(true);
      else setStatus({ text: failure(error), error: true });
      return false;
    } finally {
      setRefresh((n) => n + 1);
      reload();
    }
  };

  // The call returns once the person has answered the Allow card; until then the row waits. How it
  // ended goes back to the row that was pressed, not to the top of the page.
  const setUp = async (
    id: string,
    call: () => Promise<SetupResult>,
    added?: string,
  ): Promise<Outcome | null> => {
    setAsking((now) => new Set(now).add(id));
    let outcome: Outcome | null = null;
    await act(async () => {
      try {
        const { error, state } = await call();
        if (error !== undefined) {
          outcome = { ...(SETUP_REFUSALS[error] ?? SETUP_FAILED), added: false };
        } else if (state === 'waiting') {
          outcome = { text: LOGIN_WAITING, error: false, added: false };
        } else if (state === 'logged_in') {
          outcome = { text: 'Already logged in.', error: false, added: false };
        } else if (added !== undefined) {
          outcome = { text: added, error: false, added: true };
        }
      } finally {
        setAsking((now) => {
          const next = new Set(now);
          next.delete(id);
          return next;
        });
      }
    });
    return outcome;
  };

  const officialIds =
    setup === null ? null : new Set(setup.apps.filter((app) => app.official).map((app) => app.id));

  const add = (params: AppAddParams): Promise<boolean> =>
    act(() => bridge.addConnection(params), `${params.name} added.`);

  return (
    <>
      <div className="home-head">
        <h1 className="home-title">Connections</h1>
        <p>Apps and experts Scout can use for you. Turn one off and Scout stops using it.</p>
      </div>
      {offline && (
        <p className="tg-note" role="status">
          {apps.length > 0
            ? 'Scout’s brain isn’t running, so this list may be out of date. Start it, then try again.'
            : 'Scout’s brain isn’t running, so your apps can’t be shown. Start it, then try again.'}{' '}
          <Button variant="quiet" onClick={reload}>
            Try again
          </Button>
        </p>
      )}
      {status !== null && (
        <p
          className={status.error ? 'tg-error' : 'tg-note'}
          role={status.error ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      )}
      <JobTabs
        tabs={TABS}
        selected={tab}
        onSelect={(id) => setTab(id as Tab)}
        label="Connections sections"
      />
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === 'apps' && (
          <AppsTab
            apps={apps}
            officialIds={officialIds}
            offline={offline}
            busy={asking}
            refresh={refresh}
            onSwitch={(app) => void act(() => bridge.setConnectionEnabled(app.id, !app.enabled))}
            onRestart={(app) => void act(() => bridge.restartConnection(app.id))}
            onSignIn={(app) => void act(() => bridge.signInConnection(app.id))}
            onRemove={(app) =>
              void act(() => bridge.removeConnection(app.id), `${app.name} removed.`)
            }
            onAdd={(row: AppRow, query) =>
              setUp(
                row.id,
                () => bridge.setupApp(row.id, true, query || undefined),
                `${row.name} added.`,
              )
            }
            onAddAnyway={(row: AppRow, query) =>
              setUp(
                row.id,
                () => bridge.setupApp(row.id, true, query || undefined, true),
                `${row.name} added.`,
              )
            }
            onAddApp={add}
          />
        )}
        {tab === 'experts' && setup === null && setupFailed && !offline && (
          <p className="tg-note" role="status">
            {SETUP_REFUSALS['registry_unavailable']?.text}
          </p>
        )}
        {tab === 'experts' && setup !== null && (
          <ExpertsTab
            setup={setup}
            asking={asking}
            onAct={(id) => setUp(id, () => bridge.setupExpert(id, false))}
            onAdd={(id) => setUp(id, () => bridge.setupExpert(id, false))}
            onAddAnyway={(id) => setUp(id, () => bridge.setupExpert(id, true, true))}
          />
        )}
      </div>
    </>
  );
}
