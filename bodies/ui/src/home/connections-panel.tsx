/**
 * Home's Connections page: the apps the brain keeps over MCP. One row per app (status,
 * tool count, on/off, Restart, Remove) and one Add form. The brain owns the list and the keys;
 * this page only asks and reads again. Contains ConnectionsPanel and splitCommand.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { AppAddParams, AppInfo } from '../shapes';
import { useHostBridge } from '../host-bridge';

type Status = { text: string; error: boolean } | null;

const BRAIN_OFFLINE = 'brain offline';

// The brain opens the page on its own machine, so a brain elsewhere cannot finish a sign-in.
const SAME_MACHINE =
  'Signing in opens your browser, so Scout’s brain and the browser must be on the same computer.';

export const STATUS_WORDS: Record<AppInfo['status'], string> = {
  off: 'Off',
  connecting: 'Connecting',
  connected: 'Connected',
  'needs-sign-in': 'Needs sign-in',
  error: 'Not working',
};

export const STATUS_DOT: Record<AppInfo['status'], string> = {
  off: 'home-dot home-dot--off',
  connecting: 'home-dot home-dot--warn',
  connected: 'home-dot',
  'needs-sign-in': 'home-dot home-dot--warn',
  error: 'home-dot home-dot--err',
};

const TRANSPORT_WORDS: Record<AppInfo['transport'], string> = {
  stdio: 'Runs on this PC',
  http: 'Web address',
};

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

/** A failed call's own words: Electron wraps them in "Error invoking remote method '…': Error: ". */
export function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
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

  const reload = useCallback(() => {
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
  }, [bridge]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      bridge.onTurnEvent((event) => {
        if (event.type === 'connections.changed') reload();
      }),
    [bridge, reload],
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

  const add = (params: AppAddParams): Promise<boolean> =>
    act(() => bridge.addConnection(params), `${params.name} added.`);

  return (
    <div className="tg-panel home-controls home-conns">
      <h1 className="home-title">Connections</h1>
      <p className="tg-note">
        Let Scout use your apps: “what’s on my calendar”, “any reviews waiting”. Scout reads with
        them on its own, and asks you before it changes anything.
      </p>
      {offline && (
        <p className="tg-note" role="status">
          {apps.length > 0
            ? 'Scout’s brain isn’t running, so this list may be out of date. Start it, then try again.'
            : 'Scout’s brain isn’t running, so your apps can’t be shown. Start it, then try again.'}{' '}
          <button type="button" className="tg-btn-quiet" onClick={reload}>
            Try again
          </button>
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
      {apps.length > 0 && (
        <ul aria-label="Apps" className="home-list home-conns__list">
          {apps.map((app) => (
            <AppRow
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
      <details className="home-conns__advanced">
        <summary className="tg-note">Add an app</summary>
        <AddForm onAdd={add} />
      </details>
    </div>
  );
}

function AppRow({
  app,
  onSwitch,
  onRestart,
  onSignIn,
  onRemove,
}: {
  app: AppInfo;
  onSwitch: () => void;
  onRestart: () => void;
  onSignIn: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const switchLabel = useId();
  const { name, tools } = app;
  const toolCount = `${tools.length} tool${tools.length === 1 ? '' : 's'}`;
  // An oauth app that is connecting is waiting on the person's browser, not on the network.
  const waiting = app.auth === 'oauth' && app.status === 'connecting';
  const needsSignIn = app.auth === 'oauth' && app.status === 'needs-sign-in';

  return (
    <li>
      <section className="home-conn" aria-label={name}>
        <div className="home-conn__head">
          <span className="home-entry__body">
            <span className="home-entry__title">{name}</span>
            <span className="home-entry__preview">
              {TRANSPORT_WORDS[app.transport]} · {toolCount}
            </span>
          </span>
          <span className="tg-chip">
            <span className={STATUS_DOT[app.status]} aria-hidden="true" />{' '}
            {waiting ? 'Waiting for the browser' : STATUS_WORDS[app.status]}
          </span>
          <span id={switchLabel} hidden>
            Scout can use {name}
          </span>
          <button
            type="button"
            role="switch"
            className="tg-switch"
            aria-checked={app.enabled}
            aria-labelledby={switchLabel}
            onClick={onSwitch}
          >
            {app.enabled ? 'On' : 'Off'}
          </button>
        </div>
        {app.error !== '' && <p className="tg-error">{app.error}</p>}
        {(needsSignIn || waiting) && <p className="tg-note">{SAME_MACHINE}</p>}
        <div className="home-conn__actions">
          {needsSignIn && (
            <button
              type="button"
              className="tg-btn"
              aria-label={`Sign in to ${name}`}
              onClick={onSignIn}
            >
              Sign in
            </button>
          )}
          <button
            type="button"
            className="tg-btn-quiet"
            aria-label={`Restart ${name}`}
            onClick={onRestart}
          >
            Restart
          </button>
          {confirming ? (
            <span className="home-danger">
              <button
                type="button"
                className="tg-btn-quiet"
                aria-label={`Yes, remove ${name}`}
                onClick={onRemove}
              >
                Yes, remove
              </button>
              <button
                type="button"
                className="tg-btn-quiet"
                aria-label={`Keep ${name}`}
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </span>
          ) : (
            <span className="home-danger">
              <button
                type="button"
                className="tg-btn-quiet"
                aria-label={`Remove ${name}`}
                onClick={() => setConfirming(true)}
              >
                Remove
              </button>
            </span>
          )}
        </div>
      </section>
    </li>
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
        <button type="button" className="tg-btn" onClick={() => void submit()}>
          Add
        </button>
      </div>
    </div>
  );
}
