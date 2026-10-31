/**
 * Home's "Where things run" card on the fake brain: Overview shows the address the desktop dials
 * (with link state), each connected app by command or web address, and Claude Code.
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
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-where-'));
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

test('Overview shows where the brain, apps and Claude Code run', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  // openSettings lands on Settings; the card lives on Overview.
  await home.getByRole('button', { name: 'Overview', exact: true }).click();

  const card = home.getByRole('region', { name: 'Where things run' });
  await expect(card).toContainText(`ws://${brain.addr}`, { timeout: 30_000 });
  await expect(card).toContainText('Connected');
  await expect(card).toContainText('node files-server.js');
  await expect(card).toContainText('https://wiki.example.com/mcp');
  await expect(card).toContainText('Claude Code');
});
