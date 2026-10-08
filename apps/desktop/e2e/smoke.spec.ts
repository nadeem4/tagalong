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
      // The setup wizard would open on a fresh profile and change the window count the
      // first test asserts. Its own test below opens it on purpose.
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

test('the setup wizard opens on request, insists on a key, and Skip closes it for good', async () => {
  const panel = await windowFor('panel');
  // The suite runs on the developer's real profile: keys may be stored, and the wizard may
  // already be done. Both are read first so the test neither assumes them nor leaves them changed.
  const before = await panel.evaluate(() => window.tagalongHost.getHostView());
  const keyStored = before.providers.some((choice) => choice.needsKey && choice.hasKey);

  try {
    await panel.evaluate(() => window.tagalongHost.openOnboarding());
    const wizard = await windowFor('onboarding');

    // Step one is the promise, before anything is asked of the user.
    await expect(wizard.getByTestId('step-welcome')).toContainText('privacy promise');
    await wizard.getByRole('button', { name: 'Next' }).click();

    // Step two names all three providers. No key is typed here: one would be stored in this
    // machine's real keychain.
    const provider = wizard.getByTestId('step-provider');
    await expect(provider).toContainText('OpenRouter');
    await expect(provider).toContainText('Nebius Token Factory');
    await expect(provider).toContainText('Anthropic');
    if (!keyStored) {
      await wizard.getByRole('button', { name: 'Next' }).click();
      await expect(wizard.getByRole('alert')).toContainText('API key');
    }

    await wizard.getByRole('button', { name: 'Skip setup' }).click();
    await expect
      .poll(async () =>
        (
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()),
          )
        ).some((url) => url.includes('onboarding.html')),
      )
      .toBe(false);

    const view = await panel.evaluate(() => window.tagalongHost.getHostView());
    expect(view.settings.onboarding.done).toBe(true);
    expect(view.crewSuggestions.nebius?.scout).toContain('nemotron');
  } finally {
    await panel.evaluate(
      (done) => window.tagalongHost.saveSettings({ onboarding: { done } }),
      before.settings.onboarding.done,
    );
  }
});

test("the wizard's crew step shows each role and prefills its recommended model", async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.openOnboarding());
  const wizard = await windowFor('onboarding');
  await wizard.getByRole('button', { name: 'Next' }).click();

  // This suite runs on a throwaway profile and fake providers, so a typed key is stored only
  // there and no model list is fetched from the network.
  await wizard.getByTestId('key-nebius').fill('nb-e2e-not-a-real-key');
  await wizard.getByRole('radio').nth(1).check();
  await wizard.getByRole('button', { name: 'Next' }).click();

  const crew = wizard.getByTestId('step-crew');
  await expect(crew.getByTestId('role-generalist')).toContainText('GENERALIST');
  await expect(crew.getByTestId('role-writer')).toContainText('WRITER');
  await expect(crew.getByTestId('role-backend-engineer')).toContainText('BACKEND ENGINEER');

  const expected = await wizard.evaluate(() => window.tagalong.recommendModel('writer', 'nebius'));
  // Ink starts on OpenRouter, which has no key here, so it moves to Token Factory on the
  // writer's recommended model. A pet already on a keyed provider keeps its model.
  const ink = crew.locator('fieldset', { hasText: 'Ink' });
  expect(expected.model).toBeTruthy();
  await expect(ink.getByTestId('model-ink')).toHaveValue(expected.model ?? '');
  await expect(ink.getByText('Recommended')).toBeVisible();
  await wizard.screenshot({ path: join(appDir, 'test-results', 'wizard-crew.png') });

  // Still editable: a different model drops the chip.
  await ink.getByTestId('model-ink').fill('nvidia/something-else');
  await expect(ink.getByText('Recommended')).toHaveCount(0);

  await wizard.getByRole('button', { name: 'Skip setup' }).click();
});

