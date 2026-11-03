/**
 * Home's Permissions list on the fake brain: Settings shows each tool under its source, a click
 * on Off, Ask or Auto reaches the brain as set_permission, a locked tool is marked risky and a
 * person-only tool never offers Auto.
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
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-permissions-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
    },
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

test('Home settings lists permissions by source and a click reaches the brain', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');

  const card = home.getByRole('region', { name: 'Permissions' });
  const move = card.getByRole('radiogroup', { name: 'desktop__move_window' });
  await expect(move.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true', {
    timeout: 30_000,
  });

  // Tools sit under their source: built in, this desktop, the browser, each app.
  const headings = card.getByRole('heading', { level: 3 });
  await expect(headings).toHaveText(['Built in', 'This desktop', 'Browser', 'Gmail']);

  // A person-only app tool never offers Auto; a tool of a body that is away is marked.
  const mail = card.getByRole('radiogroup', { name: 'gmail__delete_mail' });
  await expect(mail.getByRole('radio')).toHaveText(['Off', 'Ask']);
  await expect(card).toContainText('Not connected');

  // A locked tool is marked risky and warns before Auto.
  await expect(card).toContainText('Risky action');
  const close = card.getByRole('radiogroup', { name: 'desktop__close_window' });
  await close.getByRole('radio', { name: 'Auto' }).click();
  await expect(card.getByRole('alert')).toContainText('no longer ask');
  await card.getByRole('button', { name: 'Cancel' }).click();
  expect(brain.permissionSets).toEqual([]);

  await move.getByRole('radio', { name: 'Auto' }).click();
  await expect(move.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true', {
    timeout: 15_000,
  });
  await move.getByRole('radio', { name: 'Off' }).click();
  await expect(move.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true', {
    timeout: 15_000,
  });
  expect(brain.permissionSets).toEqual([
    { tool: 'desktop__move_window', mode: 'auto' },
    { tool: 'desktop__move_window', mode: 'off' },
  ]);
});
