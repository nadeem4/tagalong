/**
 * Walkthrough step 10: connect your tools. The apps the everyday jobs need (Gmail, Google
 * Calendar, Notion) and Claude Code for long jobs, as the same rows the Connections page draws.
 * Nothing here blocks Finish. Also holds readyOf, which turns the same overview into the finish
 * card's "Ready to use" list. Contains StepTen, readyOf and ReadyItem.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../controls';
import { JOB_KINDS } from '../jobs-kinds';
import type { AppRow, SetupOverview } from '../shapes';
import type { WalkthroughHost } from './walkthrough-host';

const EXPERT = 'claude-acp';
const EXPERT_NAME = 'Claude Code';
const EXPERT_JOB = 'Fix this code, and other long, many-step jobs';

/** The tour's apps: `key` is matched (lowercase, contained) against registry and saved names. */
const APPS: readonly { key: string; name: string }[] = [
  ...JOB_KINDS.flatMap((j) => (j.app ? [j.app] : [])),
  { key: 'notion', name: 'Notion' }, // no job needs it, it is just a popular one
];

const SIGN_IN: Record<AppRow['signIn'], string> = {
  browser: 'Browser sign-in',
  key: 'API key',
  none: '',
};
// The step's own words for what the brain reports as short tokens.
const STAGE_LINE = 'Getting what it needs to run';
const APP_FAILURES: Record<string, string> = {
  denied: 'You said no, so nothing was added.',
  already_added: 'That one is already connected.',
};
const APP_FAILED_GENERIC = 'It didn’t connect. Check your connection and try again.';
const EXPERT_FAILED = 'It didn’t finish installing. Check your connection and try again.';
const OFFLINE =
  'Tagalong could not read this. You can connect your tools later in Home, under Connections.';

export interface ReadyItem {
  name: string;
  state: 'connected' | 'installing' | 'signin';
}

const named = (value: string, key: string) => value.toLowerCase().includes(key);

/** What the tour set up, for the finish card: connected tour apps, and Claude Code in its state. */
export function readyOf(overview: SetupOverview): ReadyItem[] {
  const list: ReadyItem[] = [];
  for (const app of APPS) {
    const saved = overview.apps.find((a) => named(a.name, app.key) || named(a.id, app.key));
    if (saved?.state === 'connected') list.push({ name: app.name, state: 'connected' });
  }
  const expert = overview.experts.find((e) => e.id === EXPERT);
  if (overview.progress?.expert === EXPERT) list.push({ name: EXPERT_NAME, state: 'installing' });
  else if (expert !== undefined)
    list.push({
      name: EXPERT_NAME,
      state: expert.state === 'needs_login' ? 'signin' : 'connected',
    });
  return list;
}

/** Every row the overview offers for a search, the Official one of a service first. */
function rowsOf(overview: SetupOverview): AppRow[] {
  const grouped = overview.appGroups.flatMap((g) =>
    g.official ? [g.official, ...g.others] : g.others,
  );
  return [...overview.popular, ...grouped];
}

function Tile({ name }: { name: string }) {
  return (
    <span className="cx-tile" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Waiting() {
  return (
    <span className="cx-waiting">
      <span className="cx-spin" aria-hidden="true" />
      Waiting for you…
    </span>
  );
}

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="wt-group">
      <div className="wt-group__head">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      <ul className="cx-list wt-group__card">{children}</ul>
    </div>
  );
}

