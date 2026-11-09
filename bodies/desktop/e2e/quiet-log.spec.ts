/**
 * A plain launch leaves no renderer warning or error in tagalong.log: no CSP note, no
 * refused eval. Runs with the brain down, the state a launch starts in.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedSettings } from './fixtures/seed-settings';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { closeApp } from './fixtures/close-app';
import { freePort } from './fixtures/free-port';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let app: ElectronApplication;
let dataDir: string;

test.afterAll(async () => {
  try {
    await closeApp(app);
  } finally {
    if (dataDir !== undefined) {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }
});

test('a launch logs no renderer warning or error', async () => {
  dataDir = seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-quiet-')));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: `127.0.0.1:${await freePort()}`,
      TAGALONG_START_BRAIN: '0',
    },
  });
  let avatar = app.windows().find((w) => w.url().includes('avatar.html'));
  while (avatar === undefined) {
    avatar = await app.waitForEvent('window');
    if (!avatar.url().includes('avatar.html')) avatar = undefined;
  }
  await expect(avatar.getByTestId('status-mark')).toHaveAttribute('data-id', 'brain-offline', {
    timeout: 30_000,
  });
  // The other windows load the same shapes; open them too so their scripts run.
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  await avatar.evaluate(() => window.tagalongHost.openHome());
  await avatar.waitForTimeout(4000);
  const log = join(dataDir, 'logs', 'tagalong.log');
  const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
  console.log(`tagalong.log:\n${text}`);
  expect(text.split('\n').filter((line) => line.includes('[renderer]'))).toEqual([]);
});
