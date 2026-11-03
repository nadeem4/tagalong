/**
 * Settings > Files Scout may use on the fake brain: no folder at first, Add folder (the system
 * picker is stubbed to answer a temp folder) lists and saves it, and Remove empties the list and
 * the saved settings at once. The file tools themselves are covered by the unit tests.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;
let chosen: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-folders-')));
  chosen = mkdtempSync(join(tmpdir(), 'tagalong-chosen-'));
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
    for (const dir of [dataDir, chosen]) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
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

const saved = (): string[] =>
  (JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as { fileFolders?: string[] })
    .fileFolders ?? [];

test.describe.configure({ mode: 'serial' });

test('adding a folder lists it and saves it; removing takes it away at once', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await expect(home.getByText('No folders yet.')).toBeVisible({ timeout: 30_000 });

  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  await home.getByRole('button', { name: 'Add folder' }).click();
  await expect(home.getByText(chosen)).toBeVisible();
  expect(saved()).toEqual([chosen]);

  await home.getByRole('button', { name: `Remove ${chosen}` }).click();
  await expect(home.getByText('No folders yet.')).toBeVisible();
  expect(saved()).toEqual([]);
});