export function StepTen({
  host,
}: {
  host: Pick<WalkthroughHost, 'setupOverview' | 'setupExpert' | 'setupApp' | 'onBrainChanged'>;
}) {
  const { setupOverview, setupExpert, setupApp, onBrainChanged } = host;
  const [overview, setOverview] = useState<SetupOverview | null>(null);
  const [offline, setOffline] = useState(false);
  // Per app key, the registry row its own search found (asked once, on arrival).
  const [found, setFound] = useState<Record<string, AppRow | undefined>>({});
  // Per app key: connecting now, or the plain words for why it did not connect.
  const [connect, setConnect] = useState<Record<string, { busy: boolean; error?: string }>>({});
  const [expertBusy, setExpertBusy] = useState(false);
  const [expertFailed, setExpertFailed] = useState(false);
  const pressed = useRef(new Set<string>()); // a double press sends one call

  const load = useCallback(() => {
    setupOverview().then(
      (next) => {
        setOffline(false);
        setOverview(next);
      },
      () => setOffline(true),
    );
  }, [setupOverview]);

  useEffect(load, [load]);
  // The registry's first page rarely holds a given app, so each is searched for by name.
  useEffect(() => {
    let live = true;
    for (const { key } of APPS) {
      setupOverview(key).then(
        (result) => {
          const rows = rowsOf(result).filter((r) => named(r.id, key) || named(r.name, key));
          const row = rows.find((r) => r.official);
          if (live && row !== undefined) setFound((f) => ({ ...f, [key]: row }));
        },
        () => undefined, // offline: the page already says so
      );
    }
    return () => {
      live = false;
    };
  }, [setupOverview]);
  // The brain says `changed setup` as an install moves on; read the overview again each time.
  useEffect(
    () =>
      onBrainChanged((what) => {
        if (what === 'setup') load();
      }),
    [onBrainChanged, load],
  );

  function addApp(key: string, row: AppRow): void {
    if (pressed.current.has(key)) return;
    pressed.current.add(key);
    setConnect((c) => ({ ...c, [key]: { busy: true } }));
    setupApp(row.id, key)
      .then(
        () => setConnect((c) => ({ ...c, [key]: { busy: false } })),
        (err: unknown) => {
          const error = APP_FAILURES[err instanceof Error ? err.message : ''] ?? APP_FAILED_GENERIC;
          setConnect((c) => ({ ...c, [key]: { busy: false, error } }));
        },
      )
      .finally(() => {
        pressed.current.delete(key);
        load();
      });
  }

  function pressExpert(): void {
    if (pressed.current.has(EXPERT)) return;
    pressed.current.add(EXPERT);
    setExpertBusy(true);
    setExpertFailed(false);
    setupExpert(EXPERT)
      .catch(() => setExpertFailed(true))
      .finally(() => {
        pressed.current.delete(EXPERT);
        setExpertBusy(false);
        load();
      });
  }

  const appRows = APPS.map(({ key, name }) => {
    const saved = overview?.apps.find((a) => named(a.name, key) || named(a.id, key));
    const row = found[key];
    if (saved === undefined && row === undefined) return null; // the registry has no such app
    const job = JOB_KINDS.find((j) => j.app?.key === key)?.label ?? 'Popular';
    const meta = [job, row ? SIGN_IN[row.signIn] : ''].filter((part) => part !== '').join(' · ');
    const state = connect[key];
    return (
      <li key={key} className="cx-item">
        <div className="cx-row">
          <Tile name={name} />
          <div className="cx-row__main">
            <span className="cx-row__name">
              <span>{name}</span>
              {row?.official === true && (
                <span className="cx-chip cx-chip--official">Official</span>
              )}
            </span>
            <span className="cx-meta">{meta}</span>
          </div>
          <div className="cx-row__side">
            {state?.error !== undefined && (
              <span className="cx-outcome cx-outcome--err" role="alert">
                {state.error}
              </span>
            )}
            {saved?.state === 'connected' ? (
              <span className="cx-status">
                <span className="home-dot" aria-hidden="true" />
                Connected
              </span>
            ) : saved !== undefined ? (
              <span className="cx-status cx-status--off">Finish in Home</span>
            ) : state?.busy === true ? (
              <Waiting />
            ) : (
              row !== undefined && (
                <Button
                  variant="secondary"
                  className="cx-fixed"
                  aria-label={`Add ${name}`}
                  onClick={() => addApp(key, row)}
                >
                  Add
                </Button>
              )
            )}
          </div>
        </div>
      </li>
    );
  });

  const expert = overview?.experts.find((e) => e.id === EXPERT);
  const progress = overview?.progress?.expert === EXPERT ? overview.progress : null;
  const failed = expertFailed || overview?.failed?.expert === EXPERT;
  const signIn = expert?.state === 'needs_login';

  return (
    <section>
      <h1>Connect your tools</h1>
      <p className="wt-lead">
        Scout can only help with what it can reach. Add the ones you use now, or any time later in
        Home, under Connections.
      </p>
      {offline && (
        <p role="alert" className="wt-note">
          {OFFLINE}
        </p>
      )}
      {!offline && overview !== null && (
        <>
          {appRows.some((r) => r !== null) && (
            <Group title="Apps" note="For the everyday jobs">
              {appRows}
            </Group>
          )}
          <Group title="An expert for long jobs" note="Runs on your own login">
            <li className="cx-item">
              <div className="cx-row">
                <Tile name={EXPERT_NAME} />
                <div className="cx-row__main">
                  <span className="cx-row__name">
                    <span>{EXPERT_NAME}</span>
                    <span className="cx-chip cx-chip--official">Official</span>
                    <span className="cx-chip cx-chip--rec">Recommended</span>
                  </span>
                  <span className="cx-meta">
                    {signIn ? 'Installed. Sign in once with your own account.' : EXPERT_JOB}
                  </span>
                </div>
                <div className="cx-row__side">
                  {progress !== null ? (
                    <div className="cx-progress">
                      <div className="cx-progress__top">
                        <span>Installing…</span>
                        {progress.percent !== undefined && <span>{progress.percent}%</span>}
                      </div>
                      <div className="cx-bar">
                        <i style={{ width: `${progress.percent ?? 0}%` }} />
                      </div>
                      <span className="cx-meta">{STAGE_LINE}</span>
                    </div>
                  ) : expertBusy ? (
                    <Waiting />
                  ) : expert === undefined ? (
                    <>
                      {failed && (
                        <span className="cx-outcome cx-outcome--err" role="alert">
                          {EXPERT_FAILED}
                        </span>
                      )}
                      <Button variant="secondary" className="cx-fixed" onClick={pressExpert}>
                        Add
                      </Button>
                    </>
                  ) : signIn ? (
                    <>
                      <span className="cx-status cx-status--warn">
                        <span className="home-dot home-dot--warn" aria-hidden="true" />
                        Needs sign-in
                      </span>
                      <Button variant="secondary" className="cx-fixed" onClick={pressExpert}>
                        Sign in
                      </Button>
                    </>
                  ) : (
                    <span className="cx-status">
                      <span className="home-dot" aria-hidden="true" />
                      Ready
                    </span>
                  )}
                </div>
              </div>
            </li>
          </Group>
        </>
      )}
    </section>
  );
}
