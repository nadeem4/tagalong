/**
 * The first-run walkthrough end to end on the fake brain: it opens on a fresh start and hides
 * the pets, Skip tour and Finish mark it seen, closing part-way brings it back, the key step
 * follows the brain (invalid, offline, environment), Home can replay it. No real Anthropic call:
 * the fake brain answers `set_api_key`, and only a fake key is ever typed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';
import { closeApp } from './fixtures/close-app';
import { startFakeBrain, type FakeBrain, type FakeBrainOptions } from './fixtures/fake-brain';
import { freePort } from './fixtures/free-port';
import { seedSettings } from './fixtures/seed-settings';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_KEY = 'sk-ant-example-not-a-real-key';

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

/** Starts the app on a user-data dir whose walkthrough is not done (unless `dir` is reused). */
async function launch(addr: string, extraArgs: string[] = [], dir = dataDir): Promise<void> {
  dataDir = dir ?? mkdtempSync(join(tmpdir(), 'tagalong-tour-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`, ...extraArgs],
    cwd: appDir,
    env: { ...process.env, TAGALONG_BRAIN_ADDR: addr, TAGALONG_START_BRAIN: '0' },
  });
}

async function launchWith(options: FakeBrainOptions = {}, extraArgs: string[] = []): Promise<void> {
  brain = await startFakeBrain(options);
  await launch(brain.addr, extraArgs);
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

const visible = (name: string) =>
  app!.evaluate(
    ({ BrowserWindow }, part) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes(part))
        ?.isVisible() ?? false,
    `${name}.html`,
  );

const settingsFile = () => readFileSync(join(dataDir!, 'settings.json'), 'utf8');
const tourDone = () =>
  (JSON.parse(settingsFile()) as { walkthrough?: { done?: boolean } }).walkthrough?.done;

async function nextTo(tour: Page, step: number): Promise<void> {
  for (let at = 1; at < step; at += 1) {
    await tour.getByRole('button', { name: 'Next' }).click();
  }
  await expect(
    tour
      .getByRole('listitem')
      .nth(step - 1)
      .getByRole('button'),
  ).toHaveAttribute('aria-current', 'step');
}

async function pasteAndCheck(tour: Page): Promise<void> {
  await tour.getByLabel('API key').fill(FAKE_KEY);
  await tour.getByRole('button', { name: /Check key|Try again/ }).click();
}

/** The one place the main process writes "seen": closing the card or Skip tour with a key. */
async function expectClosedAndDone(tour: Page): Promise<void> {
  await tour.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  await expect.poll(tourDone, { timeout: 15_000 }).toBe(true);
}

test('fresh start shows the walkthrough and hides the pet, bubble and dock', async () => {
  await launchWith({ hasKey: true });
  const tour = await windowFor('walkthrough');
  await expect(
    tour.getByRole('heading', { name: 'One companion for all your AI tools' }),
  ).toBeVisible();
  expect(await visible('avatar')).toBe(false);
  expect(await visible('panel')).toBe(false);
  expect(existsSync(join(dataDir!, 'settings.json'))).toBe(false);
});

test('existing user with a key sees it once, can skip the key step, then never again', async () => {
  await launchWith({ hasKey: true });
  const tour = await windowFor('walkthrough');
  await nextTo(tour, 9);
  await expect(tour.getByText('A key is already set.')).toBeVisible({ timeout: 30_000 });
  await tour.getByRole('button', { name: 'Finish' }).click();
  await expect(tour.getByRole('heading', { name: 'Scout is on your screen' })).toBeVisible();
  await tour.getByRole('button', { name: 'Close' }).click();
  await expectClosedAndDone(tour);
  await expect.poll(() => visible('avatar')).toBe(true);

  // A second launch on the same data directory goes straight to the pet.
  await closeApp(app);
  await launch(brain!.addr, [], dataDir);
  await windowFor('avatar');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(app!.windows().some((w) => w.url().includes('walkthrough.html'))).toBe(false);
});

test('Skip tour without a key lands on step 9 and cannot finish', async () => {
  await launchWith({ hasKey: false });
  const tour = await windowFor('walkthrough');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour.getByRole('heading', { name: 'Add your Anthropic API key' })).toBeVisible();
  await expect(tour.getByRole('button', { name: 'Finish' })).toBeDisabled();
  expect(existsSync(join(dataDir!, 'settings.json'))).toBe(false);
});

test('Skip tour with a key closes the window and marks it seen', async () => {
  await launchWith({ hasKey: true });
  const tour = await windowFor('walkthrough');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await expectClosedAndDone(tour);
});

test('closing mid-way brings the pet back and the tour returns next launch', async () => {
  await launchWith({ hasKey: true });
  const tour = await windowFor('walkthrough');
  await tour.getByRole('button', { name: 'Next' }).click();
  await app!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('walkthrough.html'))
      ?.close(),
  );
  await expect.poll(() => visible('avatar')).toBe(true);
  expect(existsSync(join(dataDir!, 'settings.json')) && tourDone() === true).toBe(false);

  await closeApp(app);
  await launch(brain!.addr, [], dataDir);
  const again = await windowFor('walkthrough');
  await expect(
    again.getByRole('heading', { name: 'One companion for all your AI tools' }),
  ).toBeVisible();
});

