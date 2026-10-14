import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// Imported only for the `declare global` it carries: it is what types `window.tagalongHost`
// inside the page evaluate below, so a renamed host method fails the typecheck, not the run.
import type {} from '../src/shared/ipc';

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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await electron.launch({
    // A fresh profile every run, so a developer's own crew (and a pending roles notice that
    // would open the office at launch) never changes what this suite sees.
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tagalong-smoke-'))}`],
    cwd: appDir,
    // Fake providers keep the smoke test offline and deterministic: no API key, no
    // network, and a scripted answer that always streams the same way.
    env: {
      ...process.env,
      TAGALONG_FAKE_PROVIDERS: '1',
      TAGALONG_FAKE_TTS: '1',
      // Talk to Scout hears a fixed question, through Chromium's fake microphone.
      TAGALONG_FAKE_STT: '1',
      // Scripts the fake pet to reach for list_windows before it answers, which is the
      // only way a tool call travels the real socket to the real host in this suite.
      // Every tool test feeds the toolset a fake host and every host test feeds the
      // parser fixture output, so the perception.* methods between them are covered by
      // neither — and this phase has already shipped two dead paths through that gap.
      TAGALONG_FAKE_TOOL: 'list_windows',
      // Welcome would open on a fresh profile and change the window count the first test
      // asserts. Its own test below opens it on purpose.
      TAGALONG_SKIP_ONBOARDING: '1',
    },
  });
});

test.afterAll(async () => {
  await app.close();
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

  // Both windows are only created once the engine has booted — `start` returns early into
  // degraded mode if it did not — so seeing the pair is how the test knows the engine came
  // up. The panel starts hidden: it belongs to the hotkey, not to launch.
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
  expect(gap).toEqual({ side: 0, bottom: 0 });

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
  // The fake ears' live words: the mic opened, its frames reached the voice process and the
  // ears' events came back. Only then is it let go, so the release never beats the mic.
  await expect(panel.getByText('What am I', { exact: true })).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Stop listening' }).click();

  // The fake ears, in the real voice process, hear the same question every time; the bubble shows it.
  await expect(panel.getByText('What am I looking at?')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/This is the fake pet/)).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/Hold Ctrl\+Shift\+Alt\+Space to reply/)).toBeVisible({
    timeout: 30_000,
  });

  await avatar.evaluate(() => window.tagalongHost.hidePanel());
});

