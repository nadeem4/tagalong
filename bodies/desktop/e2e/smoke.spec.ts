/**
 * End-to-end smoke test: one app on a fake brain, through the avatar, bubble, talk, a
 * tool call over the real socket, the sight pause, hotkeys and sight settings, and Home.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` it carries: it is what types `window.tagalongHost`
// inside the page evaluate below, so a renamed host method fails the typecheck, not the run.
import type {} from '../src/shared/ipc';
import { stripLoaded } from './bean-strip';
import { closeApp } from './fixtures/close-app';
import { startFakeBrain, type FakeBrain } from './fixtures/fake-brain';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * One app for the whole file.
 *
 * Electron's single-instance lock means a second launch quits instead of starting, so
 * relaunching per test only works if every previous instance shut down cleanly — and when
 * one does not, the failure surfaces as an unrelated "no window appeared" in the *next*
 * test. One launch keeps a real failure attributable to the thing that broke.
 */
let app: ElectronApplication;
let brain: FakeBrain;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  brain = await startFakeBrain();
  app = await electron.launch({
    // A fresh profile every run, so a developer's own pets and settings never change what this
    // suite sees.
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tagalong-smoke-'))}`],
    cwd: appDir,
    // Fake providers keep the smoke test offline and deterministic: no API key, no
    // network, and a scripted answer that always streams the same way.
    env: {
      ...process.env,
      // The desktop dials this brain; nothing else answers a turn now.
      TAGALONG_BRAIN_ADDR: brain.addr,
      // The mic is Chromium's fake device; the fake brain answers the frames with a fixed question.
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

/** Waits for the renderer window whose URL names the given entry point. */
async function windowFor(name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of app.windows()) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `no ${name} window appeared; saw ${app
      .windows()
      .map((w) => w.url())
      .join(', ')}`,
  );
}

test('the app launches with its avatar and its panel', async () => {
  const avatar = await windowFor('avatar');
  await expect(avatar.locator('body')).toBeVisible();

  // Both windows are created at boot, always (the brain being down does not stop them),
  // so seeing the pair is how the test knows the app came up. The panel starts hidden: it belongs to the hotkey, not to launch.
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL(),
      visible: w.isVisible(),
    })),
  );
  expect(windows.map((w) => w.url.replace(/^.*\//, '')).sort()).toEqual([
    'avatar.html',
    'panel.html',
  ]);
  expect(windows.find((w) => w.url.includes('panel.html'))?.visible).toBe(false);
});

test('Bean draws on the dock: its strip loads past the window CSP', async () => {
  const avatar = await windowFor('avatar');
  const clip = avatar.getByTestId('bean-clip').first();
  await expect(clip).toBeAttached();
  expect(await stripLoaded(clip)).toBe('loaded');
});

test('clicking Scout opens its bubble, and clicking again keeps it open', async () => {
  const avatar = await windowFor('avatar');
  const panelVisible = () =>
    app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('panel.html'))
          ?.isVisible() ?? false,
    );
  const pet = avatar.getByRole('button', { name: /^Ask / });
  await pet.click();
  await expect.poll(panelVisible, { timeout: 10_000 }).toBe(true);

  // A click opens at once, with nothing captured: the click has just put the pet's own
  // window in front, so a selection copy or a window read would only find Tagalong itself.
  expect(await avatar.evaluate(() => window.tagalongHost.getContext())).toBeNull();

  // It opens against the pet, as if the pet were speaking: touching it on one side, its
  // bottom level with the pet's.
  const gap = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const of = (page: string) =>
      all.find((w) => w.webContents.getURL().includes(page))?.getBounds();
    const bubble = of('panel.html');
    const dock = of('avatar.html');
    if (bubble === undefined || dock === undefined) return null;
    return {
      side: Math.min(
        Math.abs(bubble.x + bubble.width - dock.x),
        Math.abs(dock.x + dock.width - bubble.x),
      ),
      bottom: Math.abs(bubble.y + bubble.height - (dock.y + dock.height)),
    };
  });
  // Exact at 100% scale. At a fractional scale (150%) Electron rounds the two heights
  // independently, so one pixel of slack is allowed there and only there.
  const slack = (await avatar.evaluate(() => window.devicePixelRatio)) === 1 ? 0 : 1;
  expect(gap?.side).toBeLessThanOrEqual(slack);
  expect(gap?.bottom).toBeLessThanOrEqual(slack);

  // A second click lands on the pet's own window, which takes the focus from the bubble:
  // that must not hide it.
  await pet.click();
  await avatar.waitForTimeout(400);
  expect(await panelVisible()).toBe(true);

  await avatar.evaluate(() => window.tagalongHost.hidePanel());
});

