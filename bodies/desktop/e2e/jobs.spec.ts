/**
 * Claude Code jobs on the fake brain: Home's Jobs page lists a job and Stop reaches
 * `stop_job`; a hand-off opens a mode ask, a relayed permission ask and a question with no turn
 * running, each answered from its card; and a `changed: jobs` from the brain refreshes the list.
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
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-jobs-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
      TAGALONG_FAKE_PROVIDERS: '1',
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

test.describe.configure({ mode: 'serial' });

test('Home lists the job and Stop reaches the brain', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Jobs', exact: true }).click();

  const jobs = home.getByRole('region', { name: 'Jobs' });
  await expect(jobs).toContainText('Fix the build', { timeout: 30_000 });
  await expect(jobs).toContainText('Running');

  await jobs.getByRole('button', { name: 'Stop Fix the build' }).click();
  await expect.poll(() => brain.stops, { timeout: 15_000 }).toEqual(['job1']);
  await expect(jobs).toContainText('Stopped', { timeout: 15_000 });
});

test('a hand-off asks its mode, a relayed permission and a question with no turn running', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill('please hand off the build fix');
  await field.press('Enter');
  // The turn is over before any job ask opens, so the cards below stand without one.
  await expect(panel.getByText(/This is the fake brain/)).toBeVisible({ timeout: 30_000 });

  const mode = panel.getByRole('region', { name: 'Scout asks' });
  await expect(mode).toBeVisible({ timeout: 30_000 });
  await expect(mode).toContainText('C:/work/app');
  await mode.getByRole('button', { name: 'auto', exact: true }).click();

  const relayed = panel.getByRole('region', { name: 'Claude Code asks' });
  await expect(relayed).toContainText('Claude Code wants to run a command.', { timeout: 30_000 });
  await expect(relayed).toContainText('pnpm test');
  await relayed.getByRole('button', { name: 'Allow once', exact: true }).click();

  const question = panel.getByRole('region', { name: 'Claude Code asks' });
  await expect(question).toContainText('Which branch should I use?', { timeout: 30_000 });
  await question.getByLabel('Your answer').fill('main');
  await question.getByRole('button', { name: 'Send' }).click();

  await expect
    .poll(() => brain.answers, { timeout: 15_000 })
    .toEqual([
      { ask: 'j1', option: 'auto' },
      { ask: 'j2', option: 'Allow once' },
      { ask: 'j3', option: 'main', text: 'main' },
    ]);
  await expect(panel.getByRole('region', { name: 'Claude Code asks' })).toHaveCount(0);
});

test('a changed jobs notice refreshes the list', async () => {
  // Answering the question made the brain add a second job and say only that jobs changed.
  const home = await windowFor('home');
  await expect(home.getByRole('region', { name: 'Jobs' })).toContainText('Write the docs', {
    timeout: 15_000,
  });
});