test('the bubble asks, shows the answer, and opens the full chat', async () => {
  const avatar = await windowFor('avatar');

  // Global hotkeys are unreliable on a CI desktop, so the panel is opened through the host
  // API the preload already exposes rather than by simulating Ctrl+Shift+Space.
  await avatar.evaluate(() => window.tagalongHost.togglePanel());

  const panel = await windowFor('panel');
  // The panel shows "Waking the crew…" until pets.list answers, so the bubble's field is
  // not in the DOM the moment the window appears.
  const field = panel.getByLabel(/^Ask /);
  await field.waitFor({ state: 'visible', timeout: 30_000 });

  await field.fill('what is on my screen?');
  await field.press('Enter');

  // The settled answer replaces "is thinking…"; the fake provider's words are fixed.
  await expect(panel.getByText(/This is the fake pet/)).toBeVisible({ timeout: 30_000 });
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

test('capture takes a real, downscaled PNG of the screen', async () => {
  const avatar = await windowFor('avatar');

  // Driven through the bridge the preload already exposes, not through Ctrl+Shift+S: a
  // global hotkey needs the app to hold focus, which nothing guarantees on a CI desktop.
  //
  // This is the one thing a unit test cannot reach. `capture.test.ts` proves the picking
  // and resizing logic against an injected fake capturer; only here does a real
  // `desktopCapturer.getSources` run inside a real Electron main process, against real
  // displays, and come back through IPC as the snapshot the engine would receive.
  //
  // The decoding happens inside the page on purpose. The base64 of a 1568px PNG is
  // megabytes, and returning it whole would push all of it over the CDP connection just
  // to look at its first four bytes.
  const shot = await avatar.evaluate(async () => {
    const snapshot = await window.tagalong.capture(['screenshot', 'activeWindow']);
    const screenshot = snapshot?.screenshot;
    if (screenshot === undefined) return null;
    // 12 base64 characters decode to 9 whole bytes, which is more than the signature needs.
    const head = atob(screenshot.base64.slice(0, 12));
    return {
      mime: screenshot.mime,
      base64Length: screenshot.base64.length,
      width: screenshot.width,
      height: screenshot.height,
      magic: [...head].slice(0, 4).map((character) => character.charCodeAt(0)),
    };
  });

  if (shot === null) {
    throw new Error(
      'perception.capture returned no screenshot: either the host refused it or ' +
        'desktopCapturer found nothing capturable on this machine',
    );
  }

  // Bytes, not a truthy string: a scripted stub, an empty buffer or a JPEG would all pass
  // a "something came back" assertion. 89 50 4E 47 is the PNG signature.
  expect(shot.magic).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(shot.mime).toBe('image/png');
  expect(shot.base64Length).toBeGreaterThan(0);

  // Positive dimensions, and the downscale actually applied in the running app — 1568 is
  // MAX_SCREENSHOT_LONG_SIDE, past which the vision models charge without seeing more.
  expect(shot.width).toBeGreaterThan(0);
  expect(shot.height).toBeGreaterThan(0);
  expect(Math.max(shot.width, shot.height)).toBeLessThanOrEqual(1568);
});

test('a full-view capture returns every real display and a composite', async () => {
  const avatar = await windowFor('avatar');

  // The task 5 counterpart to the screenshot check above, and the only place the
  // Phase 2B capture path runs for real. Every unit test in `displays.test.ts`,
  // `composite.test.ts` and `context.test.ts` injects a fake capturer — they prove the
  // layout maths and the policy, and all of them would pass with the Electron call
  // wired to nothing. Task 4 shipped exactly that bug on the PowerShell transport, so
  // this asserts the real `screen.getAllDisplays` and `desktopCapturer` ran and came
  // back as the snapshot the engine would receive.
  const full = await avatar.evaluate(async () => {
    const snapshot = await window.tagalong.capture(['displays']);
    const displays = snapshot?.displays;
    const composite = snapshot?.composite;
    if (displays === undefined || composite === undefined) return null;
    const head = atob(composite.base64.slice(0, 12));
    return {
      count: displays.length,
      // A display is either blanked by an exclusion or carries a picture; neither state
      // is "silently absent", which is what a dead capture would look like.
      accounted: displays.every(
        (display) => display.image !== undefined || display.blocked !== undefined,
      ),
      longestSide: Math.max(
        ...displays.map((display) =>
          Math.max(display.image?.width ?? 0, display.image?.height ?? 0),
        ),
      ),
      compositeMagic: [...head].slice(0, 4).map((character) => character.charCodeAt(0)),
      compositeWidth: composite.width,
      compositeHeight: composite.height,
    };
  });

  if (full === null) {
    throw new Error(
      'perception.capture returned no displays or no composite: the displays target is ' +
        'advertised as a capability, so an empty answer here is a broken capture rather ' +
        'than a quiet machine',
    );
  }

  // A running desktop has at least one display. Zero is a failure, not a state — the
  // same reasoning that made an empty window enumeration a complaint rather than silence.
  expect(full.count).toBeGreaterThan(0);
  expect(full.accounted).toBe(true);
  expect(full.longestSide).toBeGreaterThan(0);
  expect(full.longestSide).toBeLessThanOrEqual(1568);

  // The composite is the one image Tagalong builds rather than captures, so its bytes
  // prove the BGRA blitting and the nativeImage encode ran, not just that a field exists.
  expect(full.compositeMagic).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(full.compositeWidth).toBeGreaterThan(0);
  expect(full.compositeHeight).toBeGreaterThan(0);
  expect(Math.max(full.compositeWidth, full.compositeHeight)).toBeLessThanOrEqual(1568);
});

test('a tool call travels the real socket and the real host answers it', async () => {
  const avatar = await windowFor('avatar');

  // The gap this closes. Every test in packages/core/src/perception hands the toolset a
  // fake host, and every test in apps/desktop/src/main/platform feeds a parser fixture
  // output, so a tool can be right and a host can be right while the perception.* method
  // between them is unimplemented and the whole suite stays green. Phase 2B shipped that
  // exact shape twice: a dead PowerShell transport in task 4, and a capture path that
  // answered perception.capture(['displays']) with nothing in task 5.
  //
  // The fake pet is scripted to call list_windows before it answers, so asking anything
  // drives a real core-to-host request over the loopback socket into the real Electron
  // host, which really enumerates this machine's windows.
  const events = await avatar.evaluate(async () => {
    const seen: Array<{ type: string; tool: string | undefined; ok: boolean | undefined }> = [];
    const stop = window.tagalong.onTurnEvent((event) => {
      const carried = event as unknown as { type: string; tool?: string; ok?: boolean };
      seen.push({ type: carried.type, tool: carried.tool, ok: carried.ok });
    });

    const pets = await window.tagalong.listPets();
    const petId = pets[0]?.id;
    if (petId === undefined) throw new Error('no pet to ask');

    await window.tagalong.ask({ petId, text: 'what windows do I have open?' });
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    stop();
    return seen;
  });

  const result = events.find((event) => event.type === 'turn.toolResult');
  if (result === undefined) {
    throw new Error(
      'no turn.toolResult arrived: the fake pet was scripted to call list_windows, so ' +
        'either the tool never reached the host or perception.listWindows is not answered',
    );
  }

  expect(result.tool).toBe('list_windows');
  // ok:false would mean the round trip happened but the host refused or threw, which is
  // as much a failure as silence: the pet would tell the user it cannot see their windows.
  expect(result.ok).toBe(true);
});

/**
 * The test that catches a pause that does not pause.
 *
 * Every unit test in this repo injects a fake platform, and the gate is applied to the
 * real one in `start()`. So the whole suite passes with the gating removed — verified by
 * deleting `gateSight` from `start()` and watching 761 tests stay green. A privacy
 * control whose failure mode is silence needs a check that runs the real wiring.
 */
test('pausing sight refuses a real capture, and resuming restores it', async () => {
  const panel = await windowFor('panel');

  const running = await panel.evaluate(() => window.tagalongHost.getSightPaused());
  expect(running, 'sight should start running').toBe(false);

  const before = await panel.evaluate(() =>
    window.tagalong.capture(['screenshot', 'activeWindow']),
  );
  expect(before, 'a capture should work before pausing').not.toBeNull();

  const paused = await panel.evaluate(() => window.tagalongHost.toggleSightPause());
  expect(paused, 'the toggle should report the state it moved to').toBe(true);
  expect(await panel.evaluate(() => window.tagalongHost.getSightPaused())).toBe(true);

  // Null is how the host says it did not look. If the gate is not wired in, a real
  // screenshot comes back here and this line is the only thing in the repo that notices.
  const during = await panel.evaluate(() => window.tagalong.capture(['screenshot']));
  expect(during, 'a capture while paused must be refused, not taken').toBeNull();

  const inventory = await panel.evaluate(() => window.tagalong.capture(['windows']));
  expect(inventory, 'the window inventory must be refused while paused').toBeNull();

  await panel.evaluate(() => window.tagalongHost.toggleSightPause());
  expect(await panel.evaluate(() => window.tagalongHost.getSightPaused())).toBe(false);

  const after = await panel.evaluate(() => window.tagalong.capture(['screenshot']));
  expect(after, 'resuming must restore capture, or pause is a one-way door').not.toBeNull();
});

/**
 * The test that proves "without restart" is a fact rather than a promise.
 *
 * Every unit test around hotkeys injects a fake registrar and applies the bindings
 * itself, which proves the manager rebinds and never that a *save* reaches it. Delete the
 * one line in the save handler that re-applies them and all 780 unit tests still pass
 * while a rebound hotkey quietly does nothing until the next launch — the same shape as
 * the transport, the capture path and the pause gate earlier in this phase.
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

/** The two sight settings must survive the round trip through the real store. */
test('sight detail and the window text budget save and read back', async () => {
  const settings = await windowFor('panel');

  const before = await settings.evaluate(() => window.tagalongHost.getHostView());
  const saved = await settings.evaluate(() =>
    window.tagalongHost.saveSettings({ sightDetail: 'all', windowTextBudget: 12_000 }),
  );
  expect(saved.sightDetail).toBe('all');
  expect(saved.windowTextBudget).toBe(12_000);

  try {
    const reread = await settings.evaluate(() => window.tagalongHost.getHostView());
    expect(reread.settings.sightDetail).toBe('all');
    expect(reread.settings.windowTextBudget).toBe(12_000);
  } finally {
    // Same reason as the hotkey test: these persist, and a suite that leaves the budget
    // raised changes what every later run costs.
    await settings.evaluate(
      (previous) =>
        window.tagalongHost.saveSettings({
          sightDetail: previous.sightDetail,
          windowTextBudget: previous.windowTextBudget,
        }),
      {
        sightDetail: before.settings.sightDetail,
        windowTextBudget: before.settings.windowTextBudget,
      },
    );
  }
});

test('Setup opens on request: the steps are listed and an answer box waits', async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.openOnboarding());
  const setup = await windowFor('onboarding');

  await expect(setup).toHaveTitle('Set up Tagalong');
  await expect(setup.getByRole('navigation', { name: 'Setup steps' })).toBeVisible();
  await expect(setup.getByRole('heading', { level: 1 })).not.toBeEmpty();
  await expect(setup.getByLabel('Answer Scout')).toBeVisible();

  // Nothing is answered: finishing would make Scout the Companion and hide the crew the
  // rest of the suite talks to.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes('onboarding.html')) w.close();
    }
  });
});

