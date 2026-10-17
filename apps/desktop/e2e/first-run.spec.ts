/**
 * End-to-end: Welcome on a fresh profile, answered by typing, in two runs. Signed in to Claude:
 * setup resumes after a close, goes back by a chip, asks again and saves every answer. Without
 * Claude Code: setup offers the install or a key, and a checked key moves it on.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = { timeout: 30_000 };

function launch(dataDir: string, signIn: string): Promise<ElectronApplication> {
  // Each run has its own user-data directory, which also gives it its own single-instance
  // lock, apart from the smoke suite. The Claude sign-in is faked, never read from this machine.
  return electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: {
      ...process.env,
      TAGALONG_FAKE_PROVIDERS: '1',
      TAGALONG_FAKE_TTS: '1',
      TAGALONG_FAKE_SIGN_IN: signIn,
    },
  });
}

async function quit(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close').catch(() => undefined);
  // The evaluate can reject as the process exits; the close event is what matters.
  void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  // Teardown must never hang: if the app has not gone in 15 s, end the process.
  const timer = setTimeout(() => app.process().kill(), 15_000);
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}

async function windowFor(app: ElectronApplication, name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of app.windows()) if (page.url().includes(`${name}.html`)) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

/** Whether the window for an entry point is on screen. */
function visible(app: ElectronApplication, name: string): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, page) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.webContents.getURL().includes(`${page}.html`) && w.isVisible(),
      ),
    name,
  );
}

async function answer(page: Page, text: string): Promise<void> {
  await page.getByLabel('Answer Scout').fill(text);
  await page.getByLabel('Answer Scout').press('Enter');
}

const heading = (page: Page, name: string) => page.getByRole('heading', { name });

/** The first question: no mic in CI (no fake speech), so setup is answered by typing. */
async function chooseTyping(page: Page): Promise<void> {
  await expect(heading(page, 'Talk or type?')).toBeVisible(ENGINE);
  await page.getByRole('button', { name: 'I’ll type' }).click();
}

test.describe('setup by typing, signed in to Claude', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let dataDir: string;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'tagalong-first-run-'));
    app = await launch(dataDir, 'signed-in');
  });

  test.afterAll(async () => {
    await quit(app);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('a new install opens setup alone, asks talk or type, and a typed name moves it on', async () => {
    const setup = await windowFor(app, 'welcome');
    await chooseTyping(setup);
    await expect(heading(setup, 'What should I call you?')).toBeVisible(ENGINE);
    await windowFor(app, 'avatar');
    expect(await visible(app, 'avatar')).toBe(false);
    await answer(setup, 'Alex');
    await expect(heading(setup, 'How should I think?')).toBeVisible(ENGINE);
    await expect(setup.getByRole('button', { name: 'You: Alex' })).toBeVisible();
    await expect(setup.getByText('Got it, I’ll call you Alex.')).toBeVisible();
  });

  test('closed, Scout still arrives, and the next launch resumes at the same step', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.webContents.getURL().includes('welcome.html')) w.close();
      }
    });
    await expect.poll(() => visible(app, 'avatar'), ENGINE).toBe(true);
    await quit(app);
    app = await launch(dataDir, 'signed-in');
    const setup = await windowFor(app, 'welcome');
    await expect(heading(setup, 'How should I think?')).toBeVisible(ENGINE);
    await expect(setup.getByRole('button', { name: 'Typing' })).toBeVisible();
    await expect(setup.getByRole('button', { name: 'You: Alex' })).toBeVisible();
  });

  test('a step chip goes back, and Rather not returns to where you were', async () => {
    const setup = await windowFor(app, 'welcome');
    await setup.getByRole('button', { name: 'You: Alex' }).click();
    await expect(heading(setup, 'What should I call you?')).toBeVisible();
    await setup.getByRole('button', { name: 'Rather not' }).click();
    await expect(heading(setup, 'How should I think?')).toBeVisible();
    await expect(setup.getByRole('button', { name: 'No name' })).toBeVisible();
  });

  test('an unclear answer is asked again, then typing finishes setup and Scout invites a question', async () => {
    const setup = await windowFor(app, 'welcome');
    await answer(setup, 'banana');
    await expect(setup.getByRole('status')).toHaveText(/didn’t catch that/);
    await answer(setup, 'claude');
    await expect(heading(setup, 'Should I talk?')).toBeVisible();
    await setup.getByRole('button', { name: 'Text only' }).click();
    await expect(heading(setup, 'One key to remember')).toBeVisible();
    await answer(setup, 'got it');
    await expect.poll(() => visible(app, 'welcome'), ENGINE).toBe(false);
    await expect.poll(() => visible(app, 'avatar'), ENGINE).toBe(true);
    const panel = await windowFor(app, 'panel');
    await expect(panel.getByRole('button', { name: 'Try it now' })).toBeVisible(ENGINE);
    // The hello's line is the mind's, from the first hello's check-in: the fake one here. It is
    // typed in (hidden from screen readers) beside a status copy a screen reader hears whole.
    await expect(panel.getByTestId('intro-typed')).toHaveText(/This is the fake pet/, ENGINE);
    await expect(panel.getByRole('status').filter({ hasText: /This is the fake pet/ })).toHaveCount(
      1,
    );
  });

  test('every answer was saved as given, and setup does not open again', async () => {
    await quit(app);
    const saved = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as {
      welcome: { done: boolean; brain?: string; answerBy?: string };
      userName: string;
      userNameDeclined: boolean;
      voice: { enabled: boolean };
    };
    expect(saved.welcome).toMatchObject({ done: true, brain: 'claude-code', answerBy: 'type' });
    expect(saved.userName).toBe('');
    expect(saved.userNameDeclined).toBe(true);
    expect(saved.voice.enabled).toBe(false);
    app = await launch(dataDir, 'signed-in');
    await expect.poll(() => visible(app, 'avatar'), ENGINE).toBe(true);
    expect(await visible(app, 'welcome')).toBe(false);
  });
});

test.describe('setup by typing, without Claude Code', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let dataDir: string;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'tagalong-first-run-key-'));
    app = await launch(dataDir, 'not-installed');
  });

  test.afterAll(async () => {
    await quit(app);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('offers install or a key, and a key tested once moves setup on', async () => {
    const setup = await windowFor(app, 'welcome');
    await chooseTyping(setup);
    await expect(heading(setup, 'What should I call you?')).toBeVisible(ENGINE);
    await answer(setup, 'rather not');
    await expect(setup.getByRole('status')).toHaveText(/didn’t find Claude Code/, ENGINE);
    await expect(setup.getByRole('button', { name: /Install Claude Code/ })).toBeVisible();
    await setup.getByRole('button', { name: /An API key/ }).click();
    await setup.getByRole('button', { name: 'OpenRouter' }).click();
    await setup.getByLabel('Your OpenRouter key').fill('sk-or-test');
    await setup.getByRole('button', { name: 'Check key' }).click();
    await expect(heading(setup, 'Should I talk?')).toBeVisible(ENGINE);
    await expect(setup.getByRole('button', { name: 'OpenRouter' })).toBeVisible();
  });
});
