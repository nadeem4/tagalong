import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/** Private to one pet, or shared by the whole crew. */
export type MemoryScope = 'pet' | 'crew';

/** What a memory is: something true, something the user likes, or a digest of a thread. */
export type MemoryKind = 'fact' | 'preference' | 'summary';

export interface Memory {
  id: string;
  scope: MemoryScope;
  /** Set exactly when `scope` is `'pet'`. */
  petId: string | null;
  kind: MemoryKind;
  text: string;
  createdAt: string;
}

export interface NewMemory {
  scope: MemoryScope;
  petId?: string | undefined;
  kind: MemoryKind;
  text: string;
}

interface MemoryRow {
  id: string;
  scope: MemoryScope;
  pet_id: string | null;
  kind: MemoryKind;
  text: string;
  created_at: string;
}

/** The rows one pet may see: its own private memories and everything the crew shares. */
const VISIBLE = "(m.scope = 'crew' OR m.pet_id = ?)";

/** More words than this in one question add noise to the match, not recall. */
const MAX_QUERY_WORDS = 16;

/**
 * Turns free text into an FTS5 query that cannot fail to parse.
 *
 * A user's question is full of characters FTS5 treats as syntax — quotes, `*`, `-`,
 * `NEAR(`, a bare `AND` — and passing it through raw throws on the first apostrophe. Each
 * distinct word is quoted and the words are OR-ed, so any shared word is a match and the
 * BM25 rank decides which memory is closest. Returns null when no word survives.
 */
export function ftsQuery(text: string): string | null {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    if (word.length < 2) continue;
    words.add(word);
    if (words.size >= MAX_QUERY_WORDS) break;
  }
  return words.size === 0 ? null : [...words].map((word) => `"${word}"`).join(' OR ');
}

/**
 * The crew's memory: private notes per pet plus a shared notebook, with full-text search.
 *
 * Visibility is enforced in SQL on every read rather than filtered afterwards, so there is
 * no code path that loads another pet's private memories and forgets to drop them.
 */
export class MemoryStore {
  constructor(private readonly db: Database.Database) {}

  add(input: NewMemory): Memory {
    const text = input.text.trim();
    if (text.length === 0) throw new Error('a memory needs some text');
    if (input.scope === 'pet' && input.petId === undefined) {
      throw new Error('a private memory needs the pet it belongs to');
    }
    if (input.scope === 'crew' && input.petId !== undefined) {
      throw new Error('a shared memory belongs to the crew, not to one pet');
    }
    const row: MemoryRow = {
      id: randomUUID(),
      scope: input.scope,
      pet_id: input.scope === 'pet' ? (input.petId ?? null) : null,
      kind: input.kind,
      text,
      created_at: new Date().toISOString(),
    };
    this.db
      .prepare(
        'INSERT INTO memories (id, scope, pet_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.scope, row.pet_id, row.kind, row.text, row.created_at);
    return toMemory(row);
  }

  /**
   * Adds a memory unless an identical one already sits in the same place, and returns
   * whichever is stored. Saying "I prefer short answers" every morning should not fill
   * five recall slots with the same sentence.
   */
  addOnce(input: NewMemory): Memory {
    const text = input.text.trim();
    const existing = this.db
      .prepare<[string, string, string | null, string | null], MemoryRow>(
        `SELECT * FROM memories WHERE text = ? AND scope = ? AND (pet_id = ? OR (pet_id IS NULL AND ? IS NULL))
         LIMIT 1`,
      )
      .get(text, input.scope, input.petId ?? null, input.petId ?? null);
    return existing === undefined ? this.add(input) : toMemory(existing);
  }

  /** The newest memories one pet can see, newest first. */
  recent(petId: string, limit: number): Memory[] {
    return this.db
      .prepare<[string, number], MemoryRow>(
        `SELECT m.* FROM memories m WHERE ${VISIBLE} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
      )
      .all(petId, limit)
      .map(toMemory);
  }

  /** The memories one pet can see that share words with `text`, best match first. */
  search(petId: string, text: string, limit: number): Memory[] {
    const query = ftsQuery(text);
    if (query === null) return [];
    return this.db
      .prepare<[string, string, number], MemoryRow>(
        `SELECT m.* FROM memories_fts f JOIN memories m ON m.rowid = f.rowid
         WHERE memories_fts MATCH ? AND ${VISIBLE}
         ORDER BY bm25(memories_fts), m.created_at DESC LIMIT ?`,
      )
      .all(query, petId, limit)
      .map(toMemory);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
  }
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    scope: row.scope,
    petId: row.pet_id,
    kind: row.kind,
    text: row.text,
    createdAt: row.created_at,
  };
}
