/**
 * End-to-end: Always listening is off at launch, on only when switched, hears and answers, and
 * switches off.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` it carries: it types `window.tagalongHost` below.
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let app: ElectronApplication;
let brain: FakeBrain;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  app = await electron.launch({
    // A fresh profile: Always listening is off at launch, as on a new install.
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tagalong-listening-'))}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
      TAGALONG_FAKE_TTS: '1',
      TAGALONG_FAKE_STT: '1',
    },
  });
});

test.afterAll(async () => {
  try {
    await closeApp(app);
  } finally {
    await brain.close();
  }
});

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const page = app.windows().find((p) => p.url().includes(`${name}.html`));
    if (page !== undefined) return page;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no ${name} window`);
}

test('Always listening: off at launch, on only when switched, Scout hears and answers, off again', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');

  const toggle = panel.getByRole('switch', { name: 'Always listening' });
  await toggle.waitFor({ state: 'visible', timeout: 30_000 });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(avatar.getByTestId('listening-mark')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(avatar.getByTestId('listening-mark')).toHaveAttribute('data-state', 'on');
  // Switching on shows "Listening" on Scout for a few seconds: a mark, not a spoken line.
  await expect(avatar.getByTestId('status-mark')).toHaveAttribute('data-id', 'listening-on');

  // The fake ears end one turn by themselves after a few frames of Chromium's fake mic. They
  // say "Scout, what am I looking at?": the bubble asks it without the name.
  await expect(panel.getByText(/what am I looking at\?/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel.getByText(/This is the fake brain/)).toBeVisible({ timeout: 30_000 });

  await panel.getByRole('switch', { name: 'Always listening' }).click();
  await expect(avatar.getByTestId('listening-mark')).toHaveCount(0);
});
