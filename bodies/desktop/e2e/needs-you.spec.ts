/**
 * A remote brain's request on this PC, on the fake brain: the card names what this PC resolved,
 * Not now keeps the request in Home and tells the brain, and Allow runs this PC's own
 * `tagalong node allow` (against a throwaway home) before the brain is told to go on. An app
 * sign-in is caught on this PC's loopback and only its one-time code is sent. An install runs this
 * PC's own `tagalong install`; one that cannot finish stays on the card and tells the brain nothing.
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
import { freePort } from './fixtures/free-port';
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

test('An app sign-in finishes on this PC: the code reaches the brain, nothing else', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __opened?: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  const port = await freePort();
  const authorize = `https://accounts.example/authorize?state=s1&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}`;
  brain.sendNodeNeeds({
    id: 'g1',
    state: 'open',
    need: 'app_signin',
    app: 'Gmail',
    url: authorize,
    port,
  });
  const panel = await windowFor('panel');
  const card = panel.getByRole('region', { name: 'Needs you on this PC' });
  await expect(card).toContainText('Finish signing in to Gmail', { timeout: 30_000 });
  await expect(card).toContainText('kept on');
  expect(await app.evaluate(() => (globalThis as { __opened?: string[] }).__opened)).toEqual([
    authorize,
  ]);

  // The browser on this PC follows the redirect to the desktop's own loopback.
  const back = await fetch(`http://127.0.0.1:${port}/callback?code=one-time&state=s1`);
  expect(back.status).toBe(200);
  await expect
    .poll(() => brain.nodeAnswers.at(-1), { timeout: 30_000 })
    .toEqual({ id: 'g1', outcome: 'done', code: 'one-time', state: 's1' });
  await expect(
    panel.getByText(/Gmail is signed in on .* You can close the browser tab\./),
  ).toBeVisible();
});

test('An install asked for here shows the expert by name and fails in place when it cannot install', async () => {
  const before = brain.nodeAnswers.length;
  brain.sendNodeNeeds({
    id: 'i1',
    state: 'open',
    node: 'node-1',
    need: 'install',
    expert: 'no-such-expert',
    spec: { expert: 'no-such-expert' },
  });
  const panel = await windowFor('panel');
  const card = panel.getByRole('region', { name: 'Needs you on this PC' });
  await expect(card).toContainText('is not on this PC yet', { timeout: 30_000 });
  await card.getByRole('button', { name: 'Install' }).click();
  await expect(card.getByRole('alert')).toBeVisible({ timeout: 120_000 });
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(brain.nodeAnswers).toHaveLength(before);
});
