/**
 * The brain's permission ask, end to end on the fake brain: the bubble shows the ask in
 * Scout's words, and a click on Always allow reaches the brain as an `answer` frame.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` that types `window.tagalongHost`.
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-asks-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
      TAGALONG_FAKE_SIGN_IN: 'signed-in',
      TAGALONG_FAKE_TTS: '1',
    },
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

test('an ask shows in the bubble and Always allow answers the brain', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill('please ask me for permission');
  await field.press('Enter');

  const card = panel.getByRole('region', { name: 'Allow desktop__move_window?' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('I will move the Notes window.');

  await card.getByRole('button', { name: 'Always allow' }).click();
  await expect
    .poll(() => brain.answers, { timeout: 15_000 })
    .toEqual([{ ask: 'a1', option: 'always' }]);
  await expect(card).toHaveCount(0);
  await expect(panel.getByText(/This is the fake brain/)).toBeVisible({ timeout: 30_000 });
});