test('Settings opens on the crew, with the selected pet editor and its sections', async () => {
  const panel = await windowFor('panel');
  await panel.evaluate(() => window.tagalongHost.openSettings());
  const settings = await windowFor('settings');

  const nav = settings.getByRole('navigation', { name: 'Settings' });
  const pets = await panel.evaluate(() => window.tagalong.listPets());
  expect(pets.length).toBeGreaterThan(0);
  const [first] = pets;
  if (first === undefined) throw new Error('no pet to edit');
  for (const pet of pets.slice(0, 8)) {
    await expect(nav.getByRole('button', { name: new RegExp(pet.name) })).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(nav.getByRole('button', { name: new RegExp(first.name) })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const editor = settings.getByTestId(`pet-editor-${first.id}`);
  await expect(editor).toBeVisible();

  // The role picker offers the engine's whole library, by name, with the pet's own role
  // chosen, and the crew nav and the directory card name that role, never its id.
  const roles = await panel.evaluate(() => window.tagalong.listRoles());
  expect(roles.map((role) => role.id).sort()).toEqual([
    'backend-engineer',
    'frontend-engineer',
    'generalist',
    'researcher',
    'writer',
  ]);
  await expect(editor.getByRole('radio')).toHaveCount(5);
  for (const role of roles) {
    await expect(editor.getByRole('radio', { name: role.name })).toHaveCount(1);
  }
  const own = roles.find((role) => role.id === first.roleId);
  if (own === undefined) throw new Error(`${first.name}'s role is not in the library`);
  await expect(editor.getByRole('radio', { name: own.name })).toBeChecked();
  await expect(nav.getByRole('button', { name: new RegExp(first.name) })).toContainText(own.name);
  await expect(
    editor.getByRole('region', { name: `How teammates see ${first.name}` }),
  ).toContainText(own.summary);
  await expect(editor.getByRole('switch')).toHaveCount(own.tools.length);
  for (const section of ['Pets', 'Keys and services', 'Hotkeys', 'Awareness']) {
    await expect(settings.getByRole('region', { name: section })).toBeVisible();
  }

  // A screenshot for design review, in the gitignored test-results folder.
  await settings.screenshot({ path: join(appDir, 'test-results', 'settings.png') });
  await settings.close();
});

test('the Crew Office opens with the real crew in its party list', async () => {
  const panel = await windowFor('panel');
  // The tray's Open office item calls the same main-process function as this host call;
  // a tray menu cannot be clicked from Playwright.
  await panel.evaluate(() => window.tagalongHost.openOffice());
  const office = await windowFor('office');

  const party = office.getByRole('navigation', { name: 'Party' });
  const pets = await panel.evaluate(() => window.tagalong.listPets());
  expect(pets.length).toBeGreaterThan(0);
  for (const pet of pets.slice(0, 8)) {
    await expect(party.getByRole('button', { name: new RegExp(pet.name) })).toBeVisible({
      timeout: 15_000,
    });
  }

  // Each job label is the pet's role, by name, from the engine's own role library.
  const roles = await panel.evaluate(() => window.tagalong.listRoles());
  expect(roles.map((role) => role.id)).toContain('generalist');
  for (const pet of pets.slice(0, 8)) {
    const role = roles.find((r) => r.id === pet.roleId);
    const label = role === undefined ? 'GENERALIST' : role.name.toUpperCase();
    await expect(party.getByRole('button', { name: new RegExp(pet.name) })).toContainText(label);
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
  await expect(office.getByRole('complementary', { name: 'Meetings' })).toContainText(
    'No meetings yet',
  );

  // The bundled typefaces must load under the page's CSP, or the office falls back to
  // system fonts without saying so.
  const fontsLoaded = await office.evaluate(async () => ({
    onest: (await document.fonts.load("14px 'Onest'")).length,
    pixel: (await document.fonts.load("17px 'Pixelify Sans'")).length,
  }));
  expect(fontsLoaded.onest).toBeGreaterThan(0);
  expect(fontsLoaded.pixel).toBeGreaterThan(0);

  // The window opens with a 1280x800 page whenever its display has room for that plus the
  // frame. A smaller screen is allowed to clamp it; the floor scrolls there instead.
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
      fits: area.width >= 1280 + frameWidth - width && area.height >= 800 + frameHeight - height,
    };
  });
  if (opened === null) throw new Error('the office window is not open');
  if (opened.fits) expect([opened.width, opened.height]).toEqual([1280, 800]);
  else expect(opened.height).toBeGreaterThan(0);

  // The review screenshot below is taken at the default size: when this display is too
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
    window.setContentSize(1280, 800);
  });
  await office.waitForTimeout(300);

  // The working state, proven on the real wire. The suite's fake pet is scripted to call
  // list_windows before it answers (TAGALONG_FAKE_TOOL), so the turn stays in flight while
  // the real host enumerates this machine's windows. The office logs every turn event so
  // the test can prove the capture happened before the turn ended.
  const worker = pets.find((pet) => pet.id === 'scout') ?? pets[0];
  if (worker === undefined) throw new Error('no pet to put to work');
  await office.evaluate(() => {
    const log: { type: string; at: number }[] = [];
    (window as unknown as { officeTurns: typeof log }).officeTurns = log;
    window.tagalong.onTurnEvent((event) => log.push({ type: event.type, at: performance.now() }));
  });
  await office.evaluate(
    (petId) => window.tagalong.ask({ petId, text: 'what windows do I have open?' }),
    worker.id,
  );

  const row = party.getByRole('button', { name: new RegExp(worker.name) });
  await expect(row).toContainText('Working', { timeout: 10_000 });
  await expect(office.getByTestId(`monitor-${worker.id}`)).toHaveAttribute('data-lit', 'true');

  // A screenshot for design review, in the gitignored test-results folder.
  await office.screenshot({ path: join(appDir, 'test-results', 'office.png') });
  const shotAt = await office.evaluate(() => performance.now());
  const endedBeforeShot = await office.evaluate(
    (at) =>
      (window as unknown as { officeTurns: { type: string; at: number }[] }).officeTurns.some(
        (event) =>
          (event.type === 'turn.completed' || event.type === 'turn.error') && event.at < at,
      ),
    shotAt,
  );
  expect(endedBeforeShot, 'the screenshot must show the turn still in flight').toBe(false);

  // The turn ends and the pet goes back to its desk, monitor dark.
  await expect(row).toContainText('At desk', { timeout: 30_000 });
  await expect(office.getByTestId(`monitor-${worker.id}`)).toHaveAttribute('data-lit', 'false');

  await office.close();
});

