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

    expect(memories.delete('scout', memory.id)).toBe(true);
    expect(memories.search('scout', 'walrus', 5)).toEqual([]);
    expect(memories.recent('scout', 5)).toEqual([]);
    db.exec("INSERT INTO memories_fts (memories_fts) VALUES ('integrity-check')");
  });

  it('deletes only a memory of the pet that asks', () => {
    const theirs = memories.add({ petId: 'pip', kind: 'fact', text: 'Pip’s walrus' });

    expect(memories.delete('scout', theirs.id)).toBe(false);
    expect(memories.search('pip', 'walrus', 5)).toHaveLength(1);
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

describe('MemoryStore.list', () => {
  it('pages one pet’s memories newest first, continued by next', () => {
    for (const text of ['one', 'two', 'three'])
      memories.add({ petId: 'scout', kind: 'fact', text });
    memories.add({ petId: 'pip', kind: 'fact', text: 'not yours' });

    const first = memories.list('scout', { limit: 2 });
    expect(first.memories.map((m) => m.text)).toEqual(['three', 'two']);
    expect(first.next).toBe(first.memories[1]!.id);

    const second = memories.list('scout', { before: first.next, limit: 2 });
    expect(second.memories.map((m) => m.text)).toEqual(['one']);
    expect(second.next).toBeUndefined();
  });

  it('gives an empty page for an unknown cursor, never the newest again', () => {
    memories.add({ petId: 'scout', kind: 'fact', text: 'one' });
    expect(memories.list('scout', { before: 'gone', limit: 5 }).memories).toEqual([]);
  });
});

describe('MemoryStore.byPrefix', () => {
  it('finds one pet’s memories whose id starts with the prefix, at most two', () => {
    const tea = memories.add({ petId: 'scout', kind: 'preference', text: 'Tea' });
    memories.add({ petId: 'pip', kind: 'fact', text: 'Pip’s' });

    expect(memories.byPrefix('scout', tea.id.slice(0, 6)).map((m) => m.text)).toEqual(['Tea']);
    expect(memories.byPrefix('scout', tea.id)).toHaveLength(1);
    expect(memories.byPrefix('scout', 'zzzz')).toEqual([]);
    expect(memories.byPrefix('scout', '')).toEqual([]);
    for (let i = 0; i < 4; i += 1) memories.add({ petId: 'scout', kind: 'fact', text: `f${i}` });
    // LIKE wildcards are plain characters here, so they match no uuid.
    expect(memories.byPrefix('scout', '%')).toEqual([]);
    expect(memories.byPrefix('scout', '_')).toEqual([]);
  });
});

describe('MemoryStore for the digest', () => {
  it('reads the newest of some kinds only', () => {
    memories.add({ petId: 'scout', kind: 'preference', text: 'Short answers' });
    memories.add({ petId: 'scout', kind: 'fact', text: 'Uses pnpm' });
    memories.add({ petId: 'scout', kind: 'summary', text: 'Talked about the build' });
    memories.add({ petId: 'ink', kind: 'preference', text: 'Not mine' });

    expect(memories.recent('scout', 10, ['preference']).map((m) => m.text)).toEqual([
      'Short answers',
    ]);
    expect(memories.recent('scout', 10, ['fact', 'summary']).map((m) => m.text)).toEqual([
      'Talked about the build',
      'Uses pnpm',
    ]);
    expect(memories.count('scout', 'summary')).toBe(1);
    expect(memories.count('scout', 'preference')).toBe(1);
  });

  it("changes one of the pet's own memories, and the search follows", () => {
    const fact = memories.add({ petId: 'scout', kind: 'fact', text: 'Works on giraffes' });

    expect(memories.update('ink', fact.id, 'Hijacked')).toBe(false);
    expect(memories.update('scout', fact.id, '  Works on otters  ')).toBe(true);

    expect(memories.recent('scout', 1)[0]?.text).toBe('Works on otters');
    expect(memories.search('scout', 'otters', 5)).toHaveLength(1);
    expect(memories.search('scout', 'giraffes', 5)).toEqual([]);
    expect(memories.update('scout', fact.id, '   ')).toBe(false);
  });

  it("keeps who wrote a memory: the user's by default, or the digest's", () => {
    const told = memories.add({ petId: 'scout', kind: 'fact', text: 'Lives in Leeds' });
    const tidied = memories.add({
      petId: 'scout',
      kind: 'fact',
      text: 'Ships on Fridays',
      origin: 'digest',
    });

    expect(told.origin).toBe('user');
    expect(tidied.origin).toBe('digest');
    expect(memories.search('scout', 'fridays', 5)[0]?.origin).toBe('digest');
  });

  it("a reworded memory takes the rewriter's origin, and the search still finds it", () => {
    const fact = memories.add({ petId: 'scout', kind: 'preference', text: 'Short answers' });

    expect(memories.update('scout', fact.id, 'Very short answers', 'digest')).toBe(true);
    expect(memories.search('scout', 'very short', 5)[0]).toMatchObject({
      text: 'Very short answers',
      origin: 'digest',
    });

    expect(memories.update('scout', fact.id, 'Short answers again')).toBe(true);
    expect(memories.recent('scout', 1)[0]?.origin).toBe('user');
  });

  it('does not let the digest launder a memory the user already holds', () => {
    const mine = memories.add({ petId: 'scout', kind: 'fact', text: 'Uses pnpm' });

    const again = memories.addOnce({
      petId: 'scout',
      kind: 'fact',
      text: 'Uses pnpm',
      origin: 'digest',
    });

    expect(again).toMatchObject({ id: mine.id, origin: 'user' });
    expect(memories.count('scout', 'fact')).toBe(1);
  });

  it('makes a memory the user’s when they say what the digest wrote themselves', () => {
    const tidied = memories.add({
      petId: 'scout',
      kind: 'preference',
      text: 'Short answers',
      origin: 'digest',
    });

    const said = memories.addOnce({ petId: 'scout', kind: 'preference', text: 'Short answers' });

    expect(said).toMatchObject({ id: tidied.id, origin: 'user' });
    expect(memories.recent('scout', 1)[0]?.origin).toBe('user');
    expect(memories.count('scout', 'preference')).toBe(1);
  });

  it('evicts the oldest summaries beyond a cap, never another kind', () => {
    for (let i = 0; i < 5; i += 1) {
      memories.add({ petId: 'scout', kind: 'summary', text: `summary ${i}` });
    }
    memories.add({ petId: 'scout', kind: 'fact', text: 'A fact' });
    memories.add({ petId: 'ink', kind: 'summary', text: 'Ink summary' });

    expect(memories.evictSummaries('scout', 3)).toBe(2);

    expect(memories.recent('scout', 10, ['summary']).map((m) => m.text)).toEqual([
      'summary 4',
      'summary 3',
      'summary 2',
    ]);
    expect(memories.count('scout', 'fact')).toBe(1);
    expect(memories.count('ink', 'summary')).toBe(1);
    expect(memories.search('scout', 'summary 0', 10).map((m) => m.text)).not.toContain('summary 0');
    expect(memories.evictSummaries('scout', 3)).toBe(0);
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
