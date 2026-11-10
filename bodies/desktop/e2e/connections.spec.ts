/**
 * Home's Connections page on the fake brain: search the app registry, the Official version comes
 * first, a community version opens the check card before it connects, and the Official Connect
 * goes to the brain approved at once.
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
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-connections-')));
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

test('search_shows_official_first_then_community_card', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Connections' }).click();

  await home.getByRole('searchbox', { name: 'Search apps' }).fill('notion');
  const results = home.getByRole('list', { name: 'Results' });
  await expect(results.getByText('Official', { exact: true })).toBeVisible({ timeout: 15_000 });

  // A community version opens the check card first, and Back closes it without connecting.
  await results.getByRole('button', { name: /Show 2 other versions/ }).click();
  await results.getByRole('button', { name: 'Connect io.example/notion-a' }).click();
  const card = home.getByRole('group', { name: 'Check before connecting' });
  await expect(card).toContainText('Not yet audited by anyone');
  await card.getByRole('button', { name: 'Back' }).click();
  await expect(card).toHaveCount(0);
  expect(brain.appSetups).toEqual([]);

  // The Official Connect goes straight to the brain, approved.
  await results.getByRole('button', { name: 'Connect Notion' }).click();
  await expect.poll(() => brain.appSetups, { timeout: 15_000 }).toEqual(['com.notion/mcp']);
  expect(brain.appFlags[0]?.approved).toBe(true);
});
