import type { Database } from 'better-sqlite3';
import { RolesUpgradeNotice } from '@tagalong/protocol';
import type { RolesUpgradeNoticePet } from '@tagalong/protocol';
import { LEGACY_DEFAULT_PERSONAS } from './roles-upgrade';

/** The notices row that holds what the upgrade to roles did. */
const ROLES_NOTICE_ID = 'roles-upgrade';

/**
 * Migration 6: records what migration 5 did, so the desktop can say so once.
 *
 * It runs in the same `migrate` call as migration 5 on an install from before roles, when
 * every stored pet is one migration 5 just upgraded; a pet with `notes` had its persona
 * kept. A fresh install has no pets yet (the crew is seeded after the migrations), so it
 * records nothing and never sees the notice. Kept apart from migration 5 because 5 had
 * already run on existing databases when the notice arrived.
 */
export function recordRolesNotice(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS notices (
     id TEXT PRIMARY KEY,
     json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     dismissed_at TEXT
   )`);
  const rows = db.prepare<[], { id: string; json: string }>('SELECT id, json FROM pets').all();
  if (rows.length === 0) return;

  const pets: RolesUpgradeNoticePet[] = rows
    .map((row) => {
      const stored = JSON.parse(row.json) as Record<string, unknown>;
      const notes = typeof stored.notes === 'string' ? stored.notes.trim() : '';
      return {
        petId: row.id,
        name: typeof stored.name === 'string' && stored.name.length > 0 ? stored.name : row.id,
        roleId: typeof stored.roleId === 'string' ? stored.roleId : 'generalist',
        keptNotes: notes.length > 0,
        madeByYou: !Object.hasOwn(LEGACY_DEFAULT_PERSONAS, row.id),
      };
    })
    .sort((a, b) => a.petId.localeCompare(b.petId));

  db.prepare(
    'INSERT OR REPLACE INTO notices (id, json, created_at, dismissed_at) VALUES (?, ?, ?, NULL)',
  ).run(ROLES_NOTICE_ID, JSON.stringify({ pets }), new Date().toISOString());
}

/** The roles notice while it is unseen, or null once dismissed or when there never was one. */
export function rolesUpgradeNotice(db: Database): RolesUpgradeNotice | null {
  const row = db
    .prepare<[string], { json: string }>(
      'SELECT json FROM notices WHERE id = ? AND dismissed_at IS NULL',
    )
    .get(ROLES_NOTICE_ID);
  return row === undefined ? null : RolesUpgradeNotice.parse(JSON.parse(row.json));
}

/** Marks the roles notice seen. False when there was nothing unseen to dismiss. */
export function dismissRolesNotice(db: Database): boolean {
  const result = db
    .prepare('UPDATE notices SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL')
    .run(new Date().toISOString(), ROLES_NOTICE_ID);
  return result.changes > 0;
}
