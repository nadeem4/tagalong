import type { Database } from 'better-sqlite3';
import { Pet } from '@tagalong/protocol';
import { NEMOTRON_TEXT_MODEL, NEMOTRON_VISION_MODEL } from '../providers/nebius-models';

/**
 * The pet a fresh install starts with.
 *
 * Phase 1 ships one companion so the whole path can be exercised end to end; Ink and
 * Bolt join the crew in Phase 4 when handoff and roundtable give them something to do.
 * Scout runs on NVIDIA Nemotron through Nebius Token Factory: Nemotron 3 Super for words,
 * switching to Nemotron Nano 2 VL whenever a turn carries a picture, since Super cannot
 * see. Claude stays one Settings change away. Only a fresh install gets this; seeding never
 * overwrites a pet that already exists, so an install that started on Claude stays there.
 */
export const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  persona:
    'You are Scout. You explain what the user is looking at, plainly and briefly. ' +
    'Prefer a direct answer over a preamble. When something on screen is ambiguous, ' +
    'say what you see and ask one short question rather than guessing.',
  model: NEMOTRON_TEXT_MODEL,
  visionModel: NEMOTRON_VISION_MODEL,
  providerId: 'nebius',
  toolAllowlist: [],
  replyStyle: 'text',
};

const DEFAULT_CREW: readonly Pet[] = [SCOUT];

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
   * Inserts missing default pets. Existing rows are left alone, so a pet the user has
   * edited survives every later boot.
   */
  seedDefaults(): void {
    const insert = this.#db.prepare(
      'INSERT OR IGNORE INTO pets (id, json, updated_at) VALUES (?, ?, ?)',
    );
    const now = new Date().toISOString();
    this.#db.transaction(() => {
      for (const pet of DEFAULT_CREW) insert.run(pet.id, JSON.stringify(pet), now);
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

  /** Returns whether a row actually went, so pets.delete can answer honestly. */
  delete(id: string): boolean {
    return this.#db.prepare('DELETE FROM pets WHERE id = ?').run(id).changes > 0;
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
