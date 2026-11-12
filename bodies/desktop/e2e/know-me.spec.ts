/**
 * Get to know me end to end on the fake brain: the tour's skippable step (a run started there
 * never blocks Next, and the finish card is still reached) and Home's memory page (press the
 * button, give a username, see progress, then the portrait and the facts it is based on).
 * No real GitHub or Claude call: the fake brain answers `know_me_start` with canned status frames.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';
import { seedSettings } from './fixtures/seed-settings';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication | undefined;
let brain: FakeBrain | undefined;
let dataDir: string | undefined;

test.afterEach(async () => {
  try {
    await closeApp(app);
  } finally {
    app = undefined;
    await brain?.close();
    brain = undefined;
    if (dataDir !== undefined) {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
    dataDir = undefined;
  }
});

async function launch(seeded: boolean): Promise<void> {
  brain = await startFakeBrain({ hasKey: true });
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-know-'));
  if (seeded) seedSettings(dataDir);
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr, TAGALONG_START_BRAIN: '0' },
  });
}

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    for (const page of app?.windows() ?? []) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

test('know me: tour, start a run, move on, the finish card is still reached', async () => {
  await launch(false);
  const tour = await windowFor('walkthrough');
  for (let at = 1; at < 9; at += 1) {
    await tour.getByRole('button', { name: /^(Get started|Next)$/ }).click();
  }
  await expect(tour.getByText('A key is already set.')).toBeVisible({ timeout: 30_000 });
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByRole('heading', { name: 'Let Scout get to know you' })).toBeVisible();
  await tour.getByLabel('GitHub', { exact: true }).fill('octocat');
  await tour.getByRole('button', { name: 'Get to know me' }).click();
  await expect(tour.getByText('Reading GitHub…')).toBeVisible();
  expect(brain!.knowStarts).toEqual([{ github: 'octocat' }]);
  // Starting did not block Next, and the run goes on while the person moves on.
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByRole('heading', { name: 'Connect your tools' })).toBeVisible();
  await tour.getByRole('button', { name: 'Finish' }).click();
  await expect(tour.getByRole('heading', { name: 'Scout is on your screen' })).toBeVisible();
});

test('know me: Home, press the button, see Reading GitHub then the portrait and the facts', async () => {
  await launch(true);
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home
    .getByRole('navigation', { name: 'Tagalong' })
    .getByRole('button', { name: 'What Scout remembers', exact: true })
    .click();
  await home.getByRole('button', { name: 'Get to know me', exact: true }).click();
  await home.getByLabel('GitHub', { exact: true }).fill('octocat');
  await home.getByRole('button', { name: 'Get to know me', exact: true }).click();
  await expect(home.getByText('Reading GitHub…')).toBeVisible();
  await expect(home.getByRole('heading', { name: "Here's who I think you are" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    home
      .getByRole('region', { name: 'Get to know me' })
      .getByText('You build things end to end, mostly in TypeScript.'),
  ).toBeVisible();
  await home.getByRole('button', { name: /What's this based on\?/ }).click();
  await expect(home.getByText('Writes TypeScript').first()).toBeVisible();
  await home.getByRole('button', { name: 'Done' }).click();
  // The page now shows the portrait block and the new fact with where it came from.
  await expect(home.getByRole('region', { name: 'Scout’s portrait of you' })).toBeVisible();
  await expect(home.getByRole('button', { name: 'Get to know me again' })).toBeVisible();
  await expect(home.getByRole('listitem').filter({ hasText: 'Writes TypeScript' })).toContainText(
    'GitHub',
  );
});