test('invalid key then valid key finishes; the key never reaches settings.json', async () => {
  await launchWith({ hasKey: false, keyResults: ['invalid', 'ok'] });
  const tour = await windowFor('walkthrough');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour.getByText(/Saved on the machine running/)).toBeVisible({ timeout: 30_000 });

  await pasteAndCheck(tour);
  await expect(tour.getByText('That key was not accepted.')).toBeVisible();
  expect(brain!.keyAttempts).toBe(1);
  await expect(tour.getByLabel('API key')).toHaveValue(FAKE_KEY);
  await expect(tour.getByRole('button', { name: 'Finish' })).toBeDisabled();

  await tour.getByRole('button', { name: 'Check key' }).click();
  await expect(tour.getByText('A key is already set.')).toBeVisible();
  await expect(tour.getByLabel('API key')).toHaveValue('');
  expect(brain!.keyAttempts).toBe(2);
  await tour.getByRole('button', { name: 'Finish' }).click();
  await tour.getByRole('button', { name: 'Close' }).click();
  await expectClosedAndDone(tour);
  expect(settingsFile()).not.toContain(FAKE_KEY);

  // Settings > Change key still works after the tour.
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openSettings());
  const home = await windowFor('home');
  await expect(home.getByText('A key is already set.')).toBeVisible({ timeout: 30_000 });
  // Actually change the key there: one more check reaches the brain, and still no key on disk.
  await home.getByLabel('API key').fill(FAKE_KEY);
  await home.getByRole('button', { name: 'Check key' }).click();
  await expect.poll(() => brain!.keyAttempts).toBe(3);
  expect(settingsFile()).not.toContain(FAKE_KEY);
});

test('Finish marks the tour seen at once, so closing the card with X never brings it back', async () => {
  await launchWith({ hasKey: true });
  const tour = await windowFor('walkthrough');
  await nextTo(tour, 9);
  await expect(tour.getByText('A key is already set.')).toBeVisible({ timeout: 30_000 });
  await tour.getByRole('button', { name: 'Finish' }).click();
  await expect(tour.getByRole('heading', { name: 'Scout is on your screen' })).toBeVisible();
  await expect.poll(tourDone, { timeout: 15_000 }).toBe(true);

  // The window's own X, not the card's Close button.
  await app!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('walkthrough.html'))
      ?.close(),
  );
  await closeApp(app);
  await launch(brain!.addr, [], dataDir);
  await windowFor('avatar');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(app!.windows().some((w) => w.url().includes('walkthrough.html'))).toBe(false);
});

test('brain offline at step 9 says so, then recovers when the brain starts', async () => {
  const port = await freePort();
  await launch(`127.0.0.1:${port}`);
  const tour = await windowFor('walkthrough');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour.getByText('Scout’s brain is not running.')).toBeVisible({ timeout: 30_000 });
  await tour.getByLabel('API key').fill(FAKE_KEY);
  await expect(tour.getByRole('button', { name: 'Check key' })).toBeDisabled();
  await expect(tour.getByRole('button', { name: 'Finish' })).toBeDisabled();

  brain = await startFakeBrain({ hasKey: false, port });
  await expect(tour.getByRole('button', { name: 'Check key' })).toBeEnabled({ timeout: 30_000 });
  await expect(tour.getByText('Scout’s brain is not running.')).toBeHidden();
  await expect(tour.getByRole('button', { name: 'Finish' })).toBeDisabled();
});

test('a key from the environment shows the environment line and Finish is on', async () => {
  await launchWith({ hasKey: true, environment: true });
  const tour = await windowFor('walkthrough');
  await nextTo(tour, 9);
  await expect(tour.getByText('Set by your environment')).toBeVisible({ timeout: 30_000 });
  await expect(tour.getByRole('button', { name: 'Finish' })).toBeEnabled();
});

test('Show the tour again from Home reopens it at step 1', async () => {
  // A seen user: the tour does not open at launch.
  brain = await startFakeBrain({ hasKey: true });
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-tour-'));
  seedSettings(dataDir);
  await launch(brain.addr, [], dataDir);
  const avatar = await windowFor('avatar');
  await avatar.evaluate(() => window.tagalongHost.openHome());
  const home = await windowFor('home');
  await home.getByRole('button', { name: 'Show the tour again' }).click();
  const tour = await windowFor('walkthrough');
  await expect(
    tour.getByRole('heading', { name: 'One companion for all your AI tools' }),
  ).toBeVisible();
});

test('every step fits the window: footer in view, nothing wider than the page (150% scaling)', async () => {
  await launchWith({ hasKey: true }, ['--force-device-scale-factor=1.5']);
  const tour = await windowFor('walkthrough');
  for (let step = 1; step <= 9; step += 1) {
    const fit = await tour.evaluate(() => {
      const footer = document.querySelector('.wt-footer')!.getBoundingClientRect();
      const body = document.querySelector('.wt-body')!;
      return {
        footerInView:
          footer.bottom <= window.innerHeight + 1 && footer.right <= window.innerWidth + 1,
        noSideScroll: body.scrollWidth <= body.clientWidth,
      };
    });
    expect(fit, `step ${step}`).toEqual({ footerInView: true, noSideScroll: true });
    if (step < 9) await tour.getByRole('button', { name: 'Next' }).click();
  }
});
