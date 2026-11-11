/**
 * Home's "Where things run" card on the fake brain: Overview shows the address the desktop dials
 * (with link state), each connected app by command or web address, and Claude Code.
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

// A brain from an older build that the person started: Tagalong must leave it alone and say so.
const OLD_BRAIN = { version: '0.0.1', build: 'old' };
const PERSON_STATUS = {
  ...OLD_BRAIN,
  pid: 18420,
  started_at: new Date(Date.now() - 25 * 60_000).toISOString(),
  started_by: 'person',
  addr: '127.0.0.1:47321',
  data_dir: 'C:\\Users\\you\\.tagalong',
  log_path: 'C:\\Users\\you\\.tagalong\\brain.log',
  places: [{ id: 'desktop', kind: 'desktop', name: 'Desktop' }],
  work_running: false,
};

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain({ hello: OLD_BRAIN, brainStatus: PERSON_STATUS });
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-where-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
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

test('Overview shows where the brain, apps and Claude Code run', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  // openSettings lands on Settings; the card lives on Overview.
  await home.getByRole('button', { name: 'Overview', exact: true }).click();

  const card = home.getByRole('region', { name: 'Where things run' });
  await expect(card).toContainText('node files-server.js', { timeout: 30_000 });
  await expect(card).toContainText('https://wiki.example.com/mcp');
  await expect(card).toContainText('Claude Code');
});

test('brain card shows version and update banner on a mismatched fake brain', async () => {
  // Opening Home again is harmless, and keeps this test runnable on its own.
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Overview', exact: true }).click();
  const card = home.getByRole('region', { name: "Scout's brain" });
  await expect(card).toContainText(`This PC · ${brain.addr}`, { timeout: 30_000 });
  await expect(card).toContainText('Brain 0.0.1');
  await expect(card).toContainText('You, from a terminal');
  await expect(card).toContainText('Running · Update ready');
  await expect(card).toContainText('Restart it in your terminal');
  // A brain the person started is never restarted from here: no button, and it stays connected.
  await expect(home.getByRole('button', { name: 'Restart now' })).toHaveCount(0);
  await expect(home.getByRole('button', { name: 'Restart brain' })).toHaveCount(0);
  await home.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(home.getByRole('status')).toContainText('Restart it in your terminal');
  await home.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(card).toContainText('Running · Update ready');
});

const READING_ROWS = (ocr: Record<string, unknown>) => [
  { capability: 'window-text', engine: 'windows-uia', where: 'this-pc', state: 'working' },
  { capability: 'text-from-pictures', engine: 'windows-ocr', where: 'this-pc', ...ocr },
];

test('shows a needs-a-fix row and asks Scout to fix it', async () => {
  brain.setReading(READING_ROWS({ state: 'needs-language-pack', language: 'en-US' }));
  const home = await windowFor('home');
  const card = home.getByRole('region', { name: 'Where things run' });
  await expect(card).toContainText('How Scout reads your screen', { timeout: 30_000 });
  await expect(card).toContainText('Needs a fix');
  await expect(card).toContainText('Windows has no text-recognition pack for English');

  const asked = brain.voice.says.length;
  await card.getByRole('button', { name: 'Ask Scout to fix it' }).click();

  // The companion opens and the person's words go to the brain as typed.
  await expect
    .poll(() => brain.voice.says.slice(asked).map((say) => say.text), { timeout: 15_000 })
    .toEqual(['Fix text from pictures']);
  const panel = await windowFor('panel');
  await expect(panel.getByText('Fix text from pictures')).toBeVisible();
});

test('an ask from Home still lands while the quiet line is showing', async () => {
  brain.setReading(READING_ROWS({ state: 'needs-language-pack', language: 'en-US' }));
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.hidePanel());
  brain.sendRemark('Good morning, I am here');
  await expect(panel.getByRole('button', { name: 'Ask Scout something' })).toBeVisible({
    timeout: 30_000,
  });

  const home = await windowFor('home');
  const card = home.getByRole('region', { name: 'Where things run' });
  const asked = brain.voice.says.length;
  await card.getByRole('button', { name: 'Ask Scout to fix it' }).click();

  await expect
    .poll(() => brain.voice.says.slice(asked).map((say) => say.text), { timeout: 15_000 })
    .toEqual(['Fix text from pictures']);
  await expect(panel.getByText('Fix text from pictures')).toBeVisible();
});

test('the row turns to Working after the brain changes it', async () => {
  const home = await windowFor('home');
  const card = home.getByRole('region', { name: 'Where things run' });
  brain.setReading(READING_ROWS({ state: 'working' }));
  await expect(card.getByText('Needs a fix')).toHaveCount(0, { timeout: 15_000 });
  await expect(card.getByText('Working')).toHaveCount(2);
  await expect(card.getByRole('button', { name: 'Ask Scout to fix it' })).toHaveCount(0);
});
