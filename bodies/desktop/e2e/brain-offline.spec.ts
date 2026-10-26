/**
 * The brain is not running: the app still opens and says so with the offline mark, instead
 * of an error box or a blank window. Nothing listens on the address it is given.
 */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let app: ElectronApplication;

/** A port that was free a moment ago: bind to 0, read it, release it. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
});

test('brain offline: app opens and shows the offline mark', async () => {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tagalong-offline-'))}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: `127.0.0.1:${await freePort()}`,
      TAGALONG_FAKE_TTS: '1',
      TAGALONG_SKIP_WELCOME: '1',
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
