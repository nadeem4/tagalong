/**
 * End-to-end: Scout's launch line across launches on one profile (signed out, clean quit,
 * signed in, back after a long break).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let app: ElectronApplication;
let dataDir: string;

// One data directory across three launches: each test depends on what the last one left.
test.describe.configure({ mode: 'serial' });

/** TAGALONG_FAKE_SIGN_IN stands in for the Claude Code sign-in check, so no claude binary runs. */
function launch(signIn: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_FAKE_PROVIDERS: '1',
      TAGALONG_FAKE_TTS: '1',
      TAGALONG_FAKE_SIGN_IN: signIn,
    },
  });
}

async function quit(): Promise<void> {
  const closed = app.waitForEvent('close');
  // The evaluate can reject as the process exits; the close event is what matters.
  await Promise.all([
    closed,
    app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined),
  ]);
}

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of app.windows()) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

const settingsFile = () =>
  JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as Record<string, unknown>;

test.beforeAll(async () => {
  // Setup finished, and the last launch never closed cleanly on an older version.
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-launch-'));
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({ welcome: { done: true }, closedCleanly: false, lastVersion: '0.0.1' }),
    'utf8',
  );
  app = await launch('signed-out');
});

test.afterAll(async () => {
  await app.close().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
});

test('signed out: the launch line says so plainly, and Fix it opens Settings', async () => {
  const panel = await windowFor('panel');
  await expect(panel.getByText(/signed out of Claude, so I can.t think yet/)).toBeVisible({
    timeout: 30_000,
  });
  await panel.getByRole('button', { name: 'Fix it' }).click();
  await windowFor('office');
});

test('a clean quit records the close and this version', async () => {
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  expect(settingsFile()['closedCleanly']).toBe(false);
  await quit();
  expect(settingsFile()['closedCleanly']).toBe(true);
  expect(settingsFile()['lastVersion']).toBe(version);
});

test('signed in: the next launch says the brain’s own line', async () => {
  app = await launch('signed-in');
  const panel = await windowFor('panel');
  await expect(panel.getByText('This is the fake pet.', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
});

test('back after a long break: the launch line offers to pick up, and the card opens on a click', async () => {
  await quit();
  // A snapshot from eight hours ago, as last night's session would leave it. Written by
  // Electron run as Node; better-sqlite3's prebuilt N-API binary loads there as in the app.
  const takenAt = new Date(Date.now() - 8 * 3_600_000).toISOString();
  const snapshot = JSON.stringify({
    projects: [{ name: 'ai_pet', path: dataDir, editor: 'other', branch: 'feat/pick-up' }],
    handoffs: [],
  });
  const seed =
    "const D = require('better-sqlite3'); const db = new D(process.argv[1]);" +
    " db.prepare('INSERT OR REPLACE INTO pick_up (id, started_at, taken_at, json) VALUES (1, ?, ?, ?)')" +
    '.run(process.argv[2], process.argv[2], process.argv[3]); db.close();';
  const electronPath = createRequire(import.meta.url)('electron') as unknown as string;
  execFileSync(electronPath, ['-e', seed, join(dataDir, 'tagalong.db'), takenAt, snapshot], {
    cwd: appDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  app = await launch('signed-in');
  const panel = await windowFor('panel');
  await expect(panel.getByText(/you were in ai_pet on feat\/pick-up/)).toBeVisible({
    timeout: 30_000,
  });
  await panel.getByRole('button', { name: 'Pick up' }).click();
  await expect(panel.getByRole('region', { name: 'Pick up where you left off' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Open the ai_pet folder' })).toBeVisible();
});
