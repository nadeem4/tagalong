/**
 * The companion chat on the fake brain: Scout's own remark stays when the quiet line is opened
 * and in the full chat, the log sits on the newest message, and the empty chat names the talk key.
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
import { seedSettings } from './fixtures/seed-settings';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-chat-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr },
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

const REMARK = 'Your 3pm with Dana moved to 3:30. Want me to push the review back too?';

test('the empty chat names the talk key, and collapse and close are icon buttons', async () => {
  const panel = await windowFor('panel');
  await panel.getByRole('button', { name: 'Open full chat' }).click();
  const log = panel.getByRole('log');
  await expect(log.getByText(/Hold .+ to talk/)).toBeVisible({ timeout: 30_000 });
  await expect(log.locator('kbd')).not.toHaveText('');
  await expect(panel.getByRole('button', { name: 'Close' }).locator('svg')).toBeVisible();
  const back = panel.getByRole('button', { name: 'Back to bubble' });
  await expect(back.locator('svg')).toBeVisible();
  await back.click();
  await expect(panel.getByLabel(/^Ask /)).toBeVisible();
});

test('clicking the quiet line opens the bubble with the remark', async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.hidePanel());
  brain.sendRemark(REMARK);

  const line = panel.getByRole('button', { name: 'Ask Scout something' });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.click();

  await expect(panel.getByLabel(/^Ask /)).toBeVisible();
  await expect(panel.getByText(REMARK)).toBeVisible();
});

test('expand to full chat shows the remark and the answer to a follow-up', async () => {
  const panel = await windowFor('panel');
  await panel.getByRole('button', { name: 'Open full chat' }).click();
  const field = panel.getByLabel('Message Scout');
  await field.fill('Yes, and tell Marco too');
  await field.press('Enter');

  const log = panel.getByRole('log');
  await expect(log.getByText('This is the fake brain.')).toBeVisible({ timeout: 30_000 });
  await expect(log.getByText(REMARK)).toBeVisible();
  await expect(log.getByText('Yes, and tell Marco too')).toBeVisible();
});

test('the chat log opens on the newest message and stays pinned while an answer arrives', async () => {
  const panel = await windowFor('panel');
  const log = panel.getByRole('log');
  const field = panel.getByLabel('Message Scout');
  const before = await log.getByText('This is the fake brain.').count();
  for (let i = 0; i < 12; i += 1) {
    await field.fill(`Question number ${i} with enough words to take a line or two on screen`);
    await field.press('Enter');
    await expect(log.getByText('This is the fake brain.')).toHaveCount(before + i + 1, {
      timeout: 30_000,
    });
  }
  const atBottom = () =>
    log.evaluate(
      (el) =>
        el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
    );
  await expect.poll(atBottom).toBe(true);

  // Collapsing and opening again lands on the newest message too.
  await panel.getByRole('button', { name: 'Back to bubble' }).click();
  await panel.getByRole('button', { name: 'Open full chat' }).click();
  await expect.poll(atBottom).toBe(true);
});
