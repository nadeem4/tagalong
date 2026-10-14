import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_DEFAULT_PERSONAS, upgradePetsToRoles } from './roles-upgrade';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE pets (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
});

afterEach(() => {
  db.close();
});

/** A pet as Phase 7 stored it: persona and an allowlist, no role. */
function storeLegacy(id: string, fields: Record<string, unknown> = {}): void {
  const pet = {
    id,
    name: id,
    avatar: '*',
    model: 'm',
    providerId: 'fake',
    toolAllowlist: [],
    replyStyle: 'text',
    ...fields,
  };
  db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify(pet),
    '2026-01-01T00:00:00.000Z',
  );
}

function stored(id: string): Record<string, unknown> {
  const row = db.prepare<[string], { json: string }>('SELECT json FROM pets WHERE id = ?').get(id);
  return JSON.parse(row?.json ?? 'null') as Record<string, unknown>;
}

describe('upgradePetsToRoles', () => {
  it.each([
    ['scout', 'generalist'],
    ['ink', 'writer'],
    ['bolt', 'backend-engineer'],
  ])('gives the default %s the %s role', (id, roleId) => {
    storeLegacy(id, { persona: LEGACY_DEFAULT_PERSONAS[id] });

    upgradePetsToRoles(db);

    const pet = stored(id);
    expect(pet.roleId).toBe(roleId);
    expect(pet).not.toHaveProperty('roleVersion');
    expect(pet.toolGrants).toEqual({});
  });

  it('drops a default pet persona the user never changed', () => {
    storeLegacy('ink', { persona: LEGACY_DEFAULT_PERSONAS.ink });

    upgradePetsToRoles(db);

    expect(stored('ink')).not.toHaveProperty('persona');
    expect(stored('ink')).not.toHaveProperty('notes');
  });

  it('keeps an edited default pet persona as notes', () => {
    storeLegacy('scout', { persona: 'Answer only in haiku.' });

    upgradePetsToRoles(db);

    expect(stored('scout').notes).toBe('Answer only in haiku.');
    expect(stored('scout')).not.toHaveProperty('persona');
  });

  it('makes a user-created pet a generalist and keeps its persona as notes', () => {
    storeLegacy('pip', { persona: 'You are Pip.' });

    upgradePetsToRoles(db);

    const pet = stored('pip');
    expect(pet.roleId).toBe('generalist');
    expect(pet.notes).toBe('You are Pip.');
  });

  it('keeps a default pet persona as notes when it sits under another id', () => {
    storeLegacy('scout-2', { persona: LEGACY_DEFAULT_PERSONAS.scout });

    upgradePetsToRoles(db);

    expect(stored('scout-2').notes).toBe(LEGACY_DEFAULT_PERSONAS.scout);
  });

  it('leaves no notes for a blank or missing persona', () => {
    storeLegacy('blank', { persona: '   ' });
    storeLegacy('none');

    upgradePetsToRoles(db);

    expect(stored('blank')).not.toHaveProperty('notes');
    expect(stored('none')).not.toHaveProperty('notes');
  });

  it('removes the allowlist, which nothing ever read', () => {
    storeLegacy('pip', { toolAllowlist: ['notion__search'] });

    upgradePetsToRoles(db);

    expect(stored('pip')).not.toHaveProperty('toolAllowlist');
  });

  it('keeps every other field', () => {
    storeLegacy('scout', { persona: '', color: '#0ea5e9', visionModel: 'vl', voiceId: 'v' });

    upgradePetsToRoles(db);

    expect(stored('scout')).toMatchObject({
      id: 'scout',
      color: '#0ea5e9',
      visionModel: 'vl',
      voiceId: 'v',
      model: 'm',
      providerId: 'fake',
    });
  });

  it('leaves a pet that already has a role untouched', () => {
    storeLegacy('bolt', { roleId: 'writer', roleVersion: 1, persona: 'Kept as is.' });
    const before = stored('bolt');

    upgradePetsToRoles(db);

    expect(stored('bolt')).toEqual(before);
  });
});
