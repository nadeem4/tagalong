import { spawn } from 'node:child_process';

import { runWindowHelper } from './window-helper';
import type { HelperChild } from './window-helper';

/**
 * The one definition of how Tagalong starts PowerShell.
 *
 * One, because the alternative was tried and failed silently. When the platform and the
 * integration test each held their own copy of these arguments, changing the platform's
 * `-EncodedCommand` to `-Command` broke the application and left the whole suite green:
 * the test went on running the arguments it owned rather than the ones being shipped.
 *
 * So nothing else in the app may spawn PowerShell, and the test that guards the transport
 * calls `runPowerShellScript` rather than rebuilding it. Changing anything here changes
 * what that test runs, which is the only arrangement in which it can fail.
 */
const POWERSHELL_EXE = 'powershell.exe';

/**
 * The arguments, as a separate function so the shape can be asserted without starting a
 * process.
 *
 * `-NoProfile` because a user's profile can print banners onto the stdout the parsers
 * read. `-NonInteractive` so a prompt fails fast instead of hanging until the timeout.
 * `-EncodedCommand` because feeding a script over stdin with `-Command -` parses it line
 * by line and silently discards any block spanning lines.
 */
export function powerShellArgs(encoded: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded,
  ];
}

/** Starts PowerShell with an already-encoded script. */
export function spawnPowerShell(encoded: string): HelperChild {
  return spawn(POWERSHELL_EXE, powerShellArgs(encoded), { windowsHide: true });
}

/**
 * Runs a script and resolves with whatever it printed.
 *
 * The entry point for every PowerShell helper in the host, and the entry point the
 * transport test drives. Never rejects: `runWindowHelper` turns a missing interpreter, a
 * policy block or an overrun into the output collected so far.
 */
export function runPowerShellScript(script: string, timeoutMs: number): Promise<string> {
  return runWindowHelper(spawnPowerShell, script, timeoutMs);
}
