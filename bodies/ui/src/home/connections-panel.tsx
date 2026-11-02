/**
 * Home's Connections page, two groups. Apps: the ones the brain keeps over MCP, one row each
 * (status, tool count, on/off, Restart, Remove) and one Add form. Experts: the installed coding
 * agents and their state. Each group has a Browse and add list from the registries. The brain
 * owns every list and the keys; this page only asks and reads again. Contains ConnectionsPanel
 * and splitCommand; rows are connection-row.tsx, experts-group.tsx and browse-list.tsx.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { AppAddParams, AppInfo, SetupOverview, SetupResult } from '../shapes';
import { failure } from '../failure';
import { useHostBridge } from '../host-bridge';
import { Button } from '../controls/button';
import { BrowseList } from './browse-list';
import { ConnectionRow, SAME_MACHINE } from './connection-row';
import { ExpertsGroup } from './experts-group';

type Status = { text: string; error: boolean } | null;

const BRAIN_OFFLINE = 'brain offline';

// The page's own words for what the brain answers with a short token. A refusal that is not a
// problem (the person said no, it is already done) is a note; the rest are errors.
const SETUP_REFUSALS: Record<string, Status & object> = {
  denied: { text: 'Okay, nothing was changed.', error: false },
  already_installing: { text: 'That is already being set up.', error: false },
  already_ready: { text: 'That is already set up.', error: false },
  already_added: { text: 'That app is already added.', error: false },
  version_changed: {
    text: 'The registry changed while you were deciding. Look at it again, then try once more.',
    error: true,
  },
  registry_unavailable: {
    text: 'Scout couldn’t reach the registry. Check your connection and try again.',
    error: true,
  },
};
const SETUP_FAILED: Status & object = { text: 'Setting that up didn’t work.', error: true };

/** `npx -y "my server" C:/x` as a command and its arguments; quotes keep spaces. */
function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** `NAME=value` lines; blank lines skipped. */
function envLines(text: string): Record<string, string> | string {
  const env: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const at = line.indexOf('=');
    if (at <= 0) return `"${line}" is not NAME=value.`;
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return env;
}

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

  const reloadSetup = useCallback(() => {
    // Quiet on failure: the apps list already says when the brain is away.
    bridge.setupOverview().then(setSetup, () => setSetup(null));
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
        if (event.type === 'connections.changed') reload();
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
      reload();
    }
  };

  // The call returns once the person has answered the Allow card; until then the row waits.
  const setUp = (id: string, call: () => Promise<SetupResult>): void => {
    setAsking((now) => new Set(now).add(id));
    void act(async () => {
      try {
        const { error } = await call();
        if (error !== undefined) setStatus(SETUP_REFUSALS[error] ?? SETUP_FAILED);
      } finally {
        setAsking((now) => {
          const next = new Set(now);
          next.delete(id);
          return next;
        });
      }
    });
  };

  const nameOf = (expert: string): string =>
    [...(setup?.experts ?? []), ...(setup?.browseExperts ?? [])].find((e) => e.id === expert)
      ?.name ?? expert;

  const add = (params: AppAddParams): Promise<boolean> =>
    act(() => bridge.addConnection(params), `${params.name} added.`);

  return (
    <>
      <div className="home-head">
        <h1 className="home-title">Connections</h1>
        <p>The apps Scout can use for you. Turn one off to stop Scout using it.</p>
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
      <section className="home-card" aria-label="Connected apps">
        <h2 className="home-card__label">CONNECTED APPS</h2>
        {apps.length > 0 && (
          <ul aria-label="Apps" className="home-list home-conns__list">
            {apps.map((app) => (
              <ConnectionRow
                key={app.id}
                app={app}
                onSwitch={() => void act(() => bridge.setConnectionEnabled(app.id, !app.enabled))}
                onRestart={() => void act(() => bridge.restartConnection(app.id))}
                onSignIn={() => void act(() => bridge.signInConnection(app.id))}
                onRemove={() =>
                  void act(() => bridge.removeConnection(app.id), `${app.name} removed.`)
                }
              />
            ))}
          </ul>
        )}
        {apps.length === 0 && !offline && <p className="tg-note">No apps yet. Add one below.</p>}
      </section>
      <BrowseList
        label="Browse apps"
        items={setup?.browseApps ?? []}
        progress={setup?.progress ?? null}
        asking={asking}
        onAdd={(id) => setUp(id, () => bridge.setupApp(id, false))}
      />
      {setup !== null && (
        <>
          {setup.failed !== null && (
            <p className="tg-error" role="alert">
              Setting up {nameOf(setup.failed.expert)} didn’t finish. Try again.
            </p>
          )}
          <ExpertsGroup
            experts={setup.experts}
            progress={setup.progress}
            asking={asking}
            onAct={(id) => setUp(id, () => bridge.setupExpert(id, false))}
          />
          <BrowseList
            label="Browse experts"
            items={setup.browseExperts}
            progress={setup.progress}
            asking={asking}
            onAdd={(id) => setUp(id, () => bridge.setupExpert(id, false))}
          />
        </>
      )}
      <section className="home-card home-conns" aria-label="Add an app">
        <h2 className="home-card__label">ADD AN APP</h2>
        <details>
          <summary className="tg-note">Add an app</summary>
          <div className="tg-panel home-conns__form-host">
            <AddForm onAdd={add} />
          </div>
        </details>
      </section>
    </>
  );
}

