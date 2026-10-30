/**
 * End-to-end: the launch across launches on one profile (signed out, clean quit, signed in).
 * With a brain, the line is the launch check-in's: the fake mind's.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
test.skip(true, 'returns with row 10: launch greeting (scheduler events)');

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
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

test('signed out: a status mark on Scout and in the line, and Fix it opens Settings', async () => {
  const panel = await windowFor('panel');
  await expect(panel.getByText('Can’t think: signed out of Claude.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel.getByText(/I can.t think yet/)).toHaveCount(0);
  const avatar = await windowFor('avatar');
  await expect(avatar.getByTestId('status-mark')).toHaveAttribute('data-id', 'brain-signed-out');
  await panel.getByRole('button', { name: 'Fix it' }).click();
  await windowFor('home');
});

test('a clean quit records the close and this version', async () => {
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  expect(settingsFile()['closedCleanly']).toBe(false);
  await quit();
  expect(settingsFile()['closedCleanly']).toBe(true);
  expect(settingsFile()['lastVersion']).toBe(version);
});

test('signed in: the next launch’s line is the mind’s, from the launch check-in', async () => {
  app = await launch('signed-in');
  const panel = await windowFor('panel');
  await expect(panel.getByText('This is the fake pet.', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
});
