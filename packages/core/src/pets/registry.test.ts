import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../memory/db';
import { NEMOTRON_TEXT_MODEL, NEMOTRON_VISION_MODEL } from '../providers';
import { getRole } from '../roles';
import { BOLT, DEFAULT_CREW, INK, PetRegistry, SCOUT } from './registry';

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
  it('seeds Scout, Ink and Bolt on an empty database', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();

    expect(registry.list().map((pet) => pet.id)).toEqual(['bolt', 'ink', 'scout']);
  });

  it('gives each of the default crew its own colour and a different brain', () => {
    expect(new Set(DEFAULT_CREW.map((pet) => pet.color)).size).toBe(3);
    expect(new Set(DEFAULT_CREW.map((pet) => `${pet.providerId}:${pet.model}`)).size).toBe(3);
  });

  it('puts Ink on Claude through OpenRouter and Bolt on Nemotron Nano', () => {
    expect(INK.providerId).toBe('openrouter');
    expect(INK.model).toMatch(/^anthropic\/claude/);
    expect(BOLT.providerId).toBe('nebius');
    expect(BOLT.model).toBe(NEMOTRON_VISION_MODEL);
  });

  it('adds Ink and Bolt to an install that only ever had Scout', () => {
    db.prepare('DELETE FROM pet_seeds').run();
    db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
      'scout',
      JSON.stringify({ ...SCOUT, notes: 'Kept.' }),
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO pet_seeds (id, seeded_at) VALUES (?, ?)').run(
      'scout',
      new Date().toISOString(),
    );

    const registry = new PetRegistry(db);
    registry.seedDefaults();

    expect(registry.list().map((pet) => pet.id)).toEqual(['bolt', 'ink', 'scout']);
    expect(registry.get('scout')?.notes).toBe('Kept.');
  });

  it('does not bring back a default pet the user deleted', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.delete('ink');

    registry.seedDefaults();

    expect(registry.get('ink')).toBeNull();
  });

  it('gives Scout, Ink and Bolt a role at its current version and no notes', () => {
    expect(DEFAULT_CREW.map((pet) => [pet.id, pet.roleId])).toEqual([
      ['scout', 'generalist'],
      ['ink', 'writer'],
      ['bolt', 'backend-engineer'],
    ]);
    for (const pet of DEFAULT_CREW) {
      expect(pet.roleVersion).toBe(getRole(pet.roleId)?.version);
      expect(pet.notes).toBeUndefined();
      expect(pet.toolGrants).toEqual({});
    }
  });

  it('starts Scout on Nemotron through Token Factory, with Nano VL for pictures', () => {
    expect(SCOUT.providerId).toBe('nebius');
    expect(SCOUT.model).toBe(NEMOTRON_TEXT_MODEL);
    expect(SCOUT.visionModel).toBe(NEMOTRON_VISION_MODEL);
  });

  it('is a no-op on second boot', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.seedDefaults();

    expect(registry.list()).toHaveLength(3);
  });

  it('does not overwrite a pet the user edited', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.upsert({ ...SCOUT, notes: 'Answer only in haiku.' });

    registry.seedDefaults();

    expect(registry.get('scout')?.notes).toBe('Answer only in haiku.');
  });
});

describe('PetRegistry CRUD', () => {
  it('round-trips a pet through upsert and get', () => {
    const registry = new PetRegistry(db);
    const bolt = {
      id: 'bolt',
      name: 'Bolt',
      avatar: '⚡',
      notes: 'You read code.',
      model: 'claude-opus-5',
      providerId: 'anthropic',
      roleId: 'generalist',
      roleVersion: 1,
      toolGrants: {},
      replyStyle: 'text' as const,
    };

    const saved = registry.upsert(bolt);

    expect(saved).toEqual(bolt);
    expect(registry.get('bolt')).toEqual(bolt);
  });

  it('updates an existing pet rather than duplicating it', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.upsert({ ...SCOUT, name: 'Scouty' });

    expect(registry.list()).toHaveLength(3);
    expect(registry.get('scout')?.name).toBe('Scouty');
  });

  it('returns null for a pet that does not exist', () => {
    expect(new PetRegistry(db).get('nobody')).toBeNull();
  });

  it('deletes a pet and reports whether anything went', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();

    expect(registry.delete('scout')).toBe(true);
    expect(registry.delete('scout')).toBe(false);
    expect(registry.list().map((pet) => pet.id)).toEqual(['bolt', 'ink']);
  });

  it('lists pets in a stable order', () => {
    const registry = new PetRegistry(db);
    const base = {
      avatar: '*',
      model: 'claude-opus-5',
      providerId: 'anthropic',
      roleId: 'generalist',
      roleVersion: 1,
      toolGrants: {},
      replyStyle: 'text' as const,
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
