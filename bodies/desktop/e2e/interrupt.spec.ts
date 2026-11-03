/**
 * End-to-end: talking over Scout while it speaks pauses it, and the words go to the brain as an
 * interruption with how many sentences were heard. Runs on the fake brain.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` it carries: it types `window.tagalongHost` below.
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { seedSettings } from './fixtures/seed-settings';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let app: ElectronApplication;
let brain: FakeBrain;

test.beforeAll(async () => {
  brain = await startFakeBrain();
  app = await electron.launch({
    // A fresh profile: Always listening is off at launch, as on a new install.
    args: [
      '.',
      `--user-data-dir=${seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-interrupt-')))}`,
    ],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
      TAGALONG_FAKE_MIC: '1',
    },
  });
});

test.afterAll(async () => {
  try {
    await closeApp(app);
  } finally {
    await brain.close();
  }
});

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const page = app.windows().find((p) => p.url().includes(`${name}.html`));
    if (page !== undefined) return page;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no ${name} window`);
}

test('speech over Scout is sent to the brain as an interruption', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');
  await panel.getByRole('switch', { name: 'Always listening' }).click();

  // The fake brain hears a first question and speaks a 3 s answer.
  await expect.poll(() => brain.voice.spokenSays, { timeout: 30_000 }).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const asked = brain.voice.says.length;

  // The person talks over it, with no name: the words ride on the next say.
  brain.hear('speech_start');
  brain.hear('turn_end', 'wait, not that folder');
  await expect.poll(() => brain.voice.says.length, { timeout: 15_000 }).toBeGreaterThan(asked);
  const said = brain.voice.says[asked];
  expect(said?.text).toBe('wait, not that folder');
  expect(said?.interrupted).toEqual({ turn: 't1', heard: 0 });
});