// The desktop companion and the sight permission.

test('the desktop shows one pixel companion that opens the chat on it', async () => {
  const avatar = await windowFor('avatar');
  const settings = (await avatar.evaluate(() => window.tagalongHost.getHostView())).settings;
  const pets = await avatar.evaluate(() => window.tagalong.listPets());
  const companion = pets.find((pet) => pet.id === settings.defaultPetId) ?? pets[0];
  if (companion === undefined) throw new Error('no crew to put on the desktop');

  // One pet, drawn as a sprite with its name on a plate: no strip, no emoji.
  const pet = avatar.getByRole('button', { name: /^Chat with / });
  await expect(pet).toHaveCount(1);
  await expect(pet).toHaveAccessibleName(`Chat with ${companion.name}`);
  await expect(avatar.getByTestId('companion-plate')).toHaveText(companion.name);
  const text = await avatar.evaluate(
    () => document.querySelector('.companion button')?.textContent ?? '',
  );
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);

  // The window is sized for the one pet and its badges.
  const size = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('avatar.html'))
      ?.getSize(),
  );
  expect(size).toEqual([96, 96]);

  // Clicking the pet opens the panel on it.
  await avatar.evaluate(() => window.tagalongHost.hidePanel());
  await pet.click();
  await expect.poll(() => panelVisible()).toBe(true);
  await avatar.evaluate(() => window.tagalongHost.hidePanel());
});