test('Home is one window: Scout, experts, activity and settings', async () => {
  const panel = await windowFor('panel');
  // The tray's Open Tagalong item calls the same main-process function as this host call;
  // a tray menu cannot be clicked from Playwright.
  await panel.evaluate(() => window.tagalongHost.openOffice());
  const home = await windowFor('office');
  await expect(home).toHaveTitle('Home');

  // One companion and seven pages; no crew and no office scene.
  const nav = home.getByRole('navigation', { name: 'Tagalong' });
  await expect(nav.getByRole('button')).toHaveText(
    ['Overview', 'Scout', 'Experts', 'Routines', 'Connections', 'Activity', 'Settings'],
    { timeout: 15_000 },
  );
  const pets = await panel.evaluate(() => window.tagalong.listPets());
  expect(pets.map((pet) => pet.id)).toEqual(['scout']);
  await expect(home.getByRole('region', { name: 'Scout' })).toContainText('Thinks with');

  // Settings is a page of Home now: opening Settings anywhere lands here.
  await panel.evaluate(() => window.tagalongHost.openSettings());
  for (const section of ['How Scout thinks', 'Privacy', 'Shortcuts', 'Advanced']) {
    await expect(home.getByRole('region', { name: section })).toBeVisible({ timeout: 15_000 });
  }
  // Advanced is closed until asked for; it holds keys, summaries, sight detail and Welcome.
  const advanced = home.getByRole('button', { name: /Advanced/ });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.click();
  await expect(home.getByRole('list', { name: 'API keys' })).toBeVisible();
  await expect(home.getByRole('button', { name: 'Open Welcome again' })).toBeVisible();

  // The Experts page lists the tools the companion hands work to.
  await nav.getByRole('button', { name: 'Experts' }).click();
  await expect(home.getByRole('button', { name: 'Add expert' })).toBeVisible();

  // The Connections page offers the popular apps; nothing connects until Connect is pressed.
  await nav.getByRole('button', { name: 'Connections' }).click();
  await expect(home.getByRole('button', { name: 'Connect Notion' })).toBeVisible({
    timeout: 15_000,
  });
  await home.screenshot({ path: join(appDir, 'test-results', 'connections.png') });

  // A routine made in Home runs now on the fake brain and lands in Activity.
  await nav.getByRole('button', { name: 'Routines' }).click();
  await home.getByRole('button', { name: 'New routine' }).click();
  await home.getByRole('button', { name: /Blank/ }).click();
  await home.getByLabel('Name').fill('Smoke check');
  await home.getByLabel('What').fill('Say hello in one line.');
  await home.getByRole('button', { name: 'Save' }).click();
  const routines = home.getByRole('list', { name: 'Routines' });
  await expect(routines).toContainText('Smoke check', { timeout: 15_000 });
  await routines.getByRole('button', { name: 'Run now' }).click();
  await home.screenshot({ path: join(appDir, 'test-results', 'routines.png') });
  await nav.getByRole('button', { name: 'Activity' }).click();
  await expect(
    home
      .getByRole('list', { name: 'Activity' })
      .getByRole('button', { name: /Scout ran Smoke check/ }),
  ).toBeVisible({ timeout: 30_000 });

  // The bundled typefaces must load under the page's CSP, or Home falls back to system
  // fonts without saying so.
  const fontsLoaded = await home.evaluate(async () => ({
    onest: (await document.fonts.load("14px 'Onest'")).length,
    pixel: (await document.fonts.load("17px 'Pixelify Sans'")).length,
  }));
  expect(fontsLoaded.onest).toBeGreaterThan(0);
  expect(fontsLoaded.pixel).toBeGreaterThan(0);

  // A question to Scout shows up in Activity, from the engine's own record.
  await home.evaluate(() => window.tagalong.ask({ petId: 'scout', text: 'what is open?' }));
  await nav.getByRole('button', { name: 'Activity' }).click();
  const activity = home.getByRole('list', { name: 'Activity' });
  await expect(activity.getByRole('button', { name: /Scout answered/ }).first()).toBeVisible({
    timeout: 30_000,
  });

  // A screenshot for design review, in the gitignored test-results folder.
  await home.screenshot({ path: join(appDir, 'test-results', 'home.png') });
  await home.close();
});
