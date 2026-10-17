/**
 * Scout's long-term memory: facts, preferences and summaries in SQLite with full-text search
 * (MemoryStore, ftsQuery).
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/** What a memory is: something true, something the user likes, or a digest of a thread. */
export type MemoryKind = 'fact' | 'preference' | 'summary';

export interface Memory {
  id: string;
  /** The pet the memory belongs to: Scout. */
  petId: string;
  kind: MemoryKind;
  text: string;
  createdAt: string;
}

export interface NewMemory {
  petId: string;
  kind: MemoryKind;
  text: string;
}

interface MemoryRow {
  id: string;
  pet_id: string;
  kind: MemoryKind;
  text: string;
  created_at: string;
}

/** The rows one pet may see: its own. */
const VISIBLE = 'm.pet_id = ?';

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
 * Scout's memories, with full-text search. Each row is filed under its pet, and every read
 * filters on that pet in SQL. The `scope` column from migration 3 is always `'pet'` now.
 */
export class MemoryStore {
  constructor(private readonly db: Database.Database) {}

  add(input: NewMemory): Memory {
    const text = input.text.trim();
    if (text.length === 0) throw new Error('a memory needs some text');
    const row: MemoryRow = {
      id: randomUUID(),
      pet_id: input.petId,
      kind: input.kind,
      text,
      created_at: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO memories (id, scope, pet_id, kind, text, created_at) VALUES (?, 'pet', ?, ?, ?, ?)",
      )
      .run(row.id, row.pet_id, row.kind, row.text, row.created_at);
    return toMemory(row);
  }

  /**
   * Adds a memory unless the pet already holds an identical one, and returns
   * whichever is stored. Saying "I prefer short answers" every morning should not fill
   * five recall slots with the same sentence.
   */
  addOnce(input: NewMemory): Memory {
    const text = input.text.trim();
    const existing = this.db
      .prepare<[string, string], MemoryRow>(
        'SELECT * FROM memories WHERE text = ? AND pet_id = ? LIMIT 1',
      )
      .get(text, input.petId);
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

  /**
   * One pet's memories for Home, newest first. `before` is the `next` of the page before; an
   * unknown cursor gives an empty page rather than starting over.
   */
  list(
    petId: string,
    params: { before?: string | undefined; limit: number },
  ): { memories: Memory[]; next?: string } {
    const cursor =
      params.before === undefined
        ? Number.MAX_SAFE_INTEGER
        : (this.db
            .prepare<[string], { rowid: number }>('SELECT rowid FROM memories WHERE id = ?')
            .get(params.before)?.rowid ?? 0);
    const rows = this.db
      .prepare<[string, number, number], MemoryRow>(
        `SELECT m.* FROM memories m WHERE ${VISIBLE} AND m.rowid < ? ORDER BY m.rowid DESC LIMIT ?`,
      )
      .all(petId, cursor, params.limit + 1);
    const memories = rows.slice(0, params.limit).map(toMemory);
    const last = memories.at(-1);
    return rows.length > params.limit && last !== undefined
      ? { memories, next: last.id }
      : { memories };
  }

  /**
   * One pet's memories whose id starts with `prefix`, at most two: one is a match, two say
   * the prefix is too short. Compared as plain text, so `%` and `_` are not wildcards.
   */
  byPrefix(petId: string, prefix: string): Memory[] {
    if (prefix.length === 0) return [];
    return this.db
      .prepare<[string, number, string], MemoryRow>(
        `SELECT m.* FROM memories m WHERE ${VISIBLE} AND substr(m.id, 1, ?) = ? LIMIT 2`,
      )
      .all(petId, prefix.length, prefix)
      .map(toMemory);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
  }
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    petId: row.pet_id,
    kind: row.kind,
    text: row.text,
    createdAt: row.created_at,
  };
}