test('talking to Scout: the mic listens, Scout hears the question and answers', async () => {
  const avatar = await windowFor('avatar');
  // Held keys cannot be simulated on a CI desktop; the mic button takes the same path.
  await avatar.evaluate(() => window.tagalongHost.togglePanel());

  const panel = await windowFor('panel');
  const mic = panel.getByRole('button', { name: 'Talk to Scout' });
  await mic.waitFor({ state: 'visible', timeout: 30_000 });
  await mic.click();
  await expect(panel.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  await expect(panel.getByText(/Listening/)).toBeVisible();
  // The fake brain's live words: the mic opened, its frames reached the brain and its heard
  // events came back. Only then is it let go, so the release never beats the mic.
  await expect(panel.getByText('What am I', { exact: true })).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Stop listening' }).click();

  // The fake brain hears the same question every time; the bubble shows it.
  await expect(panel.getByText('What am I looking at?')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/This is the fake brain/)).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/Hold Right Ctrl to reply/)).toBeVisible({
    timeout: 30_000,
  });
  // Asked by voice, so the brain was asked to speak the answer back.
  expect(brain.voice.listens).toContain('held');
  expect(brain.voice.spokenSays).toBeGreaterThan(0);

  // The audio was played: the bubble shows Scout speaking, and Stop cuts it off, which the
  // brain hears as a hush.
  const stop = panel.getByRole('button', { name: 'Stop speaking' });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  const hushesBefore = brain.voice.hushes;
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect.poll(() => brain.voice.hushes).toBeGreaterThan(hushesBefore);

  await avatar.evaluate(() => window.tagalongHost.hidePanel());
});

test('the bubble asks, shows the answer, and opens the full chat', async () => {
  const avatar = await windowFor('avatar');

  // Global hotkeys are unreliable on a CI desktop, so the panel is opened through the host
  // API the preload already exposes rather than by simulating Ctrl+Shift+Space.
  await avatar.evaluate(() => window.tagalongHost.togglePanel());

  const panel = await windowFor('panel');
  // The panel shows a waiting line until pets.list answers, so the bubble's field is not in
  // the DOM the moment the window appears.
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });

  // The desktop told the brain on connect that Scout talks, in its voice, so a typed question
  // is read aloud too (not only a spoken one).
  await expect.poll(() => brain.voice.readAloud.at(-1)).toMatchObject({ on: true });
  const spokenBefore = brain.voice.spokenSays;

  await field.fill('what is on my screen?');
  await field.press('Enter');

  // The settled answer replaces "is thinking…"; the fake provider's words are fixed.
  await expect(panel.getByText(/This is the fake brain/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => brain.voice.spokenSays).toBe(spokenBefore + 1);
  await expect(panel.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 });

  // The bubble is still up after the answer: nothing during the turn may have hidden it.
  const state = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const bubble = all.find((w) => w.webContents.getURL().includes('panel.html'));
    return {
      visible: bubble?.isVisible() ?? false,
      focused: BrowserWindow.getFocusedWindow()?.webContents.getURL().replace(/^.*\//, '') ?? null,
    };
  });
  expect(state.visible).toBe(true);

  // The full chat is one click behind the bubble.
  await panel.getByRole('button', { name: 'Open full chat' }).click();
  await expect(panel.getByLabel('Message')).toBeVisible({ timeout: 15_000 });
});

test('pausing sight and resuming it round-trips through the host', async () => {
  const panel = await windowFor('panel');

  const running = await panel.evaluate(() => window.tagalongHost.getSightPaused());
  expect(running, 'sight should start running').toBe(false);

  const paused = await panel.evaluate(() => window.tagalongHost.toggleSightPause());
  expect(paused, 'the toggle should report the state it moved to').toBe(true);
  expect(await panel.evaluate(() => window.tagalongHost.getSightPaused())).toBe(true);

  // While paused, the brain's list_windows tool call is refused with the pause's own words.
  const reply = await panel.evaluate(
    (petId) =>
      new Promise<string>((resolve) => {
        let text = '';
        const off = window.tagalong.onTurnEvent((event) => {
          if (event.type === 'turn.delta') text += event.text;
          if (event.type === 'turn.completed') {
            off();
            resolve(text);
          }
        });
        void window.tagalong.ask({ petId, text: 'what windows are open?' });
      }),
    (await panel.evaluate(() => window.tagalong.listPets()))[0]?.id ?? 'scout',
  );
  expect(reply).toContain('sight is paused');

  await panel.evaluate(() => window.tagalongHost.toggleSightPause());
  expect(await panel.evaluate(() => window.tagalongHost.getSightPaused())).toBe(false);
});

