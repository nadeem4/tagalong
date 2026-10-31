/**
 * End-to-end: an accelerator Windows refuses, saved in settings, must not stop the app before a
 * window appears. The app names the binding that broke, the panel shows it, and the other
 * hotkeys still work. No unit test can see this: every hotkey test injects a fake
 * registrar.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { freePort } from './fixtures/free-port';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let dataDir: string;

const BAD = 'Ctrl+Shift+Nonsense';
const GOOD_PAUSE = 'CommandOrControl+Shift+Alt+P';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Its own user-data directory, for two reasons: the single-instance lock is keyed on
  // it, so this app can run without fighting the smoke suite, and a deliberately broken
  // setting must never touch the directory a developer actually uses.
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-hotkey-'));
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      hotkeys: { ask: BAD, pauseSight: GOOD_PAUSE },
    }),
    'utf8',
  );

  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      // Nothing listens here, so the spec never dials a developer's real brain.
      TAGALONG_BRAIN_ADDR: `127.0.0.1:${await freePort()}`,
      TAGALONG_START_BRAIN: '0',
      TAGALONG_FAKE_TTS: '1',
    },
  });
});

test.afterAll(async () => {
  try {
    await closeApp(app);
  } finally {
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
  throw new Error(
    `no ${name} window appeared; saw ${app
      .windows()
      .map((w) => w.url())
      .join(', ')}`,
  );
}

test('the app still starts with an unregisterable accelerator stored', async () => {
  // The assertion is the whole point: reaching a window at all means no modal stopped
  // boot.
  const avatar = await windowFor('avatar');
  await expect(avatar.locator('body')).toBeVisible();
  await windowFor('panel');
});

test('the failure names the binding that broke, and says the rest still work', async () => {
  const panel = await windowFor('panel');
  const view = await panel.evaluate(() => window.tagalongHost.getHostView());

  expect(view.hotkeyError, 'a refused accelerator must be reported somewhere').toBeDefined();
  // Named in words the settings window uses, not only as an accelerator string: the two
  // hotkeys do different things, and the user needs to know which one they lost.
  expect(view.hotkeyError).toContain('Ask');
  expect(view.hotkeyError).toContain(BAD);
  expect(view.hotkeyError?.toLowerCase()).toContain('other');

  // The valid pause binding must not be dragged down with the broken one. If it were,
  // this message would name it too.
  expect(view.hotkeyError).not.toContain('Pause sight');
});

test('the panel shows the problem, so a user who cannot press the key can still see why', async () => {
  const panel = await windowFor('panel');
  const notice = panel.getByTestId('hotkey-problem');
  await notice.waitFor({ state: 'visible', timeout: 30_000 });
  await expect(notice).toContainText('Ask');
});

test('correcting the binding clears the problem without a restart', async () => {
  const panel = await windowFor('panel');

  // Fixing the binding clears the problem in the running app, which is the other half of
  // not being locked out: the user can recover without restarting.
  await panel.evaluate((keys) => window.tagalongHost.saveSettings({ hotkeys: keys }), {
    ask: 'CommandOrControl+Shift+Space',
    pauseSight: GOOD_PAUSE,
  });

  const fixed = await panel.evaluate(() => window.tagalongHost.getHostView());
  expect(fixed.hotkeyError, 'correcting the accelerator must clear the problem').toBeUndefined();
  await expect(panel.getByTestId('hotkey-problem')).toHaveCount(0);
});
