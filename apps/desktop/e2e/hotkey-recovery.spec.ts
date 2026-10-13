import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The lockout this file exists to prevent.
 *
 * Until the settings window could rebind the full-view and pause keys, an accelerator
 * that Windows refuses could not be stored at all. Now it can — a user types it, it saves,
 * and it is read back on the next launch. If that made the app stop on a modal error box
 * before any window appeared, the only surface for fixing it would be the settings file,
 * and the app that refused to start would be the one holding the settings window.
 *
 * It is not a hypothetical. It happened to this suite: a mutation run left
 * `Ctrl+Shift+Nonsense` in the real data directory and every later Playwright run failed
 * with "no avatar window appeared" — a broken app, and a symptom pointing nowhere near
 * the cause.
 *
 * No unit test can see this. Every hotkey test injects a fake registrar, so a refusal is
 * whatever the fake says it is and the app is never started at all.
 */
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
      providerId: 'fake',
      hotkeys: { ask: BAD, pauseSight: GOOD_PAUSE },
    }),
    'utf8',
  );

  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_FAKE_PROVIDERS: '1', TAGALONG_SKIP_ONBOARDING: '1' },
  });
});

test.afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
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
  // boot. Before this change the launch hung here with an empty window list.
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

test('the app works: the other hotkeys are bound and capture still runs', async () => {
  const panel = await windowFor('panel');

  // A started app that cannot do anything would satisfy the boot test and nothing else.
  const snapshot = await panel.evaluate(() => window.tagalong.capture(['screenshot']));
  expect(snapshot, 'capture must work despite one refused accelerator').not.toBeNull();

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
