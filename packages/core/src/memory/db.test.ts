import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { rolesUpgradeNotice } from '../pets/roles-notice';
import { DB_FILENAME, LATEST_SCHEMA_VERSION, migrate, openDatabase } from './db';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-db-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
    .sort();
}

describe('openDatabase', () => {
  it('creates the database file inside the data dir', () => {
    const db = openDatabase(dataDir);
    try {
      expect(existsSync(join(dataDir, DB_FILENAME))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('migrates a fresh database to the latest version', () => {
    const db = openDatabase(dataDir);
    try {
      expect(tableNames(db)).toEqual([
        'activity',
        'conversations',
        'expert_routes',
        'experts',
        'memories',
        'memories_fts',
        'memories_fts_config',
        'memories_fts_data',
        'memories_fts_docsize',
        'memories_fts_idx',
        'messages',
        'notices',
        'pet_seeds',
        'pets',
        'schema_version',
      ]);
      const row = db
        .prepare<[], { version: number }>('SELECT MAX(version) AS version FROM schema_version')
        .get();
      expect(row?.version).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('indexes messages by conversation and time', () => {
    const db = openDatabase(dataDir);
    try {
      const index = db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'messages_conv'",
        )
        .get();
      expect(index?.name).toBe('messages_conv');
    } finally {
      db.close();
    }
  });
});

describe('migrate', () => {
  it('is a no-op when rerun on an already migrated database', () => {
    const db = new Database(':memory:');
    try {
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
      db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
        'scout',
        '{}',
        '2026-09-11T00:00:00.000Z',
      );

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      const pets = db.prepare<[], { id: string }>('SELECT id FROM pets').all();
      expect(pets).toHaveLength(1);
      const applied = db
        .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_version')
        .get();
      expect(applied?.n).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('gives pets stored before roles a role in migration 5', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      // Roll the record back to version 4, as an install from before roles would be.
      db.prepare('DELETE FROM schema_version WHERE version >= 5').run();
      db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
        'pip',
        JSON.stringify({ id: 'pip', persona: 'You are Pip.', toolAllowlist: [] }),
        '2026-09-11T00:00:00.000Z',
      );

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      const row = db.prepare<[], { json: string }>("SELECT json FROM pets WHERE id = 'pip'").get();
      expect(JSON.parse(row?.json ?? '{}')).toMatchObject({
        roleId: 'generalist',
        notes: 'You are Pip.',
      });
      // Migration 6 runs right after and records what 5 did, for the one-time notice.
      expect(rolesUpgradeNotice(db)?.pets.map((pet) => pet.petId)).toEqual(['pip']);
    } finally {
      db.close();
    }
  });

  it('records no roles notice on a fresh database', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      expect(rolesUpgradeNotice(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('survives reopening the same file', () => {
    openDatabase(dataDir).close();
    const db = openDatabase(dataDir);
    try {
      const applied = db
        .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_version')
        .get();
      expect(applied?.n).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});
