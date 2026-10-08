/** The slice of `process` the guard listens on, so tests can hand it a fake. */
export interface CrashGuardProcess {
  on(event: 'uncaughtException' | 'unhandledRejection', handler: (reason: unknown) => void): void;
}

export interface CrashGuardOptions {
  /** True only for end-to-end test runs (`TAGALONG_E2E=1`). */
  enabled: boolean;
  process: CrashGuardProcess;
  log: (message: string) => void;
  exit: (code: number) => void;
}

/**
 * Electron answers an uncaught main-process error with a modal dialog, which blocks the event
 * loop: in an end-to-end run nobody can click it, so the suite hangs instead of failing, and the
 * runner never prints why. During those runs only, an uncaught error is written to the log with
 * its stack and the app exits with a failure, so the test fails and says what broke. Outside a
 * test run nothing is installed and Electron keeps its own behaviour.
 */
export function installCrashGuard({ enabled, process, log, exit }: CrashGuardOptions): void {
  if (!enabled) return;
  const fail = (kind: string) => (reason: unknown) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    log(`Tagalong main process ${kind}: ${detail}`);
    exit(1);
  };
  process.on('uncaughtException', fail('uncaught exception'));
  process.on('unhandledRejection', fail('unhandled rejection'));
}
