/**
 * Closes an Electron app without letting a hung quit stall the suite: a quit that has not
 * finished in time is killed, so the single-instance lock is free for the next spec.
 */
import type { ElectronApplication } from '@playwright/test';

export async function closeApp(app: ElectronApplication | undefined, ms = 45_000): Promise<void> {
  if (app === undefined) return;
  const proc = app.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'hung'>((resolve) => {
    timer = setTimeout(() => resolve('hung'), ms);
  });
  const closed = app.close().then(
    () => 'closed' as const,
    () => 'closed' as const,
  );
  const outcome = await Promise.race([closed, timeout]);
  clearTimeout(timer);
  if (outcome === 'hung') {
    console.warn('closeApp: the app did not quit in time; killing it');
    // Wait for the exit: Chromium children hold files in the data dir until then, and a
    // caller that removes the dir right after would hit EBUSY.
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    proc.kill();
    await exited;
  }
}
