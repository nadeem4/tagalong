import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` it carries: it is what types `window.tagalongHost`
// inside the page evaluate below, so a renamed host method fails the typecheck, not the run.
import type {} from '../src/shared/ipc';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * One app for the whole file.
 *
 * Electron's single-instance lock means a second launch quits instead of starting, so
 * relaunching per test only works if every previous instance shut down cleanly — and when
 * one does not, the failure surfaces as an unrelated "no window appeared" in the *next*
 * test. One launch keeps a real failure attributable to the thing that broke.
 */
let app: ElectronApplication;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    // Fake providers keep the smoke test offline and deterministic: no API key, no
    // network, and a scripted answer that always streams the same way.
    env: { ...process.env, TAGALONG_FAKE_PROVIDERS: '1' },
  });
});

test.afterAll(async () => {
  await app.close();
});

/** Waits for the renderer window whose URL names the given entry point. */
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

test('the app launches with its avatar and its panel', async () => {
  const avatar = await windowFor('avatar');
  await expect(avatar.locator('body')).toBeVisible();

  // Both windows are only created once the engine has booted — `start` returns early into
  // degraded mode if it did not — so seeing the pair is how the test knows the engine came
  // up. The panel starts hidden: it belongs to the hotkey, not to launch.
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL(),
      visible: w.isVisible(),
    })),
  );
  expect(windows.map((w) => w.url.replace(/^.*\//, '')).sort()).toEqual([
    'avatar.html',
    'panel.html',
  ]);
  expect(windows.find((w) => w.url.includes('panel.html'))?.visible).toBe(false);
});

test('ask streams an answer and completes the turn', async () => {
  const avatar = await windowFor('avatar');

  // Global hotkeys are unreliable on a CI desktop, so the panel is opened through the host
  // API the preload already exposes rather than by simulating Ctrl+Shift+Space.
  await avatar.evaluate(() => window.tagalongHost.togglePanel());

  const panel = await windowFor('panel');
  // The panel shows "Waking the crew…" until pets.list answers, so the composer is not in
  // the DOM the moment the window appears.
  const composer = panel.getByLabel('Message');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  await composer.fill('what is on my screen?');
  await composer.press('Enter');

  // The question is echoed back as a settled user message.
  await expect(panel.locator('[data-role="user"]').first()).toContainText('what is on my screen?', {
    timeout: 15_000,
  });

  // The streaming bubble is deliberately NOT asserted here. It exists only between the
  // first turn.delta and turn.completed, and the fake provider streams with no delay, so
  // the whole turn can finish between two Playwright polls — the bubble may never be
  // observable. Its incremental growth is covered deterministically in
  // packages/ui/src/chat-panel.test.tsx, which drives the deltas through a fake bridge.
  //
  // What this test asserts is the settled end state. The streaming bubble also carries
  // data-role="assistant", so it has to be excluded or this assertion could pass mid-stream.
  const settled = panel.locator('[data-role="assistant"]:not([data-testid="streaming-message"])');
  await expect(settled.first()).toBeVisible({ timeout: 30_000 });
  await expect(settled.first()).not.toBeEmpty();
  await expect(panel.getByTestId('streaming-message')).toHaveCount(0, { timeout: 30_000 });
});
