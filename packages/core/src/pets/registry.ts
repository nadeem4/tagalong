import type { Database } from 'better-sqlite3';
import { Pet } from '@tagalong/protocol';

/**
 * The companion, and the only pet a fresh install has. Scout sees what you are doing,
 * writes a brief and hands it to the right expert; it thinks through the person's own
 * Claude Code sign-in on the fast model, so a fresh install needs no key. Welcome moves it
 * to a keyed provider when Claude Code is not installed. Seeding never overwrites a pet
 * that already exists.
 */
export const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
  color: '#E8873A',
  roleId: 'companion',
  model: 'haiku',
  providerId: 'claude-code',
  toolGrants: {},
  replyStyle: 'text',
};

/** What a fresh install starts with: one companion. */
export const DEFAULT_PETS: readonly Pet[] = [SCOUT];

interface PetRow {
  readonly id: string;
  readonly json: string;
}

/**
 * Pets live in SQLite as validated JSON blobs rather than columns, because a pet is
 * pure configuration whose shape grows every phase; migrating a JSON document beats
 * migrating a table each time a field appears.
 */
export class PetRegistry {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Inserts default pets that were never seeded before. Existing rows are left alone, so
   * a pet the user has edited survives every later boot, and a default that was removed
   * (Ink and Bolt, in migration 11) stays removed: `pet_seeds` remembers it was offered once.
   */
  seedDefaults(): void {
    const insert = this.#db.prepare(
      'INSERT OR IGNORE INTO pets (id, json, updated_at) VALUES (?, ?, ?)',
    );
    const record = this.#db.prepare(
      'INSERT OR IGNORE INTO pet_seeds (id, seeded_at) VALUES (?, ?)',
    );
    const seeded = new Set(
      this.#db
        .prepare<[], { id: string }>('SELECT id FROM pet_seeds')
        .all()
        .map((row) => row.id),
    );
    const now = new Date().toISOString();
    this.#db.transaction(() => {
      for (const pet of DEFAULT_PETS) {
        if (seeded.has(pet.id)) continue;
        insert.run(pet.id, JSON.stringify(pet), now);
        record.run(pet.id, now);
      }
    })();
  }

  list(): Pet[] {
    const rows = this.#db.prepare<[], PetRow>('SELECT id, json FROM pets ORDER BY id').all();
    return rows.map((row) => this.#parse(row));
  }

  get(id: string): Pet | null {
    const row = this.#db
      .prepare<[string], PetRow>('SELECT id, json FROM pets WHERE id = ?')
      .get(id);
    return row === undefined ? null : this.#parse(row);
  }

  upsert(pet: Pet): Pet {
    const validated = Pet.parse(pet);
    this.#db
      .prepare(
        `INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(validated.id, JSON.stringify(validated), new Date().toISOString());
    return validated;
  }

  /**
   * A row that no longer parses is a bug or a hand-edited database, not something to
   * skip quietly: a silently missing pet is far harder to diagnose than a loud error.
   */
  #parse(row: PetRow): Pet {
    const result = Pet.safeParse(JSON.parse(row.json));
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`stored pet "${row.id}" does not match the Pet schema: ${detail}`);
    }
    return result.data;
  }
}
