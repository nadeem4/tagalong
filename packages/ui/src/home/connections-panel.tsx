/**
 * Home's Connections page: the person's apps over MCP. Popular apps, servers found in
 * Claude Code, and Add a connector. Contains ConnectionsPanel and splitCommand.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type {
  ConnectionState,
  ConnectionsAddParams,
  ConnectionsListResult,
  FoundConnector,
  PopularConnector,
} from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';

type Status = { text: string; error: boolean } | null;

const STATUS_WORDS: Record<ConnectionState['status'], string> = {
  off: 'Off',
  connecting: 'Connecting',
  connected: 'Connected',
  'needs-sign-in': 'Needs sign-in',
  error: 'Not working',
};

const STATUS_CHIP: Record<ConnectionState['status'], string> = {
  off: 'tg-chip',
  connecting: 'tg-chip tg-chip--warn',
  connected: 'tg-chip tg-chip--ok',
  'needs-sign-in': 'tg-chip tg-chip--warn',
  error: 'tg-chip tg-chip--err',
};

/** `npx -y "my server" C:/x` as a command and its arguments; quotes keep spaces. */
export function splitCommand(line: string): string[] {
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

/** What the person hears after Connect, from the state the engine answered with. */
function outcome(state: ConnectionState): Status {
  if (state.status === 'connecting' && state.auth === 'oauth') {
    return { text: `Finish signing in to ${state.name} in your browser.`, error: false };
  }
  if (state.status === 'connected') return { text: `${state.name} is connected.`, error: false };
  if (state.error !== undefined) return { text: state.error, error: true };
  return { text: `${state.name} is ${STATUS_WORDS[state.status].toLowerCase()}.`, error: false };
}

/**
 * Home's Connections page: the person's apps over MCP. Popular apps connect with one
 * button, servers already set up in Claude Code are reused, and anything else is added
 * under Add a connector. Scout reads with them on its own and asks before every change.
 */
export function ConnectionsPanel() {
  const bridge = useHostBridge();
  const [list, setList] = useState<ConnectionsListResult | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const reload = useCallback(() => {
    void bridge.listConnections?.().then(setList);
  }, [bridge]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      bridge.onTurnEvent((event) => {
        if (event.type !== 'connections.changed') return;
        setList((current) => current && { ...current, connections: event.connections });
      }),
    [bridge],
  );

  if (bridge.listConnections === undefined) {
    return <p className="home-note">Connections are set up in the Tagalong desktop app.</p>;
  }
  if (list === null) return <p className="home-note">Loading connections…</p>;

  const add = async (params: ConnectionsAddParams): Promise<boolean> => {
    setStatus(null);
    try {
      const state = await bridge.addConnection?.(params);
      if (state === undefined) return false;
      setStatus(outcome(state));
      reload();
      return true;
    } catch (error) {
      setStatus({
        text: `Not connected. ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      });
      return false;
    }
  };

  const connectedIds = list.connections.map((c) => c.id);
  const popular = list.popular.filter((p) => !connectedIds.includes(p.id));
  return (
    <div className="tg-panel home-controls home-conns">
      <h1 className="home-title">Connections</h1>
      <p className="tg-note">
        Let Scout use your apps: “what’s on my calendar”, “any reviews waiting”. Scout reads with
        them on its own, and asks you before it changes anything.
      </p>
      {status !== null && (
        <p
          className={status.error ? 'tg-error' : 'tg-note'}
          role={status.error ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      )}
      {list.connections.length > 0 && (
        <>
          <h3>Connected</h3>
          <ul aria-label="Connections" className="home-list home-conns__list">
            {list.connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                onChange={(next) =>
                  setList(
                    (current) =>
                      current && {
                        ...current,
                        connections: current.connections.map((c) => (c.id === next.id ? next : c)),
                      },
                  )
                }
                onRemoved={() => {
                  setStatus({ text: `${connection.name} is disconnected.`, error: false });
                  reload();
                }}
              />
            ))}
          </ul>
        </>
      )}
      {popular.length > 0 && (
        <>
          <h3>Popular</h3>
          <ul aria-label="Popular" className="home-list home-conns__list">
            {popular.map((entry) => (
              <PopularRow key={entry.id} entry={entry} onAdd={add} />
            ))}
          </ul>
        </>
      )}
      {list.found.length > 0 && (
        <>
          <h3>Found on this PC</h3>
          <ul aria-label="Found on this PC" className="home-list home-conns__list">
            {list.found.map((entry) => (
              <FoundRow key={entry.name} entry={entry} onAdd={add} />
            ))}
          </ul>
        </>
      )}
      <details className="home-conns__advanced">
        <summary className="tg-note">Add a connector</summary>
        <AddForm onAdd={add} />
      </details>
    </div>
  );
}

function ConnectionRow({
  connection,
  onChange,
  onRemoved,
}: {
  connection: ConnectionState;
  onChange: (next: ConnectionState) => void;
  onRemoved: () => void;
}) {
  const bridge = useHostBridge();
  const [confirming, setConfirming] = useState(false);
  const switchLabel = useId();
  const { name, tools } = connection;
  const reads = tools.filter((t) => t.access === 'read').length;
  const summary =
    connection.status === 'connected'
      ? `${tools.length} tool${tools.length === 1 ? '' : 's'}: ${reads} read, ${tools.length - reads} ask first`
      : (connection.error ?? STATUS_WORDS[connection.status]);
  const canSignIn =
    connection.auth === 'oauth' &&
    connection.enabled &&
    (connection.status === 'needs-sign-in' || connection.status === 'error');

  return (
    <li>
      <section className="home-conn" aria-label={name}>
        <div className="home-conn__head">
          <span className="home-entry__body">
            <span className="home-entry__title">{name}</span>
            <span className={connection.status === 'error' ? 'tg-error' : 'home-entry__preview'}>
              {summary}
            </span>
          </span>
          <span className={STATUS_CHIP[connection.status]}>{STATUS_WORDS[connection.status]}</span>
          <span id={switchLabel} hidden>
            Scout can use {name}
          </span>
          <button
            type="button"
            role="switch"
            className="tg-switch"
            aria-checked={connection.enabled}
            aria-labelledby={switchLabel}
            onClick={() =>
              void bridge.setConnectionEnabled?.(connection.id, !connection.enabled).then(onChange)
            }
          >
            {connection.enabled ? 'On' : 'Off'}
          </button>
        </div>
        {tools.length > 0 && (
          <details>
            <summary className="tg-note">Tools</summary>
            <ul className="tg-tools">
              {tools.map((tool) => (
                <li key={tool.name}>
                  <span>
                    <strong>{tool.name}</strong>
                    {tool.description !== undefined && (
                      <>
                        <br />
                        <small>{tool.description.split('\n', 1)[0]}</small>
                      </>
                    )}
                  </span>
                  <span className={tool.access === 'read' ? 'tg-chip' : 'tg-chip tg-chip--warn'}>
                    {tool.access === 'read' ? 'Reads' : 'Asks first'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="home-conn__actions">
          {canSignIn && (
            <button
              type="button"
              className="tg-btn-quiet"
              onClick={() => void bridge.signInConnection?.(connection.id).then(onChange)}
            >
              Sign in again
            </button>
          )}
          {confirming ? (
            <span className="home-danger">
              <button
                type="button"
                className="tg-btn-quiet"
                onClick={() => void bridge.removeConnection?.(connection.id).then(onRemoved)}
              >
                Disconnect {name} and delete its sign-in
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(false)}>
                Keep {name}
              </button>
            </span>
          ) : (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(true)}>
                Disconnect
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

function PopularRow({
  entry,
  onAdd,
}: {
  entry: PopularConnector;
  onAdd: (params: ConnectionsAddParams) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState('');
  const base = {
    id: entry.id,
    name: entry.name,
    transport: { type: 'http' as const, url: entry.url },
    auth: entry.auth,
  };
  return (
    <li>
      <section className="home-conn" aria-label={`${entry.name}, not connected`}>
        <div className="home-conn__head">
          <span className="home-entry__body">
            <span className="home-entry__title">{entry.name}</span>
            <span className="home-entry__preview">{entry.blurb}</span>
          </span>
          {!asking && (
            <button
              type="button"
              className="tg-btn-quiet"
              aria-label={`Connect ${entry.name}`}
              onClick={() => (entry.auth === 'token' ? setAsking(true) : void onAdd(base))}
            >
              Connect
            </button>
          )}
        </div>
        {asking && (
          <div className="home-conn__form">
            {entry.tokenHint !== undefined && <p className="tg-note">{entry.tokenHint}</p>}
            {entry.tokenUrl !== undefined && (
              <p className="tg-note">
                Make one at <span className="home-conn__url">{entry.tokenUrl}</span>
              </p>
            )}
            <SecretField label={`Key for ${entry.name}`} value={key} onChange={setKey} />
            <div className="home-conn__actions">
              <button
                type="button"
                className="tg-btn"
                disabled={key.trim() === ''}
                onClick={() => void onAdd({ ...base, secrets: { token: key.trim() } })}
              >
                Connect
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </li>
  );
}

function FoundRow({
  entry,
  onAdd,
}: {
  entry: FoundConnector;
  onAdd: (params: ConnectionsAddParams) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const remote = entry.transport.type === 'http';
  // A remote server's only key Tagalong can send is an Authorization header.
  const needsKey = remote && entry.missingSecrets.includes('Authorization');
  const otherHeaders = remote ? entry.missingSecrets.filter((h) => h !== 'Authorization') : [];
  const asked = remote ? (needsKey ? ['token'] : []) : entry.missingSecrets;
  const where =
    entry.transport.type === 'http'
      ? entry.transport.url
      : [entry.transport.command, ...entry.transport.args].join(' ');
  const params = (): ConnectionsAddParams => ({
    name: entry.name,
    transport: entry.transport,
    auth: remote ? (needsKey ? 'token' : 'oauth') : 'none',
    ...(asked.length > 0 ? { secrets: values } : {}),
  });
  const ready = asked.every((name) => (values[name] ?? '').trim() !== '');

  return (
    <li>
      <section className="home-conn" aria-label={`${entry.name}, found in Claude Code`}>
        <div className="home-conn__head">
          <span className="home-entry__body">
            <span className="home-entry__title">{entry.name}</span>
            <span className="home-entry__preview">
              From Claude Code{entry.project !== undefined ? `, ${entry.project}` : ''} · {where}
            </span>
          </span>
          {!asking && (
            <button
              type="button"
              className="tg-btn-quiet"
              aria-label={`Use ${entry.name}`}
              onClick={() => (asked.length > 0 ? setAsking(true) : void onAdd(params()))}
            >
              Use
            </button>
          )}
        </div>
        {asking && (
          <div className="home-conn__form">
            <p className="tg-note">
              Claude Code keeps these values itself, and Tagalong does not copy them. Paste them
              here; they go to your keychain.
            </p>
            {asked.map((name) => (
              <SecretField
                key={name}
                label={name === 'token' ? `Key for ${entry.name}` : `${name} for ${entry.name}`}
                value={values[name] ?? ''}
                onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
              />
            ))}
            {otherHeaders.length > 0 && (
              <p className="tg-note">
                Tagalong sends only an Authorization key, not {otherHeaders.join(', ')}.
              </p>
            )}
            <div className="home-conn__actions">
              <button
                type="button"
                className="tg-btn"
                disabled={!ready}
                onClick={() => void onAdd(params())}
              >
                Connect
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </li>
  );
}

type SignIn = 'oauth' | 'token' | 'none';

function AddForm({ onAdd }: { onAdd: (params: ConnectionsAddParams) => Promise<boolean> }) {
  const [kind, setKind] = useState<'remote' | 'local'>('remote');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [signIn, setSignIn] = useState<SignIn>('oauth');
  const [key, setKey] = useState('');
  const [command, setCommand] = useState('');
  const [env, setEnv] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const group = useId();

  const submit = async (): Promise<void> => {
    setProblem(null);
    if (name.trim() === '') return setProblem('Give the connector a name.');
    if (kind === 'remote') {
      if (!/^https:\/\/\S+$/.test(url.trim())) {
        return setProblem('Use an address that starts with https://');
      }
      if (signIn === 'token' && key.trim() === '') return setProblem('Paste the key.');
      const added = await onAdd({
        name: name.trim(),
        transport: { type: 'http', url: url.trim() },
        auth: signIn,
        ...(signIn === 'token' ? { secrets: { token: key.trim() } } : {}),
      });
      if (added) setName('');
      return;
    }
    const [program, ...args] = splitCommand(command.trim());
    if (program === undefined) return setProblem('Type the command that starts the connector.');
    const secrets = envLines(env);
    if (typeof secrets === 'string') return setProblem(secrets);
    const added = await onAdd({
      name: name.trim(),
      transport: { type: 'stdio', command: program, args, env: {} },
      auth: 'none',
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    });
    if (added) setName('');
  };

  return (
    <div className="home-conn__form">
      <p className="tg-note">
        Any MCP server: an address on the web, or a command that runs on this PC.
      </p>
      <div className="tg-choices" role="radiogroup" aria-label="Kind of connector">
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
              <option value="oauth">The app’s own sign-in, in your browser</option>
              <option value="token">A key you paste</option>
              <option value="none">Nothing</option>
            </select>
          </label>
          {signIn === 'token' && <SecretField label="Key" value={key} onChange={setKey} />}
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
            <span>Environment (NAME=value, one per line, kept in your keychain)</span>
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
