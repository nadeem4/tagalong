/**
 * Home's Permissions list on the fake brain: Settings shows the tools in collapsed groups with
 * a summary, a group opens by its title, a click on Off, Ask or Auto reaches the brain as
 * set_permission, a locked tool is marked risky and warns before Auto, a person-only tool never
 * offers Auto, the search narrows the list and the i button opens a tool's longer text.
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
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-permissions-')));
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

test('Home settings lists permissions in groups and a click reaches the brain', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');

  // Groups come collapsed, each with its count and a summary of its modes.
  const card = home.getByRole('region', { name: 'Permissions' });
  const heads = card.getByRole('button', { expanded: false });
  await expect(heads).toHaveCount(5, { timeout: 30_000 });
  await expect(card.getByRole('button', { name: /^This computer/ })).toContainText(
    '2 · 1 Ask, 1 Auto',
  );
  await expect(card.getByRole('button', { name: /^Gmail/ })).toContainText('From Gmail');
  await expect(card.getByRole('radiogroup')).toHaveCount(0);

  // Open a group by its title and set a mode by the friendly name.
  await card.getByRole('button', { name: /^This computer/ }).click();
  const open = card.getByRole('radiogroup', { name: 'Open a link' });
  await expect(open.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true');
  // A locked tool is marked risky and warns before Auto.
  await expect(card).toContainText('Risky');
  await open.getByRole('radio', { name: 'Auto' }).click();
  await expect(card.getByRole('alert')).toContainText('no longer ask');
  await card.getByRole('button', { name: 'Cancel' }).click();
  expect(brain.permissionSets).toEqual([]);
  await open.getByRole('radio', { name: 'Auto' }).click();
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(open.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true', {
    timeout: 15_000,
  });
  // The group now flags the risky tool that runs without asking.
  await expect(card.getByRole('button', { name: /^This computer/ })).toContainText(
    '1 risky tool on Auto',
  );
  await open.getByRole('radio', { name: 'Off' }).click();
  await expect(open.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true', {
    timeout: 15_000,
  });
  expect(brain.permissionSets).toEqual([
    { tool: 'desktop__open_url', mode: 'auto' },
    { tool: 'desktop__open_url', mode: 'off' },
  ]);
  brain.permissionSets.length = 0;

  // A person-only app tool never offers Auto; a tool of a body that is away is marked.
  await card.getByRole('button', { name: /^Gmail/ }).click();
  const mail = card.getByRole('radiogroup', { name: 'delete_mail' });
  await expect(mail.getByRole('radio')).toHaveText(['Off', 'Ask']);
  await card.getByRole('button', { name: /^Chrome on work PC/ }).click();
  await expect(card).toContainText('Not connected');

  // A tool that asks for itself offers Off and Ask, never Auto, and Off then Ask works.
  await card.getByRole('button', { name: /^Jobs and experts/ }).click();
  const handOff = card.getByRole('radiogroup', { name: 'Hand work to an expert' });
  await expect(handOff.getByRole('radio')).toHaveText(['Off', 'Ask']);
  await handOff.getByRole('radio', { name: 'Off' }).click();
  await expect(handOff.getByRole('radio', { name: 'Off' })).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 15_000 },
  );
  await handOff.getByRole('radio', { name: 'Ask' }).click();
  await expect(handOff.getByRole('radio', { name: 'Ask' })).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 15_000 },
  );

  // Search narrows to the matching tools and hides the rest; clearing brings back the groups opened by hand.
  const search = card.getByRole('searchbox', { name: 'Find a permission' });
  await search.fill('windows');
  await expect(card.getByRole('radiogroup')).toHaveCount(1);
  await expect(card.getByRole('radiogroup', { name: 'See open windows' })).toBeVisible();
  await search.fill('');
  await expect(card.getByRole('radiogroup')).toHaveCount(5); // the groups opened above stay open

  // The i button opens the longer text and Escape closes it.
  await card.getByRole('button', { name: /^Memory/ }).click();
  await card.getByRole('button', { name: 'About Look back in memory' }).click();
  await expect(card.getByRole('dialog', { name: 'About Look back in memory' })).toBeVisible();
  await home.keyboard.press('Escape');
  await expect(card.getByRole('dialog')).toHaveCount(0);
});
