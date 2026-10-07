import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type {} from '../src/shared/ipc';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The one-time "Your crew has roles now" notice, on a real upgrade.
 *
 * Unit tests cover the migration, the RPC and the dialog apart. Only here does an install
 * from before roles go through the real migrations in the real engine, and the desktop open
 * the office on its own at launch to show what happened.
 */
let dataDir: string;
let app: ElectronApplication | undefined;

test.describe.configure({ mode: 'serial' });

function launch(): Promise<ElectronApplication> {
  // Its own profile: the single-instance lock is keyed on it, and a developer's own crew
  // is never rewritten into a pre-roles install.
  return electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    cwd: appDir,
    env: { ...process.env, TAGALONG_FAKE_PROVIDERS: '1', TAGALONG_SKIP_ONBOARDING: '1' },
  });
}

async function windowFor(running: ElectronApplication, name: string): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of running.windows()) {
      if (page.url().includes(`${name}.html`)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${name} window appeared`);
}

/**
 * Turns the freshly seeded profile into one from before roles: migrations 5 and 6 undone,
 * every pet back to a persona and a tool allowlist, Ink's persona edited, plus Nova, a pet
 * the user made.
 */
function rewindToBeforeRoles(): void {
  const db = new DatabaseSync(join(dataDir, 'tagalong.db'));
  try {
    db.exec('DELETE FROM schema_version WHERE version >= 5; DROP TABLE IF EXISTS notices;');
    const personas: Record<string, string> = { scout: '', ink: 'Write like a pirate.' };
    const rows = db.prepare('SELECT id, json FROM pets').all() as { id: string; json: string }[];
    const update = db.prepare('UPDATE pets SET json = ? WHERE id = ?');
    for (const row of rows) {
      const {
        roleId: _role,
        roleVersion: _version,
        toolGrants: _grants,
        notes: _notes,
        ...rest
      } = JSON.parse(row.json) as Record<string, unknown>;
      const legacy = { ...rest, persona: personas[row.id] ?? '', toolAllowlist: [] };
      update.run(JSON.stringify(legacy), row.id);
    }
    const nova = {
      id: 'nova',
      name: 'Nova',
      avatar: '🌟',
      color: '#6aa0e7',
      model: 'fake-model',
      providerId: 'fake',
      persona: 'You are Nova. Keep it short.',
      toolAllowlist: [],
      replyStyle: 'text',
    };
    db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
      'nova',
      JSON.stringify(nova),
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-roles-notice-'));
  // A first launch seeds the crew and migrates the profile, so the rewind starts from a
  // real database rather than a hand-written schema.
  const first = await launch();
  await windowFor(first, 'avatar');
  await first.close();
  rewindToBeforeRoles();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('an upgraded install opens the office on the roles notice, once', async () => {
  app = await launch();
  const office = await windowFor(app, 'office');

  const notice = office.getByRole('dialog', { name: 'Your crew has roles now' });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByRole('row', { name: /Ink/ })).toContainText(
    'Your edited persona is kept as notes.',
  );
  await expect(notice.getByRole('row', { name: /Ink/ })).toContainText('WRITER');
  await expect(notice.getByRole('row', { name: /Scout/ })).toContainText(
    'Default persona replaced by the role.',
  );
  await expect(notice.getByRole('row', { name: /Bolt/ })).toContainText('BACKEND ENGINEER');
  await expect(notice.getByRole('row', { name: /Nova/ })).toContainText(
    'pick a better role any time',
  );
  await expect(notice.getByRole('button', { name: 'Got it' })).toBeFocused();
  await office.waitForTimeout(300);
  await office.screenshot({ path: join(appDir, 'test-results', 'roles-notice.png') });

  await notice.getByRole('button', { name: 'What changed?' }).click();
  await expect(notice).toContainText('Instructions now come from the role.');

  await notice.getByRole('button', { name: 'Got it' }).click();
  await expect(notice).toBeHidden();
  await expect.poll(() => office.evaluate(() => window.tagalong.rolesNotice())).toBeNull();
});

test('a dismissed notice stays dismissed after a restart', async () => {
  await app?.close();
  app = await launch();
  const avatar = await windowFor(app, 'avatar');
  await expect.poll(() => avatar.evaluate(() => window.tagalong.rolesNotice())).toBeNull();
  // No office opens on its own when there is nothing to tell.
  await avatar.waitForTimeout(1_000);
  expect(app.windows().some((page) => page.url().includes('office.html'))).toBe(false);
});
