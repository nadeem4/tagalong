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

test('ask streams an answer and completes the turn', async () => {
  const avatar = await windowFor('avatar');

  // Global hotkeys are unreliable on a CI desktop, so the panel is opened through the host
  // API the preload already exposes rather than by simulating Ctrl+Shift+Space.
  await avatar.evaluate(() => window.tagalongHost.togglePanel());

  const panel = await windowFor('panel');
  // The panel shows "Waking the crew…" until pets.list answers, so the composer is not in
  // the DOM the moment the window appears.
  const composer = panel.getByLabel('Message');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  await composer.fill('what is on my screen?');
  await composer.press('Enter');

  // The question is echoed back as a settled user message.
  await expect(panel.locator('[data-role="user"]').first()).toContainText('what is on my screen?', {
    timeout: 15_000,
  });

  // The streaming bubble is deliberately NOT asserted here. It exists only between the
  // first turn.delta and turn.completed, and the fake provider streams with no delay, so
  // the whole turn can finish between two Playwright polls — the bubble may never be
  // observable. Its incremental growth is covered deterministically in
  // packages/ui/src/chat-panel.test.tsx, which drives the deltas through a fake bridge.
  //
  // What this test asserts is the settled end state. The streaming bubble also carries
  // data-role="assistant", so it has to be excluded or this assertion could pass mid-stream.
  const settled = panel.locator('[data-role="assistant"]:not([data-testid="streaming-message"])');
  await expect(settled.first()).toBeVisible({ timeout: 30_000 });
  await expect(settled.first()).not.toBeEmpty();
  await expect(panel.getByTestId('streaming-message')).toHaveCount(0, { timeout: 30_000 });
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
    look: before.settings.hotkeys.look ?? 'CommandOrControl+Shift+S',
    seeEverything: before.settings.hotkeys.seeEverything ?? 'CommandOrControl+Shift+Alt+S',
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

test('Welcome opens on request: the agents found here, how Scout thinks, one key', async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.openOnboarding());
  const welcome = await windowFor('onboarding');

  await expect(welcome.getByRole('heading', { level: 1 })).toContainText('Hi, I’m');
  const found = welcome.getByRole('region', { name: 'Found on this computer' });
  await expect(found).toContainText('Claude Code');
  await expect(found).toContainText('Gemini CLI');
  await expect(found).toContainText('Codex');
  // Whatever is installed on the runner, Scout always has a way to think on offer.
  await expect(welcome.getByRole('radiogroup', { name: 'How Scout thinks' })).toContainText(
    'API key',
  );
  await expect(welcome.getByRole('button', { name: 'Start' })).toBeVisible();

  // Start is not pressed: it would make Scout the Companion and hide the crew the rest of
  // the suite talks to.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes('onboarding.html')) w.close();
    }
  });
});