/** A key field, kept as a password field so it never shows on screen. */
function SecretField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type SignIn = 'oauth' | 'token' | 'none';

function AddForm({ onAdd }: { onAdd: (params: AppAddParams) => Promise<boolean> }) {
  const [kind, setKind] = useState<'remote' | 'local'>('remote');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [signIn, setSignIn] = useState<SignIn>('none');
  const [key, setKey] = useState('');
  const [command, setCommand] = useState('');
  const [env, setEnv] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const group = useId();

  // The key is sent once: it is gone from the form as soon as the brain has it.
  const clear = (): void => {
    setName('');
    setUrl('');
    setKey('');
    setCommand('');
    setEnv('');
  };

  const submit = async (): Promise<void> => {
    setProblem(null);
    if (name.trim() === '') return setProblem('Give the app a name.');
    if (kind === 'remote') {
      if (!/^https:\/\/\S+$/.test(url.trim())) {
        return setProblem('Use an address that starts with https://');
      }
      if (signIn === 'token' && key.trim() === '') return setProblem('Paste the key.');
      const added = await onAdd({
        name: name.trim(),
        transport: 'http',
        url: url.trim(),
        auth: signIn,
        ...(signIn === 'token' ? { token: key.trim() } : {}),
      });
      if (added) clear();
      return;
    }
    const [program, ...args] = splitCommand(command.trim());
    if (program === undefined) return setProblem('Type the command that starts the app.');
    const vars = envLines(env);
    if (typeof vars === 'string') return setProblem(vars);
    const added = await onAdd({
      name: name.trim(),
      transport: 'stdio',
      command: program,
      args,
      env: vars,
      auth: 'none',
    });
    if (added) clear();
  };

  return (
    <div className="home-conn__form">
      <p className="tg-note">
        Any MCP server: an address on the web, or a command that runs on this PC.
      </p>
      <div className="tg-choices" role="radiogroup" aria-label="Kind of app">
        <label className="tg-choice">
          <input
            type="radio"
            name={group}
            checked={kind === 'remote'}
            onChange={() => setKind('remote')}
          />
          <span>An address on the web</span>
        </label>
        <label className="tg-choice">
          <input
            type="radio"
            name={group}
            checked={kind === 'local'}
            onChange={() => setKind('local')}
          />
          <span>A command on this PC</span>
        </label>
      </div>
      <label>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {kind === 'remote' ? (
        <>
          <label>
            <span>Address</span>
            <input
              value={url}
              placeholder="https://example.com/mcp"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label>
            <span>Signs in with</span>
            <select value={signIn} onChange={(event) => setSignIn(event.target.value as SignIn)}>
              <option value="none">Nothing</option>
              <option value="oauth">The app’s own sign-in page</option>
              <option value="token">A key you paste</option>
            </select>
          </label>
          {signIn === 'token' && <SecretField label="Key" value={key} onChange={setKey} />}
          {signIn === 'oauth' && <p className="tg-note">{SAME_MACHINE}</p>}
        </>
      ) : (
        <>
          <label>
            <span>Command</span>
            <input
              value={command}
              placeholder="npx -y some-mcp-server"
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>
          <label>
            <span>
              Environment (NAME=value, one per line; {'${NAME}'} takes the value from your own
              environment)
            </span>
            <textarea rows={2} value={env} onChange={(event) => setEnv(event.target.value)} />
          </label>
        </>
      )}
      {problem !== null && (
        <p className="tg-error" role="alert">
          {problem}
        </p>
      )}
      <div className="home-conn__actions">
        <Button variant="primary" onClick={() => void submit()}>
          Add
        </Button>
      </div>
    </div>
  );
}