/** Whether the chat panel is showing. */
function panelVisible(): Promise<boolean | undefined> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('panel.html'))
      ?.isVisible(),
  );
}

test('sight Always looks with every ask, still behind the pause; When I ask does not', async () => {
  const avatar = await windowFor('avatar');
  // Saving sight reloads the companion window, so host calls go through the panel, whose
  // page stays put; the companion is only read through locators, which wait out a reload.
  const host = await windowFor('panel');
  const before = (await host.evaluate(() => window.tagalongHost.getHostView())).settings;

  /** Opens the panel the way the ask key and a click on the pet do; returns what it captured. */
  async function plainAsk() {
    await host.evaluate(() => window.tagalongHost.hidePanel());
    await host.evaluate(() => window.tagalongHost.togglePanel());
    return host.evaluate(() => window.tagalongHost.getContext());
  }

  try {
    // The Settings control saves the permission the moment it is chosen.
    await host.evaluate(() => window.tagalongHost.openSettings());
    const settingsWindow = await windowFor('settings');
    const group = settingsWindow.getByRole('radiogroup', { name: 'Sight permission' });
    await expect(group.getByRole('radio', { name: /When I ask/ })).toBeChecked({
      timeout: 15_000,
    });
    await group.getByRole('radio', { name: /Always/ }).check();
    await expect
      .poll(async () => (await host.evaluate(() => window.tagalongHost.getHostView())).settings)
      .toMatchObject({ sight: 'always' });
    await settingsWindow.close();

    // Always keeps rolling memory running and shows its calm eye on the companion.
    await expect.poll(() => host.evaluate(() => window.tagalongHost.getRecording())).toBe(true);
    await expect(avatar.getByTestId('always-eye')).toBeVisible({ timeout: 15_000 });
    await expect(avatar.getByTestId('recording-dot')).toBeVisible();

    // A plain ask, with no look key, carries a picture of the active window.
    const always = await plainAsk();
    expect(always?.screenshot, 'sight Always must attach a look to a plain ask').toBeDefined();

    // The pause still wins: nothing is read, and the eye says so.
    await host.evaluate(() => window.tagalongHost.toggleSightPause());
    const paused = await plainAsk();
    expect(paused?.screenshot, 'a paused Always must not look').toBeUndefined();
    await expect(avatar.getByTestId('paused-eye')).toBeVisible();
    await host.evaluate(() => window.tagalongHost.toggleSightPause());

    // The working state with sight Always on, for the design review screenshot. The fake
    // pet calls list_windows first, which keeps the turn in flight while the host looks.
    await host.evaluate(
      (petId) => window.tagalong.ask({ petId, text: 'what windows do I have open?' }),
      before.defaultPetId,
    );
    await expect(avatar.getByTestId('working-mark')).toBeVisible({ timeout: 10_000 });
    await avatar.screenshot({ path: join(appDir, 'test-results', 'companion.png') });
    await expect(avatar.getByTestId('working-mark')).toHaveCount(0, { timeout: 30_000 });
  } finally {
    // Persisted settings: a suite that leaves sight on Always changes every later run.
    await host.evaluate(
      (previous) =>
        window.tagalongHost.saveSettings({
          sight: previous.sight,
          rollingMemory: previous.rolling,
        }),
      { sight: before.sight, rolling: before.rollingMemory },
    );
    await host.evaluate(() => window.tagalongHost.hidePanel());
  }

  // When I ask is exactly as before: a plain ask carries no picture.
  const asked = await plainAsk();
  expect(asked?.screenshot, 'When I ask must not look on a plain ask').toBeUndefined();
  await expect(avatar.getByTestId('always-eye')).toHaveCount(0, { timeout: 15_000 });
  await host.evaluate(() => window.tagalongHost.hidePanel());
});
