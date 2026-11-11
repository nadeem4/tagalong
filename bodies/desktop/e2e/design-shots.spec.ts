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
    // Not getByRole('alert'): other Connections cards can show one too.
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
// E1: updates on the Apps tab, on the mockup's apps (Notion, Google Calendar, GitHub, Filesystem, Linear, Obsidian).
test('E1 updates', async () => {
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
    const row = (id: string, name: string, tools: number, remote: boolean) => ({
      id,
      name,
      transport: remote ? 'http' : 'stdio',
      auth: 'none',
      enabled: true,
      status: 'connected',
      error: '',
      ...(remote ? { url: `https://${id}.example.com/mcp` } : { command: 'node', args: [] }),
      tools: Array.from({ length: tools }, (_, n) => ({
        name: `${id}__t${n}`,
        effect: 'look',
        locked: false,
      })),
    });
    const apps = [
      row('notion', 'Notion', 12, true),
      row('gcal', 'Google Calendar', 8, true),
      row('github', 'GitHub', 26, false),
      row('filesystem', 'Filesystem', 5, false),
      row('linear', 'Linear, by acme-dev', 9, false),
      row('obsidian', 'Obsidian, by vaultkit', 6, false),
    ];
    const official = new Set(['notion', 'gcal', 'github', 'filesystem']);
    brain.setSetup({
      apps: apps.map((a) => ({
        id: a.id,
        name: a.name,
        state: 'connected',
        official: official.has(a.id),
      })),
    });
    const item = (id: string, name: string, over: Record<string, unknown>) => ({
      kind: 'app',
      id,
      name,
      installed: '',
      latest: null,
      remote: false,
      official: official.has(id),
      auto: official.has(id),
      status: 'idle',
      ...over,
    });
    const notion = item('notion', 'Notion', { remote: true });
    const gcal = item('gcal', 'Google Calendar', { remote: true });
    const checkedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const states: Record<string, Record<string, unknown>[]> = {
      'header-idle': [
        notion,
        gcal,
        item('github', 'GitHub', { installed: '1.0' }),
        item('filesystem', 'Filesystem', { installed: '1.3' }),
        item('linear', 'Linear', { installed: '0.5' }),
        item('obsidian', 'Obsidian', { installed: '1.3' }),
      ],
      'updates-available': [
        notion,
        gcal,
        item('github', 'GitHub', { installed: '0.9', latest: '1.0' }),
        item('filesystem', 'Filesystem', { installed: '1.2', latest: '1.3' }),
        item('linear', 'Linear', { installed: '0.4', latest: '0.5' }),
        item('obsidian', 'Obsidian', { installed: '1.3' }),
      ],
      // The mockup's own picture: one updating, one waiting, one that waits for you, one just done.
      updating: [
        notion,
        gcal,
        item('github', 'GitHub', { installed: '0.9', latest: '1.0', status: 'updating' }),
        item('filesystem', 'Filesystem', { installed: '1.2', latest: '1.3' }),
        item('linear', 'Linear', { installed: '0.4', latest: '0.5' }),
        item('obsidian', 'Obsidian', { installed: '1.3', status: 'updated' }),
      ],
      updated: [
        notion,
        gcal,
        item('github', 'GitHub', { installed: '1.0', status: 'updated' }),
        item('filesystem', 'Filesystem', { installed: '1.3', status: 'updated' }),
        item('linear', 'Linear', { installed: '0.4', latest: '0.5' }),
        item('obsidian', 'Obsidian', { installed: '1.3', status: 'updated' }),
      ],
    };
    const put = (items: Record<string, unknown>[]) =>
      brain.setUpdates(
        {
          checkedAt,
          auto: {
            apps: { official: true, community: false },
            experts: { official: true, community: false },
          },
          items,
        },
        apps,
      );
    // The apps are read when the page opens; each state after that arrives as `changed updates`.
    put(states['header-idle'] ?? []);
    const avatar = await find('avatar');
    await avatar.evaluate(() => window.tagalongHost.openSettings());
    const home = await find('home');
    await home.getByRole('button', { name: 'Connections' }).click();
    await home.getByRole('tab', { name: 'Apps' }).click();
    for (const [state, items] of Object.entries(states)) {
      put(items);
      await home.waitForTimeout(800);
      await expect(home.getByRole('region', { name: 'Your apps' })).toContainText('Checked', {
        timeout: 15_000,
      });
      await expect(home.getByRole('region', { name: 'GitHub' })).toBeVisible();
      await home.getByRole('region', { name: 'Your apps' }).scrollIntoViewIfNeeded();
      await shot(home, 'E1', state);
    }
    // The remote row on its own: "Always up to date", no Update button, no version.
    const notionRow = home.getByRole('region', { name: 'Notion' });
    await notionRow.scrollIntoViewIfNeeded();
    const dir = resolve(shotsRoot, 'E1');
    await notionRow.screenshot({ path: join(dir, 'remote-row.png') });
  } finally {
    await closeApp(app);
    await brain.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

// E1: updates on the Experts tab, on the mockup's experts (Claude Code, Gemini CLI, Foo).
test('E1 experts updates', async () => {
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
    const installed = (
      id: string,
      name: string,
      version: string,
      official: boolean,
      state = 'ready',
    ) => ({
      id,
      name,
      version,
      state,
      tested: true,
      official,
    });
    brain.setSetup({
      experts: [
        installed('claude-acp', 'Claude Code', '1.2.0', true),
        installed('gemini', 'Gemini CLI', '0.10.0', true, 'needs_login'),
        installed('foo', 'Foo', '0.3.0', false),
      ],
    });
    const item = (id: string, name: string, official: boolean, over: Record<string, unknown>) => ({
      kind: 'expert',
      id,
      name,
      installed: '',
      latest: null,
      remote: false,
      official,
      auto: official,
      status: 'idle',
      ...over,
    });
    const states: Record<string, Record<string, unknown>[]> = {
      'experts-updates-available': [
        item('claude-acp', 'Claude Code', true, { installed: '1.2', latest: '1.3' }),
        item('gemini', 'Gemini CLI', true, { installed: '0.10' }),
        item('foo', 'Foo', false, { installed: '0.3', latest: '0.4' }),
      ],
      // The mockup's own picture: one waiting, one just updated that now needs sign-in.
      'experts-updated-needs-sign-in': [
        item('claude-acp', 'Claude Code', true, { installed: '1.2', latest: '1.3' }),
        item('gemini', 'Gemini CLI', true, { installed: '0.10', status: 'updated' }),
        item('foo', 'Foo', false, { installed: '0.3', latest: '0.4' }),
      ],
      'experts-updating': [
        item('claude-acp', 'Claude Code', true, {
          installed: '1.2',
          latest: '1.3',
          status: 'updating',
        }),
        item('gemini', 'Gemini CLI', true, { installed: '0.10' }),
        item('foo', 'Foo', false, { installed: '0.3', latest: '0.4' }),
      ],
    };
    const put = (items: Record<string, unknown>[]) =>
      brain.setUpdates({
        checkedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        auto: {
          apps: { official: true, community: false },
          experts: { official: true, community: false },
        },
        items,
      });
    put(states['experts-updates-available'] ?? []);
    const avatar = await find('avatar');
    await avatar.evaluate(() => window.tagalongHost.openSettings());
    const home = await find('home');
    await home.getByRole('button', { name: 'Connections' }).click();
    await home.getByRole('tab', { name: 'Experts' }).click();
    for (const [state, items] of Object.entries(states)) {
      put(items);
      await home.waitForTimeout(800);
      const yours = home.getByRole('region', { name: 'Your experts' });
      await expect(yours).toContainText('Checked', { timeout: 15_000 });
      await expect(home.getByRole('region', { name: 'Claude Code' })).toBeVisible();
      await yours.scrollIntoViewIfNeeded();
      await shot(home, 'E1', state);
    }
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

// E2: Home > Places in three states, tour step 10 before and after adding one, and the finish card.
async function launchShot(options: Parameters<typeof startFakeBrain>[0], settings = true) {
  const brain = await startFakeBrain(options);
  const dataDir = mkdtempSync(join(tmpdir(), 'tagalong-shot-'));
  if (settings) seedSettings(dataDir);
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr, TAGALONG_START_BRAIN: '0' },
  });
  const find = async (name: string): Promise<Page> => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const page = app.windows().find((p) => p.url().includes(`${name}.html`));
      if (page !== undefined) return page;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error(`no ${name} window appeared`);
  };
  const done = async (): Promise<void> => {
    await closeApp(app);
    await brain.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  };
  return { find, done };
}

