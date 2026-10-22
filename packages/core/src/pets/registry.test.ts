/** Tests for PetRegistry: seeding once, CRUD, older rows and schema errors. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../memory/db';
import { DEFAULT_PETS, PetRegistry, SCOUT } from './registry';
import { recommendedModel, roleFor } from '../roles';

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-pets-'));
  db = openDatabase(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('PetRegistry seeding', () => {
  it('seeds Scout alone on an empty database', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();

    expect(registry.list().map((pet) => pet.id)).toEqual(['scout']);
  });

  it('starts Scout as the Companion, thinking on the Claude Code sign-in at its role tier', () => {
    expect(DEFAULT_PETS).toEqual([SCOUT]);
    expect(SCOUT).toMatchObject({
      roleId: 'companion',
      providerId: 'claude-code',
      model: recommendedModel(roleFor('companion'), 'claude-code')?.model,
    });
  });

  it('does not bring back a default pet that was removed', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    db.prepare("DELETE FROM pets WHERE id = 'scout'").run();

    registry.seedDefaults();

    expect(registry.get('scout')).toBeNull();
  });

  it('is a no-op on second boot', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.seedDefaults();

    expect(registry.list()).toHaveLength(1);
  });

  it('does not overwrite a pet the user edited', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.upsert({ ...SCOUT, model: 'sonnet' });

    registry.seedDefaults();

    expect(registry.get('scout')?.model).toBe('sonnet');
  });
});

describe('PetRegistry CRUD', () => {
  it('round-trips a pet through upsert and get', () => {
    const registry = new PetRegistry(db);
    const bolt = {
      id: 'bolt',
      name: 'Bolt',
      avatar: '⚡',
      model: 'claude-opus-5',
      providerId: 'anthropic',
      roleId: 'companion',
    };

    const saved = registry.upsert(bolt);

    expect(saved).toEqual(bolt);
    expect(registry.get('bolt')).toEqual(bolt);
  });

  it('updates an existing pet rather than duplicating it', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.upsert({ ...SCOUT, name: 'Scouty' });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get('scout')?.name).toBe('Scouty');
  });

  it('returns null for a pet that does not exist', () => {
    expect(new PetRegistry(db).get('nobody')).toBeNull();
  });

  it('loads a crew-era pet row, dropping its role version and voice id', () => {
    db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
      'scout',
      JSON.stringify({ ...SCOUT, roleVersion: 1, voiceId: 'fox' }),
      '2026-10-01T00:00:00.000Z',
    );

    const scout = new PetRegistry(db).get('scout');

    expect(scout).toEqual(SCOUT);
    expect(scout).not.toHaveProperty('roleVersion');
  });

  it('lists pets in a stable order', () => {
    const registry = new PetRegistry(db);
    const base = {
      avatar: '*',
      model: 'claude-opus-5',
      providerId: 'anthropic',
      roleId: 'companion',
    };
    registry.upsert({ ...base, id: 'zed', name: 'Zed' });
    registry.upsert({ ...base, id: 'abe', name: 'Abe' });

    expect(registry.list().map((p) => p.id)).toEqual(['abe', 'zed']);
  });

  it('rejects a stored row that no longer matches the Pet schema', () => {
    db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
      'broken',
      JSON.stringify({ id: 'broken' }),
      new Date().toISOString(),
    );

    expect(() => new PetRegistry(db).list()).toThrow(/broken/);
  });
});
