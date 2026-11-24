/**
 * Memories other AI tools added, on the fake brain: filtering the timeline to one tool and
 * deleting everything from it removes those memories and leaves the tool connected.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { seedSettings } from './fixtures/seed-settings';
import { launchEnv } from './fixtures/launch-env';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication;
let brain: FakeBrain;
let dataDir: string;

test.beforeAll(async () => {
  brain = await startFakeBrain({
    hasKey: true,
    devices: [{ id: 'd3', name: 'cursor', kind: 'mcp_client' }],
    outsideMemories: [
      { id: 'o1', text: 'Uses pnpm workspaces', source: 'mcp:cursor' },
      { id: 'o2', text: 'Prefers small PRs', source: 'mcp:cursor' },
      { id: 'o3', text: 'Writes Rust on weekends', source: 'mcp:codex' },
    ],
  });
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-tool-memories-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...launchEnv(dataDir), TAGALONG_BRAIN_ADDR: brain.addr, TAGALONG_START_BRAIN: '0' },
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
    const page = app.windows().find((p) => p.url().includes(`${name}.html`));
    if (page !== undefined) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

test('deleting everything from one tool removes its memories and leaves it connected', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  const nav = home.getByRole('navigation');
  await nav.getByRole('button', { name: /^What Scout remembers/ }).click();
  await expect(home.getByText('Uses pnpm workspaces')).toBeVisible({ timeout: 30_000 });
  await home.getByRole('button', { name: /^Cursor/ }).click();
  await expect(home.getByText('Writes Rust on weekends')).toHaveCount(0);
  await home.getByRole('button', { name: 'Delete everything from this tool' }).click();
  await expect(home.getByRole('alert')).toContainText('Cursor stays connected');
  await home.getByRole('button', { name: 'Delete them' }).click();
  await expect(home.getByText('Uses pnpm workspaces')).toHaveCount(0);
  await expect(home.getByText('Writes Rust on weekends')).toBeVisible();

  await nav.getByRole('button', { name: /^Devices/ }).click();
  await expect(home.getByRole('region', { name: 'AI tools' })).toContainText('cursor');
});
