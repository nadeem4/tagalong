/**
 * "Add it yourself" on Home's Connections page: the form for any MCP server, a web address or a
 * command on this PC. A two-way segmented control picks the kind; fields are label-above inputs.
 * The key is sent once and cleared. Contains AddForm.
 */

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AppAddParams } from '../shapes';
import { Button } from '../controls/button';
import { SAME_MACHINE } from './connection-row';

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

/** A label above its control, with an optional hint under it. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cx-field">
      <label htmlFor={id} className="cx-field__lbl">
        {label}
      </label>
      {children}
      {hint !== undefined && <span className="cx-field__hint">{hint}</span>}
    </div>
  );
}

type SignIn = 'oauth' | 'token' | 'none';
type Kind = 'remote' | 'local';

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'remote', label: 'A web address' },
  { kind: 'local', label: 'A command on this PC' },
];

export function AddForm({
  onAdd,
  onCancel,
}: {
  onAdd: (params: AppAddParams) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<Kind>('remote');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [signIn, setSignIn] = useState<SignIn>('none');
  const [key, setKey] = useState('');
  const [command, setCommand] = useState('');
  const [env, setEnv] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const base = useId();
  const id = (part: string): string => `${base}-${part}`;

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

  // A radio group moves with the arrow keys; Tab then leaves it.
  const arrow = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    setKind(kind === 'remote' ? 'local' : 'remote');
  };

  return (
    <div className="cx-form">
      <div className="cx-form__head">
        <h3 className="cx-form__title">Add it yourself</h3>
        <p className="cx-form__lead">
          For apps that aren&apos;t listed. You&apos;ll need its web address, or the command that
          starts it on this PC.
        </p>
      </div>
      <div className="cx-seg" role="radiogroup" aria-label="Kind of app">
        {KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={kind === option.kind}
            tabIndex={kind === option.kind ? 0 : -1}
            onClick={() => setKind(option.kind)}
            onKeyDown={arrow}
          >
            {option.label}
          </button>
        ))}
      </div>
      {kind === 'remote' ? (
        <>
          <div className="cx-two">
            <Field id={id('name')} label="Name">
              <input
                id={id('name')}
                className="cx-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field id={id('url')} label="Address">
              <input
                id={id('url')}
                className="cx-input"
                value={url}
                placeholder="https://example.com/mcp"
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
          </div>
          <Field id={id('sign')} label="Signs in with">
            <select
              id={id('sign')}
              className="cx-input"
              value={signIn}
              onChange={(event) => setSignIn(event.target.value as SignIn)}
            >
              <option value="none">Nothing</option>
              <option value="oauth">The app’s own sign-in page</option>
              <option value="token">A key you paste</option>
            </select>
          </Field>
          {signIn === 'token' && (
            <Field id={id('key')} label="Key">
              <input
                id={id('key')}
                className="cx-input"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </Field>
          )}
          {signIn === 'oauth' && <p className="cx-form__hint">{SAME_MACHINE}</p>}
        </>
      ) : (
        <>
          <div className="cx-two">
            <Field id={id('name')} label="Name">
              <input
                id={id('name')}
                className="cx-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field id={id('command')} label="Command">
              <input
                id={id('command')}
                className="cx-input cx-input--code"
                value={command}
                placeholder="npx -y some-mcp-server"
                onChange={(event) => setCommand(event.target.value)}
              />
            </Field>
          </div>
          <Field
            id={id('env')}
            label="Settings it needs (one NAME=value per line)"
            hint={
              <>
                Write <code className="cx-code">{'${NAME}'}</code> to use a value already set on
                this PC, so the secret is not typed here.
              </>
            }
          >
            <textarea
              id={id('env')}
              className="cx-input cx-input--area"
              rows={3}
              value={env}
              onChange={(event) => setEnv(event.target.value)}
            />
          </Field>
        </>
      )}
      {problem !== null && (
        <p className="tg-error" role="alert">
          {problem}
        </p>
      )}
      <div className="cx-form__actions">
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()}>
          Add app
        </Button>
      </div>
    </div>
  );
}
