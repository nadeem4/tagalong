/**
 * Whether Claude Code is signed in on this computer (`claude auth status`, no model call), and the
 * terminal that signs it in. Contains checkClaudeSignIn, signInFor, fakeSignIn and
 * openClaudeSignIn.
 */

import { spawn } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import type { ClaudeSignIn } from '../shared/ipc';

/** What running claude returned: its stdout, and the error code when it failed. */
export interface ClaudeRun {
  stdout: string;
  /** A spawn error's code (`ENOENT`, `ETIMEDOUT`), or the exit code. Absent on success. */
  errorCode?: string | number;
}

/**
 * Whether Scout can think through the Claude Code sign-in on this computer.
 *
 * Runs `claude auth status --json`, which only reads the local sign-in and makes no model
 * call. The JSON is believed even when claude exits non-zero, since a signed-out claude
 * may say so with a failing exit. A claude that cannot be started is not installed;
 * anything else that goes wrong (a timeout, output that is not the JSON) is unknown, so
 * Settings never claims a state it did not read.
 */
export async function checkClaudeSignIn(
  run: (args: string[]) => Promise<ClaudeRun> = runClaude,
): Promise<ClaudeSignIn> {
  try {
    const result = await run(['auth', 'status', '--json']);
    const parsed = parseAuthStatus(result.stdout);
    if (parsed !== 'unknown') return parsed;
    return result.errorCode === 'ENOENT' ? 'not-installed' : 'unknown';
  } catch {
    return 'unknown';
  }
}

const SIGN_IN_STATES: readonly ClaudeSignIn[] = [
  'signed-in',
  'signed-out',
  'not-installed',
  'unknown',
];

/**
 * The sign-in a test asks for: `TAGALONG_FAKE_SIGN_IN` names a state, and fake providers
 * read as signed in, so no test ever runs this machine's claude.
 */
export function fakeSignIn(env: Record<string, string | undefined>): ClaudeSignIn | undefined {
  const forced = SIGN_IN_STATES.find((state) => state === env.TAGALONG_FAKE_SIGN_IN);
  if (forced !== undefined) return forced;
  return env.TAGALONG_FAKE_PROVIDERS === '1' ? 'signed-in' : undefined;
}

export function signInFor(
  env: Record<string, string | undefined>,
  check: () => Promise<ClaudeSignIn> = checkClaudeSignIn,
): Promise<ClaudeSignIn> {
  const fake = fakeSignIn(env);
  return fake === undefined ? check() : Promise.resolve(fake);
}

/** Reads `loggedIn` from the status JSON; anything else is unknown. */
export function parseAuthStatus(stdout: string): ClaudeSignIn {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'unknown';
    const loggedIn = (parsed as Record<string, unknown>)['loggedIn'];
    if (loggedIn === true) return 'signed-in';
    if (loggedIn === false) return 'signed-out';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Runs claude the way the experts do: no shell, through cross-spawn, which finds npm's
 * `claude.cmd` shim on Windows that a plain execFile misses. Gives up after five seconds.
 */
function runClaude(args: string[]): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    const child = crossSpawn('claude', args, { windowsHide: true });
    let stdout = '';
    let settled = false;
    const finish = (run: ClaudeRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ stdout, errorCode: 'ETIMEDOUT' });
    }, 5000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    // A missing claude arrives as an 'error' event with ENOENT, which reads as not installed.
    child.on('error', (error: NodeJS.ErrnoException) =>
      finish({ stdout, errorCode: error.code ?? 'failed' }),
    );
    child.on('close', (code) =>
      finish(code === 0 ? { stdout } : { stdout, errorCode: code ?? 'failed' }),
    );
  });
}

/** What starting a process needs to give back here: let go of it, and hear its failure. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore'; windowsHide: boolean },
) => { unref(): void; on(event: 'error', listener: (error: Error) => void): unknown };

/** A visible terminal running `claude auth login`: the person signs in there, not in Tagalong. */
export function claudeSignInCommand(platform: NodeJS.Platform): {
  command: string;
  args: string[];
} {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/c', 'start', 'Claude sign-in', 'cmd', '/k', 'claude auth login'],
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: ['-e', 'tell application "Terminal" to do script "claude auth login"'],
    };
  }
  return { command: 'x-terminal-emulator', args: ['-e', 'claude auth login'] };
}

export function openClaudeSignIn(
  start: SpawnLike = spawn as unknown as SpawnLike,
  platform: NodeJS.Platform = process.platform,
): void {
  const { command, args } = claudeSignInCommand(platform);
  const child = start(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (error) => console.warn('[main] could not open the Claude sign-in:', error));
  child.unref();
}
