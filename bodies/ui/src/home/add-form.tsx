/**
 * "Add it yourself" on Home's Connections page: the form for any MCP server, a web address or a
 * command on this PC. The key is sent once and cleared. Contains AddForm.
 */

import { useId, useState } from 'react';
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

export function AddForm({
  onAdd,
  onCancel,
}: {
  onAdd: (params: AppAddParams) => Promise<boolean>;
  onCancel: () => void;
}) {
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
    <div className="cx-form">
      <h3 className="cx-form__title">Add it yourself</h3>
      <p className="cx-form__lead">
        For apps that aren&apos;t listed. You&apos;ll need its web address, or the command that
        starts it on this PC.
      </p>
      <div className="tg-choices" role="radiogroup" aria-label="Kind of app">
        <label className="tg-choice">
          <input
            type="radio"
            name={group}
            checked={kind === 'remote'}
            onChange={() => setKind('remote')}
          />
          <span>A web address</span>
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
            <span>Settings it needs (one NAME=value per line)</span>
            <textarea rows={2} value={env} onChange={(event) => setEnv(event.target.value)} />
          </label>
          <p className="cx-form__hint">
            Write {'${NAME}'} to use a value already set on this PC, so the secret is not typed
            here.
          </p>
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
