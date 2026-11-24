/**
 * The Runs on control and the Ask me card on the fake brain, with a brain on another machine:
 * choosing This PC on an app row calls placement_set, and the where-ask offers both places.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { seedSettings } from './fixtures/seed-settings';
import { launchEnv } from './fixtures/launch-env';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const REMOTE_STATUS = {
  version: '0.0.1',
  build: 'x',
  pid: 4242,
  started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  started_by: 'service',
  addr: '100.64.0.7:47321',
  data_dir: 'C:/Users/you/.tagalong',
  log_path: 'C:/Users/you/.tagalong/brain.log',
  places: [{ id: 'desktop', kind: 'desktop', name: 'Desktop' }],
  work_running: false,
  host: 'Studio-PC',
  local: false,
};

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain({
    hasKey: true,
    brainStatus: REMOTE_STATUS,
  });
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-runs-on-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...launchEnv(dataDir), TAGALONG_BRAIN_ADDR: brain.addr, TAGALONG_START_BRAIN: '0' },
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

async function homeWindow(): Promise<Page> {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  return windowFor('home');
}

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const page = app.windows().find((p) => p.url().includes(`${name}.html`));
    if (page !== undefined) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

test('choosing This PC on an app row sets its placement', async () => {
  const home = await homeWindow();
  await home.getByRole('button', { name: 'Connections' }).click();
  const row = home.getByRole('region', { name: 'Files' });
  await row.getByRole('button', { name: 'Runs on, Files: Studio-PC' }).click({ timeout: 30_000 });
  await home.getByRole('button', { name: /^This PC/ }).click();
  await expect.poll(() => brain.placementCalls, { timeout: 15_000 }).toEqual(['app files body']);
  await expect(row.getByRole('button', { name: 'Runs on, Files: This PC' })).toBeVisible();
});

test('the Ask me card shows both places and Remember my choice keeps the answer', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill('please where ask');
  await field.press('Enter');
  const card = panel.getByRole('region', { name: 'Where should Files run?' });
  await expect(card.getByRole('button', { name: 'Studio-PC' })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByRole('button', { name: 'This PC' })).toBeVisible();
  await card.getByRole('checkbox', { name: 'Remember my choice for Files' }).check();
  await card.getByRole('button', { name: 'Studio-PC' }).click();
  await expect.poll(() => brain.placementCalls.at(-1), { timeout: 15_000 }).toBe('app files brain');
  await expect
    .poll(() => brain.answers.at(-1), { timeout: 15_000 })
    .toMatchObject({ option: 'Brain' });
});
