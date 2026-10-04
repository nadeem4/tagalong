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
  it('stores a private memory for one pet and a shared one for the crew', () => {
    const mine = memories.add({
      scope: 'pet',
      petId: 'scout',
      kind: 'preference',
      text: 'Prefers short answers',
    });
    const shared = memories.add({ scope: 'crew', kind: 'fact', text: 'The project is Tagalong' });

    expect(mine).toMatchObject({ scope: 'pet', petId: 'scout', kind: 'preference' });
    expect(shared).toMatchObject({ scope: 'crew', petId: null, kind: 'fact' });
    expect(memories.recent('scout', 10).map((m) => m.text)).toEqual([
      'The project is Tagalong',
      'Prefers short answers',
    ]);
  });

  it('never lets a pet read another pet’s private memories', () => {
    memories.add({ scope: 'pet', petId: 'scout', kind: 'fact', text: 'Scout secret about zebras' });
    memories.add({ scope: 'crew', kind: 'fact', text: 'Shared note about zebras' });

    expect(memories.recent('ink', 10).map((m) => m.text)).toEqual(['Shared note about zebras']);
    expect(memories.search('ink', 'zebras', 10).map((m) => m.text)).toEqual([
      'Shared note about zebras',
    ]);
    expect(memories.search('scout', 'zebras', 10)).toHaveLength(2);
  });

  it('searches with full-text matching and ranks the closer match first', () => {
    memories.add({ scope: 'pet', petId: 'bolt', kind: 'fact', text: 'Uses pnpm workspaces' });
    memories.add({
      scope: 'pet',
      petId: 'bolt',
      kind: 'fact',
      text: 'The build uses vitest and vitest projects for vitest runs',
    });
    memories.add({ scope: 'pet', petId: 'bolt', kind: 'fact', text: 'Likes dark mode' });

    const found = memories.search('bolt', 'how do I run vitest?', 10).map((m) => m.text);

    expect(found).toEqual(['The build uses vitest and vitest projects for vitest runs']);
  });

  it('stems words, so "answers" finds "answer"', () => {
    memories.add({ scope: 'pet', petId: 'scout', kind: 'preference', text: 'Short answer please' });

    expect(memories.search('scout', 'answers', 5)).toHaveLength(1);
  });

  it('treats punctuation and FTS syntax in a question as plain words', () => {
    memories.add({ scope: 'crew', kind: 'fact', text: 'Deploys on Fridays' });

    expect(() => memories.search('scout', 'NEAR( "deploys" OR * ) AND -', 5)).not.toThrow();
    expect(memories.search('scout', 'NEAR( "deploys" OR * ) AND -', 5)).toHaveLength(1);
    expect(memories.search('scout', '?!', 5)).toEqual([]);
  });

  it('caps recent and search results at the limit, newest first', () => {
    for (let i = 0; i < 7; i += 1) {
      memories.add({ scope: 'pet', petId: 'scout', kind: 'fact', text: `note ${i} about cats` });
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
    const memory = memories.add({ scope: 'crew', kind: 'fact', text: 'Temporary walrus' });

    expect(memories.delete(memory.id)).toBe(true);
    expect(memories.search('scout', 'walrus', 5)).toEqual([]);
    expect(memories.recent('scout', 5)).toEqual([]);
  });

  it('refuses a private memory without a pet, and a shared one with a pet', () => {
    expect(() => memories.add({ scope: 'pet', kind: 'fact', text: 'orphan' })).toThrow();
    expect(() =>
      memories.add({ scope: 'crew', petId: 'scout', kind: 'fact', text: 'confused' }),
    ).toThrow();
  });

  it('refuses an empty memory', () => {
    expect(() => memories.add({ scope: 'crew', kind: 'fact', text: '   ' })).toThrow();
  });

  it('survives reopening the database', () => {
    memories.add({ scope: 'pet', petId: 'scout', kind: 'preference', text: 'Keep it short' });
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
