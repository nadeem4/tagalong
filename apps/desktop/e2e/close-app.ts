import type { ElectronApplication } from '@playwright/test';

/** How long a clean quit may take before the process is killed. */
const QUIT_GRACE_MS = 15_000;

/**
 * Closes the app, and kills it if a clean quit does not finish in time. An Electron that
 * cannot quit (a modal dialog, a capture helper still holding the event loop) would otherwise
 * keep the suite waiting forever, and a CI job that hangs prints nothing about why.
 */
export async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (app === undefined) return;
  const proc = app.process();
  const closed = app.close().then(
    () => true,
    () => true,
  );
  const gaveUp = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), QUIT_GRACE_MS));
  if (!(await Promise.race([closed, gaveUp]))) {
    console.error(`Electron did not quit within ${QUIT_GRACE_MS} ms; killing it.`);
    proc.kill();
  }
}
