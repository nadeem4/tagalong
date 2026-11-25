/**
 * A remote brain's request on this PC, on the fake brain: the card names what this PC resolved,
 * Not now keeps the request in Home and tells the brain, and Allow runs this PC's own
 * `tagalong node allow` (against a throwaway home) before the brain is told to go on.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` that types `window.tagalongHost`.
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { seedSettings } from './fixtures/seed-settings';
import { launchEnv } from './fixtures/launch-env';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-needs-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...launchEnv(dataDir), TAGALONG_BRAIN_ADDR: brain.addr },
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

const ask = (id: string, command: string, args: string[]) => ({
  id,
  state: 'open',
  node: 'node-1',
  need: 'approve',
  spec: { command, args },
});

test.describe.configure({ mode: 'serial' });

test('Not now keeps the request in Home and tells the brain', async () => {
  await expect.poll(() => brain.hellos, { timeout: 30_000 }).toBeGreaterThan(0);
  brain.sendNodeNeeds(ask('n1', 'python', ['-V']));
  const panel = await windowFor('panel');
  const card = panel.getByRole('region', { name: 'Needs you on this PC' });
  await expect(card).toContainText('wants to run python -V here', { timeout: 30_000 });
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect.poll(() => brain.nodeAnswers).toEqual([{ id: 'n1', outcome: 'not_now' }]);
  await expect(panel.getByText(/The job waits/)).toBeVisible();

  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: /^Overview/ }).click();
  await expect(home.getByRole('region', { name: 'Needs you on this PC' })).toContainText(
    'Run python -V',
  );
});

test('Allow runs the allow command on this PC, then tells the brain to go on', async () => {
  const home = await windowFor('home');
  const section = home.getByRole('region', { name: 'Needs you on this PC' });
  await section.getByRole('button', { name: 'Allow' }).click();
  await expect
    .poll(() => brain.nodeAnswers, { timeout: 120_000 })
    .toEqual([
      { id: 'n1', outcome: 'not_now' },
      { id: 'n1', outcome: 'done' },
    ]);
  const list = join(dataDir, 'node', 'allowlist.json');
  expect(existsSync(list)).toBe(true);
  expect(readFileSync(list, 'utf8')).toContain('python');
  await expect(section).toHaveCount(0);
});
