/**
 * Approvals on the fake brain: Home's Approvals page lists preferences, counts and history,
 * Remove reaches the brain, the Scout filter narrows the history, an `approved` notice brings
 * up the hidden bubble with the report card, and an offer ask is answered with its yes option.
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
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-approvals-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
      TAGALONG_FAKE_PROVIDERS: '1',
      TAGALONG_FAKE_TTS: '1',
      TAGALONG_SKIP_WELCOME: '1',
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

const panelShown = (): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (w) => w.webContents.getURL().includes('panel.html') && w.isVisible(),
    ),
  );

test.describe.configure({ mode: 'serial' });

test('approvals page shows preferences, counts and history', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Approvals', exact: true }).click();

  const prefs = home.getByRole('list', { name: 'Standing preferences' });
  await expect(prefs).toContainText('Always ask me before risky actions', { timeout: 30_000 });
  await expect(prefs).toContainText('Approve test runs in C:/work/app');
  await expect(prefs).toContainText('Used 3 times');

  const summary = home.getByRole('group', { name: 'Summary' });
  await expect(summary).toContainText('3asks');
  await expect(summary).toContainText('1Scout answered');
  await expect(summary).toContainText('1refused');

  const history = home.getByRole('region', { name: 'Approvals history' });
  await expect(history).toContainText('Run pnpm test');
  await expect(history).toContainText('Delete the build folder');
  await expect(history).toContainText('Decided by you');
});

test('a Scout-decided row is marked and the Scout filter shows only it', async () => {
  const home = await windowFor('home');
  const history = home.getByRole('region', { name: 'Approvals history' });
  await expect(history).toContainText('Scout decided, per your preference');
  await expect(history).toContainText('Approve test runs in C:/work/app');

  await history.getByRole('button', { name: /Decided by Scout/ }).click();
  await expect(history).toContainText('Run pnpm test');
  await expect(history).not.toContainText('Delete the build folder');
  await history.getByRole('button', { name: /^All/ }).click();
  await expect(history).toContainText('Delete the build folder');
});

test('removing a preference updates the list', async () => {
  const home = await windowFor('home');
  const prefs = home.getByRole('list', { name: 'Standing preferences' });
  await prefs.getByRole('button', { name: 'Remove: Approve test runs in C:/work/app' }).click();
  await expect.poll(() => brain.removedPreferences, { timeout: 15_000 }).toEqual([2]);
  await expect(prefs).not.toContainText('Approve test runs in C:/work/app', { timeout: 15_000 });
  await expect(prefs).toContainText('Always ask me before risky actions');
});

test('an approved notice shows the report card', async () => {
  // The bubble is still hidden: only the main process forwarding the notice can bring it up.
  expect(await panelShown()).toBe(false);
  brain.sendApproved({
    tool: 'claude_code:Run tests',
    text: 'Claude Code running pnpm test',
    preference: 'Approve test runs in C:/work/app',
  });
  await expect.poll(panelShown, { timeout: 15_000 }).toBe(true);
  const panel = await windowFor('panel');
  const card = panel.getByRole('status', { name: 'Approved for you' });
  await expect(card).toContainText('Approved for you: Claude Code running pnpm test');
  await expect(card).toContainText("per 'Approve test runs in C:/work/app'");
});

test('a panel that came up only for the card hides again once the hold ends', async () => {
  // The card holds 7 s; the panel was never focused, so only the card can hide it again.
  await expect.poll(panelShown, { timeout: 20_000 }).toBe(false);
});

test('an offer ask is answered with Yes, auto-approve', async () => {
  const panel = await windowFor('panel');
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill('make me an offer');
  await field.press('Enter');

  const offer = panel.getByRole('region', { name: 'Scout asks' });
  await expect(offer).toContainText('auto-approve', { timeout: 30_000 });
  await offer.getByRole('button', { name: 'Yes, auto-approve', exact: true }).click();
  await expect
    .poll(() => brain.answers, { timeout: 15_000 })
    .toEqual([{ ask: 'o1', option: 'Yes, auto-approve' }]);
});
