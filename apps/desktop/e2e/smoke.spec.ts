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
    args: ['.'],
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
