import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await closed;
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
  await expect(panel.getByText(/signed out of Claude, so I can.t think yet/)).toBeVisible();
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
  await expect(panel.getByText('This is the fake pet.', { exact: false })).toBeVisible();
});
