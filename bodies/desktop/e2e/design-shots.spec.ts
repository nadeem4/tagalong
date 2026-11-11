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
