import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../memory/db';
import { getRole } from '../roles';
import { DEFAULT_CREW, PetRegistry, SCOUT } from './registry';

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

  it('starts Scout as the Companion, thinking on the Claude Code sign-in', () => {
    expect(DEFAULT_CREW).toEqual([SCOUT]);
    expect(SCOUT).toMatchObject({
      roleId: 'companion',
      roleVersion: getRole('companion')?.version,
      providerId: 'claude-code',
      model: 'haiku',
      toolGrants: {},
    });
    expect(SCOUT.visionModel).toBeUndefined();
    expect(SCOUT.notes).toBeUndefined();
  });

  it('does not bring back a default pet the user deleted', () => {
    const registry = new PetRegistry(db);
    registry.seedDefaults();
    registry.delete('scout');

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

    expect(registry.list()).toHaveLength(1);
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
    expect(registry.list().map((pet) => pet.id)).toEqual([]);
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
