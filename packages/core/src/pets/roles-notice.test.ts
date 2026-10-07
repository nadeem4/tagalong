import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_DEFAULT_PERSONAS, upgradePetsToRoles } from './roles-upgrade';
import { dismissRolesNotice, recordRolesNotice, rolesUpgradeNotice } from './roles-notice';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE pets (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
});

afterEach(() => {
  db.close();
});

/** A pet as Phase 7 stored it, before roles. */
function storeLegacy(id: string, name: string, persona: string): void {
  const pet = { id, name, avatar: '*', model: 'm', providerId: 'fake', persona, toolAllowlist: [] };
  db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify(pet),
    '2026-01-01T00:00:00.000Z',
  );
}

/** Migrations 5 and 6, as an install from before roles runs them in one go. */
function upgrade(): void {
  upgradePetsToRoles(db);
  recordRolesNotice(db);
}

describe('recordRolesNotice', () => {
  it('records nothing on a fresh install, whose crew is seeded after the migrations', () => {
    upgrade();
    expect(rolesUpgradeNotice(db)).toBeNull();
  });

  it('records each upgraded pet, its role, and whether its persona was kept as notes', () => {
    storeLegacy('scout', 'Scout', LEGACY_DEFAULT_PERSONAS.scout!);
    storeLegacy('bolt', 'Bolt', 'Answer only in haiku.');
    storeLegacy('pip', 'Pip', 'You are Pip.');

    upgrade();

    expect(rolesUpgradeNotice(db)).toEqual({
      pets: [
        {
          petId: 'bolt',
          name: 'Bolt',
          roleId: 'backend-engineer',
          keptNotes: true,
          madeByYou: false,
        },
        { petId: 'pip', name: 'Pip', roleId: 'generalist', keptNotes: true, madeByYou: true },
        { petId: 'scout', name: 'Scout', roleId: 'generalist', keptNotes: false, madeByYou: false },
      ],
    });
  });

  it('records a pet the user made with a blank persona as keeping nothing', () => {
    storeLegacy('pip', 'Pip', '   ');
    upgrade();
    expect(rolesUpgradeNotice(db)?.pets[0]).toMatchObject({ keptNotes: false, madeByYou: true });
  });

  it('is safe to run twice, keeping one notice', () => {
    storeLegacy('ink', 'Ink', LEGACY_DEFAULT_PERSONAS.ink!);
    upgrade();
    recordRolesNotice(db);
    expect(rolesUpgradeNotice(db)?.pets).toHaveLength(1);
  });
});

describe('dismissRolesNotice', () => {
  it('marks the notice seen, so it is never shown again', () => {
    storeLegacy('ink', 'Ink', LEGACY_DEFAULT_PERSONAS.ink!);
    upgrade();

    expect(dismissRolesNotice(db)).toBe(true);

    expect(rolesUpgradeNotice(db)).toBeNull();
    expect(dismissRolesNotice(db)).toBe(false);
  });

  it('has nothing to dismiss on a fresh install', () => {
    upgrade();
    expect(dismissRolesNotice(db)).toBe(false);
  });
});
