/**
 * Settings > Anthropic key on the fake brain: with no key the dock says Add key, a refused key
 * is told so and stays in the field, and an accepted key clears the field and reads "already
 * set". The fake brain keeps no key; only a fake one is ever typed here.
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
const FAKE_KEY = 'sk-ant-example-not-a-real-key';

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain({ hasKey: false, keyResults: ['invalid', 'ok'] });
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-key-')));
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

test.describe.configure({ mode: 'serial' });

test('no key shows the no-key state in the bubble and on the dock', async () => {
  const avatar = await windowFor('avatar');
  await expect(avatar.getByTestId('status-mark')).toHaveAttribute('data-id', 'no-key', {
    timeout: 30_000,
  });
  const panel = await windowFor('panel');
  await expect(panel.getByText('Add your Anthropic key to start.')).toBeAttached();
  await expect(panel.getByRole('button', { name: 'Add key' })).toBeAttached();
  // The button opens the walkthrough at its key step.
  await panel.getByRole('button', { name: 'Add key' }).dispatchEvent('click');
  const tour = await windowFor('walkthrough');
  expect(tour.url()).toContain('step=9');
});

test('invalid key shows not accepted and the field stays', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  const field = home.getByLabel('API key');
  await field.fill(FAKE_KEY);
  await home.getByRole('button', { name: 'Check key' }).click();
  await expect(home.getByText('That key was not accepted.')).toBeVisible({ timeout: 30_000 });
  await expect(field).toHaveValue(FAKE_KEY);
  expect(brain.keyAttempts).toBe(1);
});

test('valid key clears the field and shows already set', async () => {
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Check key' }).click();
  await expect(home.getByText('A key is already set.')).toBeVisible({ timeout: 30_000 });
  await expect(home.getByLabel('API key')).toHaveValue('');
  expect(brain.keyAttempts).toBe(2);
  // The no-key mark leaves with the key.
  const avatar = await windowFor('avatar');
  await expect(avatar.getByTestId('status-mark')).toHaveCount(0, { timeout: 30_000 });
});
