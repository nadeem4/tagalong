/** Tests for MemoryStore: add, visibility, search, dedupe and delete. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from './db';
import { MemoryStore, ftsQuery } from './memories';

let dir: string;
let db: Database;
let memories: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-memories-'));
  db = openDatabase(dir);
  memories = new MemoryStore(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('stores a memory under the pet it belongs to', () => {
    const mine = memories.add({
      petId: 'scout',
      kind: 'preference',
      text: 'Prefers short answers',
    });

    expect(mine).toMatchObject({
      petId: 'scout',
      kind: 'preference',
      text: 'Prefers short answers',
    });
    expect(mine).not.toHaveProperty('scope');
    expect(memories.recent('scout', 10).map((m) => m.text)).toEqual(['Prefers short answers']);
  });

  it('does not give one pet a memory filed under another', () => {
    memories.add({ petId: 'pip', kind: 'fact', text: 'Pip secret about zebras' });

    expect(memories.recent('scout', 10)).toEqual([]);
    expect(memories.search('scout', 'zebras', 10)).toEqual([]);
  });

  it('files an identical memory once', () => {
    const first = memories.addOnce({ petId: 'scout', kind: 'fact', text: 'Uses pnpm' });
    const again = memories.addOnce({ petId: 'scout', kind: 'fact', text: ' Uses pnpm ' });

    expect(again.id).toBe(first.id);
    expect(memories.recent('scout', 10)).toHaveLength(1);
  });

  it('searches with full-text matching and ranks the closer match first', () => {
    memories.add({ petId: 'bolt', kind: 'fact', text: 'Uses pnpm workspaces' });
    memories.add({
      petId: 'bolt',
      kind: 'fact',
      text: 'The build uses vitest and vitest projects for vitest runs',
    });
    memories.add({ petId: 'bolt', kind: 'fact', text: 'Likes dark mode' });

    const found = memories.search('bolt', 'how do I run vitest?', 10).map((m) => m.text);

    expect(found).toEqual(['The build uses vitest and vitest projects for vitest runs']);
  });

  it('stems words, so "answers" finds "answer"', () => {
    memories.add({ petId: 'scout', kind: 'preference', text: 'Short answer please' });

    expect(memories.search('scout', 'answers', 5)).toHaveLength(1);
  });

  it('treats punctuation and FTS syntax in a question as plain words', () => {
    memories.add({ petId: 'scout', kind: 'fact', text: 'Deploys on Fridays' });

    expect(() => memories.search('scout', 'NEAR( "deploys" OR * ) AND -', 5)).not.toThrow();
    expect(memories.search('scout', 'NEAR( "deploys" OR * ) AND -', 5)).toHaveLength(1);
    expect(memories.search('scout', '?!', 5)).toEqual([]);
  });

  it('caps recent and search results at the limit, newest first', () => {
    for (let i = 0; i < 7; i += 1) {
      memories.add({ petId: 'scout', kind: 'fact', text: `note ${i} about cats` });
    }

    expect(memories.recent('scout', 5).map((m) => m.text)).toEqual([
      'note 6 about cats',
      'note 5 about cats',
      'note 4 about cats',
      'note 3 about cats',
      'note 2 about cats',
    ]);
    expect(memories.search('scout', 'cats', 3)).toHaveLength(3);
  });

  it('forgets a deleted memory in both the table and the index', () => {
    const memory = memories.add({ petId: 'scout', kind: 'fact', text: 'Temporary walrus' });

    expect(memories.delete(memory.id)).toBe(true);
    expect(memories.search('scout', 'walrus', 5)).toEqual([]);
    expect(memories.recent('scout', 5)).toEqual([]);
  });

  it('refuses an empty memory', () => {
    expect(() => memories.add({ petId: 'scout', kind: 'fact', text: '   ' })).toThrow();
  });

  it('survives reopening the database', () => {
    memories.add({ petId: 'scout', kind: 'preference', text: 'Keep it short' });
    db.close();
    db = openDatabase(dir);

    expect(new MemoryStore(db).search('scout', 'short', 5)).toHaveLength(1);
  });
});

describe('ftsQuery', () => {
  it('quotes each distinct word and joins them with OR', () => {
    expect(ftsQuery('Explain the "build" error, the build!')).toBe(
      '"explain" OR "the" OR "build" OR "error"',
    );
  });

  it('drops single characters and returns null when nothing is left', () => {
    expect(ftsQuery('a ? !')).toBeNull();
  });
});
