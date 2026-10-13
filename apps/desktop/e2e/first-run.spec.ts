import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let dataDir: string;

test.beforeAll(async () => {
  // A new install: an empty user-data directory, and Welcome left to open by itself. Its
  // own directory also gives it its own single-instance lock, apart from the smoke suite.
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-first-run-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_FAKE_PROVIDERS: '1', TAGALONG_FAKE_TTS: '1' },
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
  throw new Error(`no ${name} window appeared`);
}

/** Whether the window for an entry point is on screen. */
async function visible(name: string): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, page) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.webContents.getURL().includes(`${page}.html`) && w.isVisible(),
      ),
    name,
  );
}

test('a new install shows Welcome alone; Scout arrives when Welcome is done', async () => {
  const welcome = await windowFor('onboarding');
  await expect(welcome.getByRole('button', { name: 'Start' })).toBeVisible();
  await windowFor('avatar');
  expect(await visible('avatar')).toBe(false);

  // Closed without Start, Scout still comes: never an install with nothing on screen.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes('onboarding.html')) w.close();
    }
  });
  await expect.poll(() => visible('avatar')).toBe(true);
});