test('Settings keeps the app-level sections and sends agents to Home', async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.openSettings());
  const settings = await windowFor('settings');

  for (const section of ['Keys and services', 'Summaries', 'Hotkeys', 'Awareness']) {
    await expect(settings.getByRole('region', { name: section })).toBeVisible({
      timeout: 15_000,
    });
  }
  // Agents live in Home now: no Pets section, no crew list, one way across.
  await expect(settings.getByRole('region', { name: 'Pets' })).toHaveCount(0);
  const nav = settings.getByRole('navigation', { name: 'Settings' });
  await expect(nav.getByRole('link', { name: 'Pets' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Open Home' })).toBeVisible();

  // A screenshot for design review, in the gitignored test-results folder.
  await settings.screenshot({ path: join(appDir, 'test-results', 'settings.png') });
  await settings.close();
});

test('Home opens with the real crew, each agent’s controls, and the activity view', async () => {
  const panel = await windowFor('panel');
  // The tray's Open Home item calls the same main-process function as this host call;
  // a tray menu cannot be clicked from Playwright.
  await panel.evaluate(() => window.tagalongHost.openOffice());
  const home = await windowFor('office');
  await expect(home).toHaveTitle('Home');

  const agents = home.getByRole('navigation', { name: 'Agents' });
  const pets = await panel.evaluate(() => window.tagalong.listPets());
  expect(pets.length).toBeGreaterThan(0);
  for (const pet of pets.slice(0, 8)) {
    await expect(agents.getByRole('button', { name: new RegExp(pet.name) })).toBeVisible({
      timeout: 15_000,
    });
  }

  // Each job label is the pet's role, by name, from the engine's own role library.
  const roles = await panel.evaluate(() => window.tagalong.listRoles());
  expect(roles.map((role) => role.id).sort()).toEqual([
    'backend-engineer',
    'companion',
    'frontend-engineer',
    'generalist',
    'researcher',
    'writer',
  ]);
  for (const pet of pets.slice(0, 8)) {
    const role = roles.find((r) => r.id === pet.roleId);
    const label = role === undefined ? 'GENERALIST' : role.name.toUpperCase();
    await expect(agents.getByRole('button', { name: new RegExp(pet.name) })).toContainText(label);
  }
  // The model prefill crosses the same bridge: a tiered provider recommends, fake does not.
  const recommended = await panel.evaluate(() =>
    Promise.all([
      window.tagalong.recommendModel('writer', 'nebius'),
      window.tagalong.recommendModel('writer', 'fake'),
    ]),
  );
  expect(recommended[0].model).toBeTruthy();
  expect(recommended[1]).toEqual({});

  // The right panel opens on the activity view; meetings keep their empty state.
  await expect(home.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(home.getByRole('tabpanel', { name: 'Activity' })).toBeVisible();
  await home.getByRole('tab', { name: 'Meetings' }).click();
  await expect(home.getByRole('complementary', { name: 'Meetings' })).toContainText(
    'No meetings yet',
  );

  // The Experts tab lists the tools the companion hands work to; a fresh install has none.
  await home.getByRole('tab', { name: 'Experts' }).click();
  await expect(home.getByText(/No experts yet/)).toBeVisible();
  await expect(home.getByRole('button', { name: 'Add expert' })).toBeVisible();

  // Picking an agent shows its controls: the whole role library, its own role chosen, its
  // tool switches, the directory card and the desktop pet control.
  const worker = pets.find((pet) => pet.id === 'scout') ?? pets[0];
  if (worker === undefined) throw new Error('no pet to put to work');
  await agents.getByRole('button', { name: new RegExp(worker.name) }).click();
  const controls = home.getByRole('tabpanel', { name: worker.name });
  await expect(controls.getByRole('radio')).toHaveCount(roles.length, { timeout: 15_000 });
  const own = roles.find((role) => role.id === worker.roleId);
  if (own === undefined) throw new Error(`${worker.name}'s role is not in the library`);
  await expect(controls.getByRole('radio', { name: own.name })).toBeChecked();
  await expect(controls.getByRole('switch')).toHaveCount(own.tools.length);
  await expect(
    controls.getByRole('region', { name: `How teammates see ${worker.name}` }),
  ).toContainText(own.summary);
  await expect(controls.getByRole('group', { name: 'Desktop pet' })).toBeVisible();
  await expect(controls.getByRole('button', { name: `Save ${worker.name}` })).toBeVisible();

  // The bundled typefaces must load under the page's CSP, or Home falls back to system
  // fonts without saying so.
  const fontsLoaded = await home.evaluate(async () => ({
    onest: (await document.fonts.load("14px 'Onest'")).length,
    pixel: (await document.fonts.load("17px 'Pixelify Sans'")).length,
  }));
  expect(fontsLoaded.onest).toBeGreaterThan(0);
  expect(fontsLoaded.pixel).toBeGreaterThan(0);

  // The window opens with a 1440x800 page whenever its display has room for that plus the
  // frame. A smaller screen is allowed to clamp it; the scene scrolls there instead.
  const opened = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('office.html'),
    );
    if (window === undefined) return null;
    const [width = 0, height = 0] = window.getContentSize();
    const [frameWidth = 0, frameHeight = 0] = window.getSize();
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    return {
      width,
      height,
      fits: area.width >= 1440 + frameWidth - width && area.height >= 800 + frameHeight - height,
    };
  });
  if (opened === null) throw new Error('the Home window is not open');
  if (opened.fits) expect([opened.width, opened.height]).toEqual([1440, 800]);
  else expect(opened.height).toBeGreaterThan(0);

  // The review screenshots below are taken at the default size: when this display is too
  // small for it, the window moves to the tallest display first.
  await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('office.html'),
    );
    const tallest = [...screen.getAllDisplays()].sort(
      (a, b) => b.workArea.height - a.workArea.height,
    )[0];
    if (window === undefined || tallest === undefined) return;
    window.setPosition(tallest.workArea.x, tallest.workArea.y);
    window.setContentSize(1440, 800);
  });
  await home.getByRole('tab', { name: 'Activity' }).click();
  await home.waitForTimeout(300);

  // The working state, proven on the real wire. The suite's fake pet is scripted to call
  // list_windows before it answers (TAGALONG_FAKE_TOOL), so the turn stays in flight while
  // the real host enumerates this machine's windows. Home logs every turn event so the
  // test can prove the capture happened before the turn ended.
  await home.evaluate(() => {
    const log: { type: string; at: number }[] = [];
    (window as unknown as { homeTurns: typeof log }).homeTurns = log;
    window.tagalong.onTurnEvent((event) => log.push({ type: event.type, at: performance.now() }));
  });
  await home.evaluate(
    (petId) => window.tagalong.ask({ petId, text: 'what windows do I have open?' }),
    worker.id,
  );

  const row = agents.getByRole('button', { name: new RegExp(worker.name) });
  await expect(row).toContainText('Working', { timeout: 10_000 });
  await expect(home.getByTestId(`monitor-${worker.id}`)).toHaveAttribute('data-lit', 'true');

  // A screenshot for design review, in the gitignored test-results folder.
  await home.screenshot({ path: join(appDir, 'test-results', 'office.png') });
  const shotAt = await home.evaluate(() => performance.now());
  const endedBeforeShot = await home.evaluate(
    (at) =>
      (window as unknown as { homeTurns: { type: string; at: number }[] }).homeTurns.some(
        (event) =>
          (event.type === 'turn.completed' || event.type === 'turn.error') && event.at < at,
      ),
    shotAt,
  );
  expect(endedBeforeShot, 'the screenshot must show the turn still in flight').toBe(false);

  // The turn ends and the pet goes back to its desk, monitor dark.
  await expect(row).toContainText('At desk', { timeout: 30_000 });
  await expect(home.getByTestId(`monitor-${worker.id}`)).toHaveAttribute('data-lit', 'false');

  // The activity view recorded the turn, from the engine's own record, and opens its thread.
  const activity = home.getByRole('list', { name: 'Activity' });
  const entry = activity.getByRole('button', { name: new RegExp(`${worker.name} answered`) });
  await expect(entry.first()).toBeVisible({ timeout: 10_000 });
  await expect(entry.first()).toContainText('call');
  await entry.first().click();
  await expect(home.getByRole('region', { name: `${worker.name} answered` }).first()).toContainText(
    'what windows do I have open?',
  );
  await home.waitForTimeout(200);
  await home.screenshot({ path: join(appDir, 'test-results', 'home.png') });

  // Add agent creates a generalist through the real pets.upsert and opens its controls.
  await agents.getByRole('button', { name: 'Add agent' }).click();
  await expect(agents.getByRole('button', { name: /New agent/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(home.getByRole('tab', { name: 'New agent' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const added = home.getByRole('tabpanel', { name: 'New agent' });
  await expect(added.getByRole('radio', { name: 'Generalist' })).toBeChecked();
  const crew = await panel.evaluate(() => window.tagalong.listPets());
  expect(crew.find((pet) => pet.name === 'New agent')).toMatchObject({ roleId: 'generalist' });

  await home.close();
});
