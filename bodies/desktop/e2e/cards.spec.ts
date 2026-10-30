/**
 * The card Scout shows before it changes something in a connected app. It needs the fake pet to
 * reach for a scripted tool (TAGALONG_FAKE_TOOL is read once, at launch), so the block starts
 * its own app on its own fresh profile, which also gives it its own single-instance lock.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

test.describe('the connector confirm card', () => {
  test.skip(true, 'returns with row 9: the connector confirm card');
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
          name: 'Notes',
          auth: 'none',
          transport: 'stdio',
          command: params.node,
          args: [params.server, params.notes],
        }),
      { node: process.execPath, server, notes },
    );
    await expect
      .poll(
        () =>
          avatar.evaluate(async () => {
            const { apps } = await window.tagalong.listConnections!();
            return apps.find((c) => c.id === 'notes')?.status;
          }),
        { timeout: 30_000 },
      )
      .toBe('connected');
  });

  test.afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
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
    await card.getByRole('button', { name: 'Deny' }).click();
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
