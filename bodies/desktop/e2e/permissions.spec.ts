/**
 * Home's Permissions list on the fake brain: Settings shows each tool, a click on a switch
 * reaches the brain as set_permission, and a locked tool is marked risky.
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
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-permissions-'));
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

test('Home settings lists permissions and a switch reaches the brain', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');

  const card = home.getByRole('region', { name: 'Permissions' });
  const move = card.getByRole('switch', { name: 'desktop__move_window' });
  await expect(move).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });

  // A locked tool is marked risky; its switch works but warns before Auto.
  await expect(card.getByRole('switch', { name: 'desktop__close_window' })).toBeEnabled();
  await expect(card).toContainText('Risky action');

  await move.click();
  await expect(move).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  expect(brain.permissionSets).toEqual([{ tool: 'desktop__move_window', mode: 'auto' }]);
});
