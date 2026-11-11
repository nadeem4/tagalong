/**
 * Design-refresh screenshots of Home's "Scout's brain" card (D1), the Connections page (D5) and Scout's model (E5),
 * one per state, for review against the mockups. Skipped unless TAGALONG_SHOTS=1; they are not part of CI. Files land in
 * docs/superpowers/specs/design-refresh/shots/<slice>/ (TAGALONG_SHOTS_DIR overrides the root).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { sourceHash } from '../src/main/brain/build-id';
import { closeApp } from './fixtures/close-app';
import { freePort } from './fixtures/free-port';
import { seedSettings } from './fixtures/seed-settings';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// A worktree sits three levels under the main checkout, so name the shots folder explicitly.
const shotsRoot =
  process.env.TAGALONG_SHOTS_DIR ??
  'C:/projects/ai_pet/docs/superpowers/specs/design-refresh/shots';

test.skip(process.env.TAGALONG_SHOTS !== '1', 'set TAGALONG_SHOTS=1 to take design shots');

async function shot(page: Page, slice: string, state: string): Promise<void> {
  const dir = resolve(shotsRoot, slice);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${state}.png`) });
}

const version = (
  JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { version: string }
).version;
const OURS = { version, build: sourceHash(resolve(appDir, '../../brain/src/brain')) };
const OLD = { version: '0.0.1', build: 'old' };

function status(startedBy: string, workRunning: boolean): Record<string, unknown> {
  return {
    ...OURS,
    pid: 18420,
    started_at: new Date(Date.now() - 134 * 60_000).toISOString(),
    started_by: startedBy,
    addr: '127.0.0.1:47321',
    data_dir: 'C:\\Users\\you\\.tagalong',
    log_path: 'C:\\Users\\you\\.tagalong\\brain.log',
    places: [
      { id: 'desktop', kind: 'desktop', name: 'Desktop' },
      { id: 'browser', kind: 'browser', name: 'Browser' },
    ],
    work_running: workRunning,
  };
}

interface Scene {
  state: string;
  hello: { version: string; build: string };
  brain: Record<string, unknown>;
  offline?: boolean;
}

const SCENES: Scene[] = [
  { state: 'normal', hello: OURS, brain: status('desktop', false) },
  // A job is running, so the desktop asks instead of restarting quietly.
  { state: 'update-ready', hello: OLD, brain: { ...status('desktop', true), ...OLD } },
  // Drawn as a current brain you started: Running, no warning block, no restart.
  { state: 'started-by-you', hello: OURS, brain: status('person', false) },
  { state: 'offline', hello: OURS, brain: status('desktop', false), offline: true },
];

for (const scene of SCENES) {
  test(`D1 ${scene.state}`, async () => {
    let brain: FakeBrain | undefined;
    let app: ElectronApplication | undefined;
    const dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-shot-')));
    try {
      let addr: string;
      if (scene.offline === true) {
        addr = `127.0.0.1:${await freePort()}`;
      } else {
        brain = await startFakeBrain({ hello: scene.hello, brainStatus: scene.brain });
        addr = brain.addr;
      }
      app = await electron.launch({
        args: ['.', `--user-data-dir=${dataDir}`],
        cwd: appDir,
        env: {
          ...process.env,
          TAGALONG_BRAIN_ADDR: addr,
          ...(scene.offline === true ? { TAGALONG_START_BRAIN: '0' } : {}),
        },
      });
      let avatar: Page | undefined;
      for (let attempt = 0; attempt < 60 && avatar === undefined; attempt += 1) {
        avatar = app.windows().find((page) => page.url().includes('avatar.html'));
        if (avatar === undefined) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
      if (avatar === undefined) throw new Error('no avatar window appeared');
      await avatar.evaluate(() => window.tagalongHost.openSettings());
      let home: Page | undefined;
      for (let attempt = 0; attempt < 60 && home === undefined; attempt += 1) {
        home = app.windows().find((page) => page.url().includes('home.html'));
        if (home === undefined) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
      if (home === undefined) throw new Error('no home window appeared');
      await home.getByRole('button', { name: 'Overview', exact: true }).click();
      const card = home.getByRole('region', { name: "Scout's brain" });
      await expect(card).toBeVisible({ timeout: 30_000 });
      // Let the facts arrive: the offline card says so itself, the others show the Process ID.
      await expect(card).toContainText(scene.offline === true ? "Can't reach" : 'Process ID', {
        timeout: 30_000,
      });
      await card.scrollIntoViewIfNeeded();
      await shot(home, 'D1', scene.state);
    } finally {
      if (app !== undefined) await closeApp(app);
      if (brain !== undefined) await brain.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  });
}

// E3: the chat window and the install card. One app serves every scene, in order.
test.describe('E3 chat', () => {
  test.describe.configure({ mode: 'serial' });
  let brain: FakeBrain;
  let app: ElectronApplication;
  let dataDir: string;

  test.beforeAll(async () => {
    brain = await startFakeBrain();
    dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-shot-e3-')));
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

  async function panel(): Promise<Page> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = app.windows().find((page) => page.url().includes('panel.html'));
      if (found !== undefined) return found;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error('no panel window appeared');
  }

  const notion = (status: string, toolCount = 0) => ({
    id: 'notion',
    name: 'Notion',
    transport: 'http',
    auth: 'oauth',
    enabled: true,
    status,
    error: status === 'error' ? 'Sign-in was cancelled' : '',
    command: '',
    args: [],
    tools: Array.from({ length: toolCount }, (_, i) => ({
      name: `notion__tool_${i + 1}`,
      effect: 'look',
      locked: false,
    })),
  });
  const claude = (state: string) => ({
    id: 'claude-acp',
    name: 'Claude Code',
    version: '2.0.0',
    state,
    tested: true,
  });

  test('E3 states: quick bubble, header, full chat, every install card state', async () => {
    const page = await panel();
    await page.getByLabel(/^Ask /).waitFor({ state: 'visible', timeout: 30_000 });
    await shot(page, 'E3', 'quick-bubble');
    // The quick bubble with an answer, then with a job running under it.
    const quick = page.getByLabel(/^Ask /);
    await quick.fill('hello there');
    await quick.press('Enter');
    await expect(page.getByText('This is the fake brain.').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, 'E3', 'quick-bubble-answer');
    brain.setRunning(
      [{ job: 'j1', expert: 'Claude Code', text: 'npm init -y', at: new Date().toISOString() }],
      'job_activity',
    );
    await expect(page.getByTestId('job-line')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'E3', 'quick-bubble-job');
    brain.setRunning([], 'jobs');
    await page.getByRole('button', { name: 'Open full chat' }).click();
    await page.getByRole('log').waitFor({ state: 'visible' });
    await shot(page, 'E3', 'header-at-rest');

    // Listening off, with its tooltip.
    const always = page.getByRole('button', { name: 'Always listening' });
    if ((await always.getAttribute('aria-pressed')) === 'true') await always.click();
    await always.hover();
    await shot(page, 'E3', 'listening-off-tooltip');
    await page.mouse.move(200, 300);

    const ask = async (text: string): Promise<void> => {
      const field = page.getByLabel(/^(Message|Reply to) Scout/);
      await field.fill(text);
      await field.press('Enter');
    };

    // The full chat: your message, Scout's gist with Show more, a code block.
    await ask('explain the failing test');
    const more = page.getByRole('button', { name: /Show more/ });
    await expect(more).toBeVisible({ timeout: 30_000 });
    await shot(page, 'E3', 'full-chat');
    await more.click();
    await expect(page.getByTestId('code-bar')).toBeVisible();
    await shot(page, 'E3', 'full-chat-expanded');

    // An app that fails first, then one that works: ask, signing in, done.
    await ask('install notion');
    const failing = page.getByRole('group', { name: 'Set up Notion' });
    await expect(failing).toBeVisible({ timeout: 30_000 });
    await failing.getByRole('button', { name: 'Allow' }).click();
    // It gets as far as Signing in, then fails: the card stops at step 3.
    brain.setScene({ apps: [notion('needs-sign-in')] });
    await expect(failing).toContainText('browser', { timeout: 15_000 });
    brain.setScene({ apps: [notion('error')] });
    await expect(failing.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'E3', 'install-failed');
    await failing.getByRole('button', { name: 'Not now' }).click();
    await expect(failing).toHaveCount(0);

    brain.setScene({ apps: [] });
    await ask('install notion');
    const card = page.getByRole('group', { name: 'Set up Notion' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await shot(page, 'E3', 'install-allow');
    await card.getByRole('button', { name: 'Allow' }).click();
    await expect(card.getByRole('list', { name: 'Steps' })).toBeVisible({ timeout: 15_000 });
    brain.setScene({ apps: [notion('needs-sign-in')] });
    await expect(card).toContainText('browser', { timeout: 15_000 });
    await shot(page, 'E3', 'install-working');
    brain.setScene({ apps: [notion('connected', 12)] });
    await expect(card).toContainText('Notion is ready.', { timeout: 15_000 });
    await shot(page, 'E3', 'install-done');

    // A community app: the check comes first.
    await ask('install obsidian');
    const community = page.getByRole('group', { name: 'Set up Obsidian' });
    await expect(community).toBeVisible({ timeout: 30_000 });
    await shot(page, 'E3', 'install-community-check');
    await community.getByRole('button', { name: 'Not now' }).click();

    // An expert: downloading, sign in, ready.
    await ask('install claude');
    const expert = page.getByRole('group', { name: /Set up Claude/ });
    await expect(expert).toBeVisible({ timeout: 30_000 });
    await expert.getByRole('button', { name: 'Allow' }).click();
    brain.setScene({
      setup: { progress: { expert: 'claude-acp', stage: 'downloading', percent: 40 } },
    });
    await expect(expert).toContainText('40%', { timeout: 15_000 });
    await shot(page, 'E3', 'expert-downloading');
    brain.setScene({ setup: { progress: null, experts: [claude('needs_login')] } });
    await expect(expert.getByRole('button', { name: /log in|sign in/i })).toBeVisible({
      timeout: 15_000,
    });
    await shot(page, 'E3', 'expert-signin');
    brain.setScene({ setup: { progress: null, experts: [claude('ready')] } });
    await expect(expert).toContainText('is ready', { timeout: 15_000 });
    await shot(page, 'E3', 'expert-ready');

    // The header with both toggles off, then both on.
    const seeing = page.getByRole('button', { name: 'Seeing your screen' });
    if ((await seeing.getAttribute('aria-pressed')) === 'true') await seeing.click();
    await expect(seeing).toHaveAttribute('aria-pressed', 'false');
    await shot(page, 'E3', 'header-both-off');
    await seeing.click();
    await always.click();
    await expect(always).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'E3', 'header-both-on');
    await page.mouse.move(200, 300);

    // The cards: a choice (an offer), an ask with its facts, a running job, an error, a long
    // message in the composer and the mic tooltip.
    await ask('offer');
    await expect(page.getByText('Approve it from now on?')).toBeVisible({ timeout: 30_000 });
    await shot(page, 'E3', 'card-choice');
    await page.getByRole('button', { name: 'Keep asking' }).click();
    await ask('permission');
    await expect(page.getByRole('button', { name: 'Allow', exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await shot(page, 'E3', 'card-ask');
    await page.getByRole('button', { name: 'Allow', exact: true }).first().click();
    brain.setRunning(
      [{ job: 'j1', expert: 'Claude Code', text: 'npm init -y', at: new Date().toISOString() }],
      'job_activity',
    );
    await expect(page.getByTestId('job-line')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'E3', 'card-job');
    brain.setRunning([], 'jobs');
    await expect(page.getByTestId('job-line')).toHaveCount(0, { timeout: 15_000 });
    await ask('break it');
    await expect(page.getByRole('alert').filter({ hasText: 'Try again' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('alert').filter({ hasText: 'Try again' }).scrollIntoViewIfNeeded();
    await shot(page, 'E3', 'card-error');
    await page.getByLabel(/^(Message|Reply to) Scout/).fill('first line\nsecond line\nthird line');
    await page.getByRole('button', { name: /^Talk to / }).hover();
    await shot(page, 'E3', 'composer-multiline-mic-tip');
    await page.getByLabel(/^(Message|Reply to) Scout/).fill('');
    await page.mouse.move(200, 300);

    // Scout thinking: a turn that stays open. Last, because it never ends.
    await ask('think slowly');
    await expect(page.getByText(/is thinking/)).toBeVisible({ timeout: 30_000 });
    await page.getByText(/is thinking/).scrollIntoViewIfNeeded();
    await shot(page, 'E3', 'thinking');
  });
});

// D5: Home's Connections page, one shot per state, on one app and one fake brain.
test('D5 connections', async () => {
  const brain = await startFakeBrain();
  const dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-shot-')));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr },
  });
  try {
    const find = async (name: string): Promise<Page> => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const page = app.windows().find((p) => p.url().includes(`${name}.html`));
        if (page !== undefined) return page;
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
      throw new Error(`no ${name} window appeared`);
    };
    const avatar = await find('avatar');
    await avatar.evaluate(() => window.tagalongHost.openSettings());
    const home = await find('home');
    await home.getByRole('button', { name: 'Connections' }).click();
    const search = home.getByRole('searchbox', { name: 'Search apps' });
    await expect(home.getByRole('button', { name: 'Add Notion', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await shot(home, 'D5', 'apps-default');

    brain.setSetup({}, 'hang');
    await search.fill('notion');
    await expect(home.getByText('Searching…')).toBeVisible();
    await shot(home, 'D5', 'apps-searching');

    brain.setSetup({}, false);
    await search.fill('');
    await search.fill('notion');
    const results = home.getByRole('list', { name: 'Results' });
    await expect(results.getByText('Official', { exact: true })).toBeVisible({ timeout: 15_000 });
    await shot(home, 'D5', 'apps-results');

    await results.getByRole('button', { name: '2 more from other makers' }).click();
    await shot(home, 'D5', 'apps-other-makers');
    await results.getByRole('button', { name: 'Add Notion, by Ada' }).click();
    await shot(home, 'D5', 'apps-check-card');
    const check = home.getByRole('group', { name: 'Check first' });
    await check.getByRole('button', { name: 'Back' }).click();

    await search.fill('zzzz');
    await expect(home.getByText('No apps match', { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await shot(home, 'D5', 'apps-empty');

    brain.setSetup({}, true);
    await search.fill('notion');
    // Not getByRole('alert'): the Bodies card has one too.
    await expect(home.getByText("Scout couldn't load the app list")).toBeVisible({
      timeout: 15_000,
    });
    await shot(home, 'D5', 'apps-error');
    brain.setSetup({}, false);
    await search.fill('');

    // A curated row for something already installed says "Added"; Linear is added from its row.
    const curated = (id: string, name: string, added: boolean) => ({
      id,
      name,
      version: '1',
      description: `${name} for Scout`,
      official: true,
      added,
      publisher: name,
      runs: 'hosted',
      host: `mcp.${name.toLowerCase()}.com`,
      sign_in: 'browser',
      licence: 'Proprietary',
      repo: '',
    });
    brain.setSetup({
      popular: [
        curated('com.notion/mcp', 'Notion', true),
        curated('app.linear/mcp', 'Linear', false),
      ],
    });
    await expect(home.getByText('Added', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await shot(home, 'D5', 'apps-added-curated');
    await home.getByRole('button', { name: 'Add Linear', exact: true }).click();
    await expect(home.getByText('Linear added.')).toBeVisible({ timeout: 15_000 });
    await shot(home, 'D5', 'apps-added-outcome');
    brain.setSetup({});

    await home
      .getByRole('button', { name: /Add it yourself/ })
      .first()
      .click();
    await shot(home, 'D5', 'apps-add-yourself');

    await home.getByRole('tab', { name: 'Experts' }).click();
    const add = home.getByRole('region', { name: 'Add an expert' });
    await expect(add.getByRole('button', { name: 'Add Claude Code' })).toBeVisible();
    await shot(home, 'D5', 'experts-default');
    await add.getByRole('button', { name: 'Show more' }).click();
    await add.getByRole('button', { name: 'Add Goose' }).click();
    const expertCheck = add.getByRole('group', { name: 'Check first' });
    await expertCheck.scrollIntoViewIfNeeded();
    await expect(expertCheck.getByText('See its code')).toBeVisible();
    await shot(home, 'D5', 'experts-check-card');
    await expertCheck.getByRole('button', { name: 'Back' }).click();

    brain.setSetup({
      browse_experts: [
        {
          id: 'claude-acp',
          name: 'Claude Code',
          version: '1',
          description: 'Claude Code works on long jobs',
          official: true,
          recommended: true,
          tested: true,
          added: true,
          account: true,
          licence: 'MIT',
          repo: 'https://example.test/claude-acp',
        },
      ],
      show_more_from: 1,
    });
    await expect(add.getByText('Added', { exact: true })).toBeVisible({ timeout: 15_000 });
    await shot(home, 'D5', 'experts-added');
    brain.setSetup({});

    brain.setSetup({ progress: { expert: 'codex-acp', stage: 'node', percent: 40 } });
    await expect(home.getByText('Installing…').first()).toBeVisible({ timeout: 15_000 });
    await shot(home, 'D5', 'experts-installing');
    brain.setSetup({ failed: { expert: 'goose', error: 'download failed' } });
    await expect(home.getByText(/didn.t finish/).first()).toBeVisible({ timeout: 15_000 });
    await shot(home, 'D5', 'experts-setup-failed');
  } finally {
    await closeApp(app);
    await brain.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
// E5: Settings > Scout's model in its four mocked states. The listbox hangs below the card, so
// the open shot scrolls the card to the top and clips a taller area.
test('E5 model states', async () => {
  const dir = resolve(shotsRoot, 'E5');
  mkdirSync(dir, { recursive: true });
  const brain = await startFakeBrain({ hasKey: true });
  const dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-shot-')));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr },
  });
  try {
    const find = async (name: string): Promise<Page> => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const page = app.windows().find((p) => p.url().includes(`${name}.html`));
        if (page !== undefined) return page;
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
      throw new Error(`no ${name} window appeared`);
    };
    await (await find('avatar')).evaluate(() => window.tagalongHost.openSettings());
    const home = await find('home');
    const model = home.getByRole('combobox', { name: 'Model' });
    await expect(model).toContainText('Claude Opus 5.5', { timeout: 30_000 });
    const card = home.locator('section', { has: model });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: join(dir, 'closed.png') });
    await model.focus();
    await card.screenshot({ path: join(dir, 'focused.png') });
    await model.press('Enter');
    await expect(home.getByRole('listbox')).toBeVisible();
    await model.press('ArrowDown');
    await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const box = (await card.boundingBox())!;
    await home.screenshot({
      path: join(dir, 'open.png'),
      clip: { x: box.x, y: box.y, width: box.width, height: box.height + 200 },
    });
    await home.getByRole('option', { name: /Claude Sonnet 5\.5/ }).click();
    await expect(home.getByText('Saved.', { exact: true })).toBeVisible();
    // The mockup's Saved state has no focus ring, so let go of the field first.
    await model.blur();
    await card.screenshot({ path: join(dir, 'saved.png') });
  } finally {
    await closeApp(app);
    await brain.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
