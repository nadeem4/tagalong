/**
 * End-to-end: pressing the talk key (the mic button takes the same path) while Scout speaks
 * pauses its voice and cancels nothing; only real words cut it off and ride on the next say.
 * Runs on the fake brain.
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
    args: [
      '.',
      `--user-data-dir=${seedSettings(mkdtempSync(join(tmpdir(), 'tagalong-keypause-')))}`,
    ],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: brain.addr, TAGALONG_FAKE_MIC: '1' },
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

test('the talk key pauses Scout and cancels nothing until real words are heard', async () => {
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.togglePanel());
  const panel = await windowFor('panel');
  const mic = panel.getByRole('button', { name: 'Talk to Scout' });
  await mic.waitFor({ state: 'visible', timeout: 30_000 });

  // A first spoken question, so Scout has an answer to speak.
  await mic.click();
  await expect(panel.getByText('What am I', { exact: true })).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Stop listening' }).click();
  await expect(panel.getByRole('button', { name: 'Stop speaking' })).toBeVisible({
    timeout: 30_000,
  });
  const hushes = brain.voice.hushes;
  const asked = brain.voice.says.length;

  // The key goes down while Scout speaks: the voice pauses, and no hush or say is sent.
  await panel.getByRole('button', { name: 'Talk to Scout' }).click();
  await expect.poll(() => brain.voice.speechStates, { timeout: 15_000 }).toContain('paused');
  expect(brain.voice.hushes).toBe(hushes);
  expect(brain.voice.says.length).toBe(asked);

  // Real words (the fake brain hears its usual question): Scout is cut off and the words ride
  // on the next say with what was heard of the answer.
  await expect(panel.getByText('What am I', { exact: true })).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Stop listening' }).click();
  await expect.poll(() => brain.voice.says.length, { timeout: 15_000 }).toBeGreaterThan(asked);
  expect(brain.voice.hushes).toBeGreaterThan(hushes);
  expect(brain.voice.says[asked]?.interrupted).toBeDefined();
});
