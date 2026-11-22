/**
 * A reply saved while the desktop was away: after the link returns with resync, the bubble
 * shows it from the saved chat (the brain's chat_since), once. Runs on the fake brain.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` that types `window.tagalongHost`.
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { seedSettings } from './fixtures/seed-settings';
import { launchEnv } from './fixtures/launch-env';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-catchup-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...launchEnv(), TAGALONG_BRAIN_ADDR: brain.addr },
  });
});

test.afterAll(async () => {
  try {
    await closeApp(app);
  } finally {
    await brain.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of app.windows()) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

const FIRST = 'The long answer you asked for, saved while you were away.';
const SECOND = 'Another long answer, saved during a second drop.';

test('the bubble shows each reply saved while the link was down, once', async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.hidePanel());
  await expect.poll(() => brain.hellos, { timeout: 30_000 }).toBeGreaterThan(0);
  // The link comes up: the desktop notes the newest saved reply (none yet).
  await expect.poll(() => brain.chatSinceCalls.length).toBeGreaterThan(0);
  expect(brain.chatSinceCalls[0]).toEqual({ limit: 1 });

  brain.dropWithSavedReply(FIRST);
  const line = panel.getByRole('button', { name: 'Ask Scout something' });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.click();
  await expect(panel.getByText(FIRST)).toBeVisible();

  brain.dropWithSavedReply(SECOND);
  await expect(panel.getByText(SECOND)).toBeVisible({ timeout: 30_000 });
  // The second catch-up asked after the first reply's id, so the first is not read (or shown) again.
  expect(brain.chatSinceCalls.at(-1)).toEqual({ after_id: '1' });
});