/**
 * The test that proves "without restart" is a fact rather than a promise.
 *
 * Every unit test around hotkeys injects a fake registrar and applies the bindings
 * itself, which proves the manager rebinds and never that a *save* reaches it. Delete the
 * one line in the save handler that re-applies them and every unit test still passes
 * while a rebound hotkey quietly does nothing until the next launch.
 *
 * An accelerator Electron cannot parse is the observable handle: it makes registration
 * fail, and a failed registration is reported through `hostView`. No keypress needed, and
 * no dependence on which window has focus.
 */
test('a rebound hotkey is applied on save, without a restart', async () => {
  const settings = await windowFor('panel');

  const before = await settings.evaluate(() => window.tagalongHost.getHostView());
  expect(before.hotkeyError, 'the app should start with its hotkeys registered').toBeUndefined();

  const original = {
    ask: before.settings.hotkeys.ask,
    pauseSight: before.settings.hotkeys.pauseSight ?? 'CommandOrControl+Shift+Alt+P',
  };

  // Restored in a finally, not at the end of the happy path. Settings persist to the
  // real data directory, and an unregisterable accelerator left behind there makes the
  // *next* launch stop on a modal error box before any window appears — a failing
  // assertion here would otherwise break every later run of this suite instead of just
  // itself.
  let during;
  try {
    const saved = await settings.evaluate(
      (keys) =>
        window.tagalongHost.saveSettings({ hotkeys: { ...keys, ask: 'Ctrl+Shift+Nonsense' } }),
      original,
    );
    expect(saved.hotkeys.ask, 'the patch must reach the store').toBe('Ctrl+Shift+Nonsense');

    // The whole point: this error exists only because the save re-registered the bindings
    // in the running app. Without that call the store changes and nothing else does.
    during = await settings.evaluate(() => window.tagalongHost.getHostView());
  } finally {
    await settings.evaluate(
      (keys) => window.tagalongHost.saveSettings({ hotkeys: keys }),
      original,
    );
  }

  expect(
    during?.hotkeyError,
    'saving a hotkey must re-register it in the running app, not wait for a restart',
  ).toBeDefined();

  const after = await settings.evaluate(() => window.tagalongHost.getHostView());
  expect(after.hotkeyError, 'restoring a valid hotkey must clear the error too').toBeUndefined();
  expect(after.settings.hotkeys.ask).toBe(original.ask);
});

test('Home is one window: Scout, jobs, connections and settings', async () => {
  const panel = await windowFor('panel');
  // The tray's Open Tagalong item calls the same main-process function as this host call;
  // a tray menu cannot be clicked from Playwright.
  await panel.evaluate(() => window.tagalongHost.openHome());
  const home = await windowFor('home');
  await expect(home).toHaveTitle('Home');

  // One companion and six pages, all fed by the brain.
  const nav = home.getByRole('navigation', { name: 'Tagalong' });
  await expect(nav.getByRole('button')).toHaveText(
    ['Overview', 'Jobs', 'Connections', 'Approvals', 'What Scout remembers', 'Settings'],
    { timeout: 15_000 },
  );
  const pets = await panel.evaluate(() => window.tagalong.listPets());
  expect(pets.map((pet) => pet.id)).toEqual(['scout']);
  await expect(home.getByRole('region', { name: 'Scout' })).toContainText(
    'Never at its blind spots.',
  );

  // Bean, still, in the nav tile: its strip loads past Home's CSP.
  const navBean = nav.locator('.home-nav__tile [data-testid=bean-clip]');
  await expect(navBean).toBeVisible();
  expect(await stripLoaded(navBean)).toBe('loaded');

  // Settings is a page of Home: opening Settings anywhere lands here.
  await panel.evaluate(() => window.tagalongHost.openSettings());
  for (const section of ['Privacy', 'Shortcuts']) {
    await expect(home.getByRole('region', { name: section })).toBeVisible({ timeout: 15_000 });
  }

  // The Connections page lists the apps the (fake) brain keeps.
  await nav.getByRole('button', { name: 'Connections' }).click();
  await expect(home.getByRole('region', { name: 'Files' })).toBeVisible({
    timeout: 15_000,
  });
  await home.screenshot({ path: join(appDir, 'test-results', 'connections.png') });

  // The bundled typefaces must load under the page's CSP, or Home falls back to system
  // fonts without saying so.
  const fontsLoaded = await home.evaluate(async () => ({
    onest: (await document.fonts.load("14px 'Onest'")).length,
    pixel: (await document.fonts.load("17px 'Pixelify Sans'")).length,
  }));
  expect(fontsLoaded.onest).toBeGreaterThan(0);
  expect(fontsLoaded.pixel).toBeGreaterThan(0);

  // A screenshot for design review, in the gitignored test-results folder.
  await home.screenshot({ path: join(appDir, 'test-results', 'home.png') });
  await home.close();
});
