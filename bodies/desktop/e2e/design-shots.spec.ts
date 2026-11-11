/**
 * Design-refresh screenshots of Home's "Scout's brain" card, one per state, for review against
 * the mockups. Skipped unless TAGALONG_SHOTS=1; they are not part of CI. Files land in
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
    await expect(page.getByTestId('code-bar')).toBeVisible({ timeout: 30_000 });
    await shot(page, 'E3', 'full-chat');

    // An app that fails first, then one that works: ask, signing in, done.
    await ask('install notion');
    const failing = page.getByRole('group', { name: 'Set up Notion' });
    await expect(failing).toBeVisible({ timeout: 30_000 });
    await failing.getByRole('button', { name: 'Allow' }).click();
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
  });
});
