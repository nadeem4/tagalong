/**
 * Home's Devices page on the fake brain: a remote brain's card names its machine and offers no
 * restart, and revoking a paired device removes its row. No process is started.
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
    devices: [{ id: 'd2', name: 'Chrome on laptop', kind: 'browser' }],
  });
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-devices-')));
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

test('a remote brain names its machine and cannot be restarted from here', async () => {
  const home = await homeWindow();
  await home.getByRole('button', { name: 'Overview', exact: true }).click();
  const card = home.getByRole('region', { name: "Scout's brain" });
  await expect(card).toContainText('Studio-PC', { timeout: 30_000 });
  await expect(card.getByRole('button', { name: /restart/i })).toHaveCount(0);
});

test('revoking a device removes its row', async () => {
  const home = await homeWindow();
  await home
    .getByRole('navigation')
    .getByRole('button', { name: /^Devices/ })
    .click();
  await expect(home.getByText('Chrome on laptop')).toBeVisible({ timeout: 30_000 });
  await home.getByRole('button', { name: 'Revoke' }).click();
  await home.getByRole('button', { name: /^Yes, revoke/ }).click();
  await expect(home.getByText('Chrome on laptop')).toHaveCount(0);
});
