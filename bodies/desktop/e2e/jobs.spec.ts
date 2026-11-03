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
import { seedSettings } from './fixtures/seed-settings';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-jobs-')));
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

test('a job page pulls its steps by cursor', async () => {
  const home = await windowFor('home');
  const first = await home.evaluate(() => window.tagalong.jobActivity('job1', 0));
  expect(first.entries.map((e) => e.kind)).toEqual(['command', 'output', 'end']);
  expect(first.rev).toBe(3);
  expect(await home.evaluate(() => window.tagalong.runningSteps())).toEqual([]);

  brain.pushActivity('job1', { kind: 'say', text: 'All done.' });
  const next = await home.evaluate(() => window.tagalong.jobActivity('job1', 3));
  expect(next.entries.map((e) => e.text)).toEqual(['All done.']);
  expect(next.rev).toBe(4);
});

test('watching a job shows its log, follows new steps and shows exit codes', async () => {
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Jobs', exact: true }).click();
  await home.getByRole('button', { name: 'Watch Fix the build' }).click();

  // An earlier test stopped job1, so the page may open on Overview: pick Activity.
  await home.getByRole('tab', { name: 'Activity' }).click();
  const log = home.getByRole('log');
  await expect(log).toContainText('$ npm test', { timeout: 15_000 });
  await expect(log).toContainText('all green');

  brain.pushActivity('job1', {
    kind: 'command',
    text: 'git status',
    status: 'running',
    step: 's9',
  });
  await expect(log).toContainText('$ git status', { timeout: 15_000 });
  await expect(log).toContainText('running, ');

  // A finished command carries its exit code beside the glyph.
  brain.pushActivity('job1', {
    kind: 'command',
    text: 'npm run lint',
    status: 'failed',
    step: 's10',
    exit: 1,
  });
  await expect(log).toContainText('exit 1', { timeout: 15_000 });

  await home.getByRole('button', { name: 'Back to Jobs' }).click();
  await expect(home.getByRole('region', { name: 'Jobs' })).toContainText('Fix the build');
});

test('the job page shows what Scout is watching, read-only', async () => {
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Jobs', exact: true }).click();
  await home.getByRole('button', { name: 'Watch Fix the build' }).click();

  const list = home.getByRole('list', { name: 'Scout is checking' });
  await expect(list).toContainText('tests pass', { timeout: 15_000 });
  await expect(list).toContainText('README updated');
  await expect(list.getByLabel('done', { exact: true })).toHaveCount(1);
  await expect(list.getByRole('button')).toHaveCount(0);

  // Scout ticks the second item: the header follows without a reload.
  brain.setWatch('job1', [
    { text: 'tests pass', done: true },
    { text: 'README updated', done: true },
  ]);
  await expect(list.getByLabel('done', { exact: true })).toHaveCount(2, { timeout: 15_000 });

  // Scout clears the list: the header shows nothing, not an empty box.
  brain.setWatch('job1', []);
  await expect(home.getByRole('list', { name: 'Scout is checking' })).toHaveCount(0, {
    timeout: 15_000,
  });
  brain.setWatch('job1', [
    { text: 'tests pass', done: true },
    { text: 'README updated', done: false },
  ]);
  await home.getByRole('button', { name: 'Back to Jobs' }).click();
});

test('a long watch list never pushes the log or its pill off the screen', async () => {
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Jobs', exact: true }).click();
  await home.getByRole('button', { name: 'Watch Fix the build' }).click();
  await home.getByRole('tab', { name: 'Activity' }).click();
  const items = Array.from({ length: 10 }, (_, i) => ({
    text: `expectation ${i + 1}`,
    done: i < 3,
  }));
  brain.setWatch('job1', items);
  const list = home.getByRole('list', { name: 'Scout is checking' });
  await expect(list).toContainText('expectation 10', { timeout: 15_000 });

  const fit = await home.evaluate(() => {
    const log = document.querySelector('[role="log"]')?.getBoundingClientRect();
    const main = document.querySelector('.home-main');
    const list = document.querySelector('.watch-list__items');
    return {
      logBottom: log?.bottom ?? Infinity,
      viewport: window.innerHeight,
      outerScroll: main ? main.scrollHeight - main.clientHeight : Infinity,
      listScrolls: list ? list.scrollHeight > list.clientHeight : false,
    };
  });
  expect(fit.logBottom).toBeLessThanOrEqual(fit.viewport);
  expect(fit.outerScroll).toBeLessThanOrEqual(1);
  expect(fit.listScrolls).toBe(true); // capped, so ten items scroll inside their own box

  brain.setWatch('job1', [
    { text: 'tests pass', done: true },
    { text: 'README updated', done: false },
  ]);
  await home.getByRole('button', { name: 'Back to Jobs' }).click();
});

test('a changed jobs notice refreshes the list', async () => {
  // Answering the question made the brain add a second job and say only that jobs changed.
  const home = await windowFor('home');
  await expect(home.getByRole('region', { name: 'Jobs' })).toContainText('Write the docs', {
    timeout: 15_000,
  });
});

test("the bubble shows a running job's latest step", async () => {
  const panel = await windowFor('panel');
  const step = { job: 'job1', expert: 'Claude Code', text: 'npm test', at: '2026-10-27T10:00:00Z' };
  brain.setRunning([step], 'job_activity');
  const line = panel.getByTestId('job-line');
  await expect(line).toHaveText('Claude Code: npm test', { timeout: 15_000 });

  brain.setRunning([], 'jobs');
  await expect(line).toHaveCount(0, { timeout: 15_000 });
});

test('a two-expert job shows its parts in Reports and a labelled Activity', async () => {
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Jobs', exact: true }).click();
  await home.getByRole('button', { name: 'Watch Ship the release notes' }).click();

  await expect(home.getByRole('heading', { level: 1 })).toHaveText('Release notes for 1.2', {
    timeout: 15_000,
  });
  await expect(home.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(home.getByText('reviewed', { exact: true })).toBeVisible();
  await expect(home.getByRole('list').filter({ hasText: 'files (app)' })).toContainText('Gemini');

  await home.getByRole('tab', { name: 'Activity' }).click();
  const log = home.getByRole('log');
  await expect(log).toContainText('Claude Code');
  await expect(log).toContainText('files app');
  await expect(log).toContainText('Gemini');

  await home.getByRole('tab', { name: 'Reports' }).click();
  const heads = home.getByRole('button', { expanded: false });
  await expect(heads).toHaveCount(2);
  await home.getByRole('button', { name: /Claude Code/ }).click();
  await expect(home.getByRole('heading', { name: 'Drafted' })).toBeVisible();
  await expect(home.locator('.job-report__body script')).toHaveCount(0);
  await expect(home.locator('#job-report-p1')).toContainText('<script>bad()</script>');
  await home.getByRole('button', { name: /Gemini/ }).click();
  await expect(home.getByText('no changes needed')).toBeVisible();
});
