/**
 * Home's "Read my mail for loops" on the fake brain: the switch is off at first, turning it on
 * reaches the brain and shows the plain line about where mail goes, a held row appears, Forget
 * removes it, and Stop and wipe asks inside the page before it wipes.
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
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-loops-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr },
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

test('the mail switch, the Held list, forget and Stop and wipe', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Connections' }).click();

  const card = home.getByRole('region', { name: 'READ MY MAIL FOR LOOPS' });
  const toggle = card.getByRole('switch', { name: 'Read my mail for loops (Gmail)' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
  await expect(card).toContainText('Nothing is held.');
  await expect(card).not.toContainText('goes to Anthropic');

  // On: the brain hears it, the plain line shows, and the first read leaves a held row.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await expect(card).toContainText('Your mail goes to Anthropic to be read');
  const row = card.getByRole('listitem').filter({ hasText: 'Send Priya the Q4 deck' });
  await expect(row).toContainText('You owe');
  await expect(row).toContainText('Priya');
  await expect(row).toContainText('Held');

  // Forget removes the one loop.
  await row.getByRole('button', { name: 'Forget Send Priya the Q4 deck' }).click();
  await expect(card).toContainText('Nothing is held.', { timeout: 15_000 });

  // Stop and wipe asks first, in the page; Cancel changes nothing, Wipe switches off.
  await card.getByRole('button', { name: 'Stop and wipe' }).click();
  await expect(card.getByRole('alert')).toContainText('deletes every held loop');
  await card.getByRole('button', { name: 'Cancel' }).click();
  expect(brain.loopCalls).toEqual(['set gmail on', 'forget l1']);
  await card.getByRole('button', { name: 'Stop and wipe' }).click();
  await card.getByRole('button', { name: 'Wipe' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });
  expect(brain.loopCalls).toEqual(['set gmail on', 'forget l1', 'wipe']);
});