async function placesPage(
  options: Parameters<typeof startFakeBrain>[0],
  take: (home: Page) => Promise<void>,
): Promise<void> {
  const { find, done } = await launchShot(options);
  try {
    await (await find('avatar')).evaluate(() => window.tagalongHost.openSettings());
    const home = await find('home');
    await home
      .getByRole('navigation')
      .getByRole('button', { name: /^Places/ })
      .click();
    await expect(home.getByRole('heading', { level: 1, name: 'Places' })).toBeVisible();
    await take(home);
  } finally {
    await done();
  }
}

const ALL_FIVE = [
  'access_token',
  'app_secret',
  'verify_token',
  'phone_number_id',
  'allowed_number',
];

test('E2 places states', async () => {
  const dir = resolve(shotsRoot, 'E2');
  mkdirSync(dir, { recursive: true });
  await placesPage(
    {
      hasKey: true,
      bodies: { connected: ['desktop'], whatsappSet: ALL_FIVE, whatsappState: 'off' },
    },
    async (home) => {
      await expect(home.getByText('Not set up').first()).toBeVisible({ timeout: 30_000 });
      await home.screenshot({ path: join(dir, 'places.png') });
    },
  );
  await placesPage(
    { hasKey: true, bodies: { connected: ['desktop'], whatsappSet: ALL_FIVE.slice(0, 3) } },
    async (home) => {
      await home
        .getByRole('button', { name: /^Set up/ })
        .last()
        .click();
      await expect(home.getByRole('button', { name: 'Save' })).toBeVisible();
      await home.screenshot({ path: join(dir, 'whatsapp-setup.png') });
    },
  );
  await placesPage(
    {
      hasKey: true,
      bodies: {
        connected: ['desktop', 'browser', 'whatsapp'],
        whatsappSet: ALL_FIVE,
        whatsappState: 'running',
      },
    },
    async (home) => {
      await expect(home.getByText('Connected').first()).toBeVisible({ timeout: 30_000 });
      await home.screenshot({ path: join(dir, 'all-connected.png') });
    },
  );
});

