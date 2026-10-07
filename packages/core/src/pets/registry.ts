import type { Database } from 'better-sqlite3';
import { Pet } from '@tagalong/protocol';
import { NEMOTRON_TEXT_MODEL, NEMOTRON_VISION_MODEL } from '../providers/nebius-models';
import { getRole } from '../roles';

/** The library version of a role a default pet ships with. */
function roleVersion(roleId: string): number {
  const role = getRole(roleId);
  if (role === undefined) throw new Error(`no role "${roleId}" in the role library`);
  return role.version;
}

/**
 * The explainer, and the pet a fresh install opens on.
 *
 * Scout runs on NVIDIA Nemotron through Nebius Token Factory: Nemotron 3 Super for words,
 * switching to Nemotron Nano 2 VL whenever a turn carries a picture, since Super cannot
 * see. Claude stays one Settings change away. Only a fresh install gets this; seeding never
 * overwrites a pet that already exists, so an install that started on Claude stays there.
 */
export const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  color: '#0ea5e9',
  roleId: 'generalist',
  roleVersion: roleVersion('generalist'),
  model: NEMOTRON_TEXT_MODEL,
  visionModel: NEMOTRON_VISION_MODEL,
  providerId: 'nebius',
  toolGrants: {},
  replyStyle: 'text',
};

/** OpenRouter's id for the Claude model Ink starts on. Any OpenRouter model id works. */
export const INK_MODEL = 'anthropic/claude-sonnet-5';

/**
 * The writer. Ink runs on Claude through OpenRouter so a fresh crew already spans two
 * providers and three models — the point of a crew whose members think differently.
 * Claude sees images itself, so Ink needs no separate vision model.
 */
export const INK: Pet = {
  id: 'ink',
  name: 'Ink',
  avatar: '✒️',
  color: '#a855f7',
  roleId: 'writer',
  roleVersion: roleVersion('writer'),
  model: INK_MODEL,
  providerId: 'openrouter',
  toolGrants: {},
  replyStyle: 'text',
};

/**
 * The coder. Bolt runs on Nemotron Nano 2 VL through Token Factory: a smaller, faster
 * Nemotron that also reads screenshots, which is most of what reading an error is.
 */
export const BOLT: Pet = {
  id: 'bolt',
  name: 'Bolt',
  avatar: '⚡',
  color: '#f59e0b',
  roleId: 'backend-engineer',
  roleVersion: roleVersion('backend-engineer'),
  model: NEMOTRON_VISION_MODEL,
  providerId: 'nebius',
  toolGrants: {},
  replyStyle: 'text',
};

/** The crew a fresh install starts with, in the order the strip shows them. */
export const DEFAULT_CREW: readonly Pet[] = [SCOUT, INK, BOLT];

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
   * a pet the user has edited survives every later boot, and a default the user deleted
   * stays deleted: `pet_seeds` remembers it was offered once.
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
      for (const pet of DEFAULT_CREW) {
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
