/**
 * The mic level meter end to end, on Chromium's fake microphone (it beeps, so the bar moves):
 * Test your microphone in walkthrough step 5 and in Settings > Voice. No real microphone, no
 * real provider; the meter reads the level in the window and sends nothing to the brain.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';
import { seedSettings } from './fixtures/seed-settings';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let app: ElectronApplication | undefined;
let brain: FakeBrain | undefined;
let dataDir: string | undefined;

test.afterEach(async () => {
  try {
    await closeApp(app);
  } finally {
    app = undefined;
    await brain?.close();
    brain = undefined;
    if (dataDir !== undefined) {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
    dataDir = undefined;
  }
});

async function launch(tourDone: boolean): Promise<void> {
  brain = await startFakeBrain({ hasKey: true });
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-meter-'));
  if (tourDone) seedSettings(dataDir);
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_BRAIN_ADDR: brain.addr,
      TAGALONG_START_BRAIN: '0',
      TAGALONG_FAKE_MIC: '1',
    },
  });
}

async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    for (const page of app?.windows() ?? []) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

/** Presses Test your microphone and waits until the bar has moved, then stops it. */
async function meterMoves(page: Page): Promise<void> {
  await expect(page.getByRole('meter')).toHaveCount(0);
  await page.getByRole('button', { name: 'Test your microphone' }).click();
  const meter = page.getByRole('meter');
  await expect(meter).toBeVisible();
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop test' }).click();
  await expect(page.getByRole('meter')).toHaveCount(0);
}

test('walkthrough step 5: the meter moves with the fake microphone', async () => {
  await launch(false);
  const tour = await windowFor('walkthrough');
  for (let at = 1; at < 5; at += 1) {
    await tour.getByRole('button', { name: /^(Get started|Next)$/ }).click();
  }
  await tour.getByLabel('Microphone').waitFor();
  await meterMoves(tour);
});

test('Settings voice: the meter moves with the fake microphone', async () => {
  await launch(true);
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Test your microphone' }).scrollIntoViewIfNeeded();
  await meterMoves(home);
});
