import { execFile } from 'node:child_process';
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

/** Runs claude the way the brain does (no shell), giving up after five seconds. */
function runClaude(args: string[]): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    execFile('claude', args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      const code = (error as (NodeJS.ErrnoException & { killed?: boolean }) | null)?.code;
      const killed = (error as { killed?: boolean } | null)?.killed === true;
      resolve(
        error === null
          ? { stdout }
          : { stdout, errorCode: killed ? 'ETIMEDOUT' : (code ?? 'failed') },
      );
    });
  });
}
