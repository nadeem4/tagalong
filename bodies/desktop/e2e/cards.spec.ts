/**
 * The three cards Scout shows before anything happens: the hand-off card, the connector
 * confirm card and the routine card. Each needs the fake pet to reach for a different tool
 * (TAGALONG_FAKE_TOOL is read once, at launch), so each block starts its own app on its own
 * fresh profile, which also gives it its own single-instance lock.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` it carries, which types `window.tagalong` and
// `window.tagalongHost` inside the page evaluates below.
import type {} from '../src/shared/ipc';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

test.describe.configure({ mode: 'serial' });

async function launch(
  tool: string,
  input: unknown,
): Promise<{ app: ElectronApplication; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'tagalong-cards-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_FAKE_PROVIDERS: '1',
      TAGALONG_FAKE_TTS: '1',
      TAGALONG_SKIP_WELCOME: '1',
      TAGALONG_FAKE_TOOL: tool,
      TAGALONG_FAKE_TOOL_INPUT: JSON.stringify(input),
    },
  });
  return { app, dataDir };
}

async function windowFor(app: ElectronApplication, name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of app.windows()) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

/** Opens Scout's bubble and asks; the fake pet calls its scripted tool first. */
async function ask(app: ElectronApplication, text: string): Promise<Page> {
  const avatar = await windowFor(app, 'avatar');
  await avatar.evaluate(async () => {
    await window.tagalongHost.hidePanel();
    await window.tagalongHost.togglePanel();
  });
  const panel = await windowFor(app, 'panel');
  const field = panel.getByLabel(/^(Ask|Message) Scout/);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill(text);
  await field.press('Enter');
  return panel;
}

/** Home's Activity page, from the engine's own record. */
async function activity(app: ElectronApplication): Promise<Page> {
  const avatar = await windowFor(app, 'avatar');
  await avatar.evaluate(() => window.tagalongHost.openHome());
  const home = await windowFor(app, 'home');
  const nav = home.getByRole('navigation', { name: 'Tagalong' });
  await nav.getByRole('button', { name: 'Activity' }).click({ timeout: 15_000 });
  return home;
}

