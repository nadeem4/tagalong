/**
 * The brain is not running: the app still opens and says so with the offline mark, instead
 * of an error box or a blank window. Nothing listens on the address it is given.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

test('brain offline: app opens and shows the offline mark', async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-offline-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: `127.0.0.1:${await freePort()}`,
      // The brain must stay down, so the desktop must not start one.
      TAGALONG_START_BRAIN: '0',
      TAGALONG_FAKE_TTS: '1',
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
});
