/**
 * Migration 5: gives every stored pet a role and moves an edited persona to notes. Kept for
 * databases older than that; never changed.
 */
import type { Database } from 'better-sqlite3';

/**
 * The personas the old default pets (scout, ink, bolt) were stored with, frozen because the
 * migration below compares against them: a stored default pet whose persona still matches
 * was never edited, so nothing is kept as notes.
 */
export const LEGACY_DEFAULT_PERSONAS: Readonly<Record<string, string>> = {
  scout:
    'You are Scout. You explain what the user is looking at, plainly and briefly. ' +
    'Prefer a direct answer over a preamble. When something on screen is ambiguous, ' +
    'say what you see and ask one short question rather than guessing.',
  ink:
    'You are Ink, the writer of the crew. You draft replies and rewrite text so it reads ' +
    "well while keeping the user's own voice. Ask about tone once if it is unclear, then " +
    'commit to a draft rather than offering a menu of options.',
  bolt:
    'You are Bolt, the coder of the crew. You read errors, stack traces and diffs, and ' +
    'propose the smallest fix that works. Cite the file and line when they are visible. ' +
    'Be direct; skip the pleasantries.',
};

/**
 * The role each old default pet was given; any other pet became a generalist. Frozen: the
 * library does not have these roles, and `roleFor` treats a role it does not have as the
 * companion.
 */
const DEFAULT_ROLES: Readonly<Record<string, string>> = {
  scout: 'generalist',
  ink: 'writer',
  bolt: 'backend-engineer',
};

const FALLBACK_ROLE = 'generalist';

/**
 * Migration 5: every stored pet without a role gets one. Default pets take their mapped
 * role and any other pet becomes a generalist; `toolAllowlist`, which nothing read, is
 * dropped; and `persona` moves to `notes` unless it is the default pet's shipped persona or
 * blank. A pet that already has a role is left alone.
 */
export function upgradePetsToRoles(db: Database): void {
  const rows = db.prepare<[], { id: string; json: string }>('SELECT id, json FROM pets').all();
  const update = db.prepare('UPDATE pets SET json = ? WHERE id = ?');
  for (const row of rows) {
    const stored = JSON.parse(row.json) as Record<string, unknown>;
    if (typeof stored.roleId === 'string') continue;

    const { persona, toolAllowlist: _allowlist, ...rest } = stored;
    const roleId =
      (Object.hasOwn(DEFAULT_ROLES, row.id) ? DEFAULT_ROLES[row.id] : undefined) ?? FALLBACK_ROLE;

    const text = typeof persona === 'string' ? persona.trim() : '';
    const shipped = Object.hasOwn(LEGACY_DEFAULT_PERSONAS, row.id)
      ? LEGACY_DEFAULT_PERSONAS[row.id]
      : undefined;
    const keepNotes = text.length > 0 && text !== shipped;

    const upgraded = {
      ...rest,
      roleId,
      toolGrants: {},
      ...(keepNotes ? { notes: text } : {}),
    };
    update.run(JSON.stringify(upgraded), row.id);
  }
}