test('E2 tour step ten and finish card', async () => {
  const dir = resolve(shotsRoot, 'E2');
  mkdirSync(dir, { recursive: true });
  const { find, done } = await launchShot({ hasKey: true, expertInstallingPercent: 40 }, false);
  try {
    const tour = await find('walkthrough');
    for (let at = 1; at < 10; at += 1) {
      await tour.getByRole('button', { name: /^(Get started|Next)$/ }).click();
    }
    await expect(tour.getByRole('heading', { name: 'Connect your tools' })).toBeVisible();
    await expect(tour.getByRole('button', { name: 'Add Gmail' })).toBeVisible({ timeout: 15_000 });
    await tour.waitForTimeout(800); // let the page fade-in finish
    await tour.screenshot({ path: join(dir, 'tour-step-10-before.png') });
    await tour.getByRole('button', { name: 'Add Gmail' }).click();
    await expect(tour.getByText('Connected')).toBeVisible({ timeout: 15_000 });
    await tour.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(tour.getByText('Installing…')).toBeVisible({ timeout: 15_000 });
    await tour.waitForTimeout(800);
    await tour.screenshot({ path: join(dir, 'tour-step-10-after.png') });
    await tour.getByRole('button', { name: 'Finish' }).click();
    await expect(tour.getByRole('heading', { name: 'Scout is on your screen' })).toBeVisible();
    await expect(tour.getByText('Ready to use')).toBeVisible();
    await tour.waitForTimeout(800); // let the card's fade-in finish
    await tour.screenshot({ path: join(dir, 'finish-card.png') });
  } finally {
    await done();
  }
});
