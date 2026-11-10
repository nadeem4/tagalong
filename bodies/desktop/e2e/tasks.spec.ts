/**
 * Home's Tasks page on the fake brain: the Now card shows a waiting ask (answered with Allow), a
 * running job and a timer about to fire; the tabs carry counts; Cancel on the Timers tab reaches
 * the brain.
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
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-tasks-')));
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

test('Now shows a waiting ask, a running job and a timer; the tabs count and Cancel reaches the brain', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill('please ask me for permission');
  await field.press('Enter');
  await expect(panel.getByRole('region', { name: 'Allow desktop__move_window?' })).toBeVisible({
    timeout: 30_000,
  });

  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(home.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();

  brain.setTimers([
    {
      id: 't1',
      note: 'stretch your legs',
      next_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      repeat_minutes: null,
      pending: false,
    },
    {
      id: 't2',
      note: 'water the plants',
      next_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      repeat_minutes: 60,
      pending: false,
    },
  ]);

  const now = home.getByRole('region', { name: 'Now' });
  await expect(now).toContainText('I will move the Notes window.', { timeout: 30_000 });
  await expect(now).toContainText('Fix the build', { timeout: 30_000 });
  await expect(now).toContainText('stretch your legs');
  await expect(now).toContainText(/in (19|20) min/);
  await expect(now).not.toContainText('water the plants');

  await expect(home.getByRole('tab', { name: 'Jobs (2)' })).toBeVisible({ timeout: 15_000 });
  await expect(home.getByRole('tab', { name: 'Timers (2)' })).toBeVisible({ timeout: 15_000 });

  await now.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect
    .poll(() => brain.answers, { timeout: 15_000 })
    .toEqual([{ ask: 'a1', option: 'allow' }]);
  await expect(now).not.toContainText('I will move the Notes window.');

  await home.getByRole('tab', { name: /^Timers/ }).click();
  await home.getByRole('button', { name: 'Cancel water the plants' }).click();
  await expect.poll(() => brain.timerCancels, { timeout: 15_000 }).toEqual(['t2']);
  await expect(home.getByRole('tab', { name: 'Timers (1)' })).toBeVisible({ timeout: 15_000 });
});