test.describe('the hand-off card', () => {
  let app: ElectronApplication;
  let dataDir: string;
  const project = mkdtempSync(join(tmpdir(), 'tagalong-project-'));

  test.beforeAll(async () => {
    ({ app, dataDir } = await launch('hand_to_expert', {
      ask: 'Fix the failing login test',
      expert_id: 'claude-code',
    }));
    // The expert Welcome would add. Fake mode answers it with a scripted connector: no
    // claude process starts.
    const avatar = await windowFor(app, 'avatar');
    await avatar.evaluate(() =>
      window.tagalong.saveExpert!({
        id: 'claude-code',
        name: 'Claude Code',
        goodAt: 'Code',
        enabled: true,
        instructions: '',
        connection: {
          type: 'claude-code',
          canEdit: false,
          canSearchWeb: false,
          plugins: [],
          mcpTools: [],
          workspace: 'project' as const,
        },
      }),
    );
    // The folder picker is a native dialog Playwright cannot click; it answers with a
    // temporary project instead.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, project);
  });

  test.afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  test('shows the brief, Send starts the hand-off, and Activity shows it', async () => {
    const panel = await ask(app, 'can you fix the login test?');
    const card = panel.getByRole('region', { name: 'Hand to Claude Code' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Fix the failing login test');
    await expect(card).toContainText('Reads only');

    // Nothing has run yet: the card is only a proposal.
    const before = await panel.evaluate(() => window.tagalong.listActivity!({}));
    expect(before.entries.some((entry) => entry.kind === 'expert')).toBe(false);

    // Settle the project on the temporary folder, whatever the runner has lying around.
    if (!(await card.getByRole('button', { name: 'Browse…' }).isVisible())) {
      await card.getByRole('button', { name: 'Change project' }).click();
    }
    await card.getByRole('button', { name: 'Browse…' }).click();
    await expect(card).toContainText(basename(project));
    await card.getByRole('button', { name: 'Send' }).click();

    await expect(panel.getByRole('region', { name: 'Claude Code finished' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(panel.getByText(/Claude Code \(fake\) read the brief/)).toBeVisible();

    const home = await activity(app);
    await expect(
      home
        .getByRole('list', { name: 'Activity' })
        .getByRole('button', { name: /Scout handed off to Claude Code/ }),
    ).toBeVisible({ timeout: 30_000 });
    await home.close();
  });
});

test.describe('the connector confirm card', () => {
  let app: ElectronApplication;
  let dataDir: string;
  const notes = join(mkdtempSync(join(tmpdir(), 'tagalong-notes-')), 'notes.txt');
  const server = join(appDir, 'e2e', 'fixtures', 'notes-mcp.mjs');

  const written = (): string => {
    try {
      return readFileSync(notes, 'utf8');
    } catch {
      return '';
    }
  };

  test.beforeAll(async () => {
    ({ app, dataDir } = await launch('notes__add_note', { text: 'Buy milk' }));
    // A local app over MCP: a tiny stdio server in e2e/fixtures with one write tool.
    const avatar = await windowFor(app, 'avatar');
    await avatar.evaluate(
      (params) =>
        window.tagalong.addConnection!({
          id: 'notes',
          name: 'Notes',
          auth: 'none',
          transport: { type: 'stdio', command: params.node, args: [params.server, params.notes] },
        }),
      { node: process.execPath, server, notes },
    );
    await expect
      .poll(
        () =>
          avatar.evaluate(async () => {
            const { connections } = await window.tagalong.listConnections!();
            return connections.find((c) => c.id === 'notes')?.status;
          }),
        { timeout: 30_000 },
      )
      .toBe('connected');
  });

  test.afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(dirname(notes), { recursive: true, force: true });
  });

  test('Allow once runs the change', async () => {
    const panel = await ask(app, 'note that I need milk');
    const card = panel.getByRole('region', { name: 'Change something in Notes?' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Buy milk');
    // Asking is not doing: the app has not been touched while the card waits.
    expect(written()).toBe('');

    await card.getByRole('button', { name: 'Allow once' }).click();
    await expect.poll(written, { timeout: 30_000 }).toBe('Buy milk\n');

    const home = await activity(app);
    await expect(
      home
        .getByRole('list', { name: 'Activity' })
        .getByRole('button', { name: /Scout changed Notes/ }),
    ).toBeVisible({ timeout: 30_000 });
    await home.close();
  });

  test('Cancel does not run it', async () => {
    const panel = await ask(app, 'note that I need milk again');
    const card = panel.getByRole('region', { name: 'Change something in Notes?' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveCount(0);

    const home = await activity(app);
    await expect(
      home
        .getByRole('list', { name: 'Activity' })
        .getByRole('button', { name: /Scout did not change Notes/ }),
    ).toBeVisible({ timeout: 30_000 });
    await home.close();
    // Still the one note from Allow once: the cancelled change never reached the app.
    expect(written()).toBe('Buy milk\n');
  });

  test('Allow once in Home’s Waiting on you runs it, and the bubble’s card goes', async () => {
    const panel = await ask(app, 'note that I need milk once more');
    const card = panel.getByRole('region', { name: 'Change something in Notes?' });
    await expect(card).toBeVisible({ timeout: 30_000 });

    const avatar = await windowFor(app, 'avatar');
    await avatar.evaluate(() => window.tagalongHost.openHome());
    const home = await windowFor(app, 'home');
    const nav = home.getByRole('navigation', { name: 'Tagalong' });
    await nav.getByRole('button', { name: 'Waiting on you (1)' }).click({ timeout: 15_000 });
    const waiting = home.getByRole('region', { name: 'Waiting' });
    await expect(waiting).toContainText('Change in Notes · add_note · Changes something');
    await waiting.getByRole('button', { name: 'Allow once' }).click();

    await expect(card).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(written, { timeout: 30_000 }).toBe('Buy milk\nBuy milk\n');
    await expect(home.getByRole('region', { name: 'Answered' })).toContainText('Approved by you');
    await home.close();
  });
});

test.describe('the routine card', () => {
  let app: ElectronApplication;
  let dataDir: string;

  test.beforeAll(async () => {
    ({ app, dataDir } = await launch('create_routine', {
      name: 'Morning papers',
      when: { type: 'weekdays', time: '08:00' },
      what: 'Find new papers on AI agents.',
    }));
  });

  test.afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const routines = (page: Page) =>
    page.evaluate(async () => (await window.tagalong.listRoutines!()).map((r) => r.name));

  test('nothing is saved without Save', async () => {
    const panel = await ask(app, 'every weekday at 8, find me new papers on AI agents');
    const card = panel.getByRole('region', { name: 'Set up Morning papers?' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Weekdays at 08:00');
    expect(await routines(panel)).toEqual([]);

    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveCount(0);
    expect(await routines(panel)).toEqual([]);
  });

  test('Save creates the routine in Home → Routines', async () => {
    const panel = await ask(app, 'every weekday at 8, find me new papers on AI agents');
    const card = panel.getByRole('region', { name: 'Set up Morning papers?' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Save' }).click();
    const saved = panel.getByRole('region', { name: 'Morning papers is saved' });
    await expect(saved).toContainText('Saved. Run it now to test?');
    await saved.getByRole('button', { name: 'Not now' }).click();
    expect(await routines(panel)).toEqual(['Morning papers']);

    const avatar = await windowFor(app, 'avatar');
    await avatar.evaluate(() => window.tagalongHost.openHome());
    const home = await windowFor(app, 'home');
    await home
      .getByRole('navigation', { name: 'Tagalong' })
      .getByRole('button', { name: 'Routines' })
      .click({ timeout: 15_000 });
    await expect(home.getByRole('list', { name: 'Routines' })).toContainText('Morning papers', {
      timeout: 15_000,
    });
    await home.close();
  });
});
