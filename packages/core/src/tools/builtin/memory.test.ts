/** Tests for the remember tool: it files under the calling pet, ignores `shared`, and checks its input. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../memory/db';
import { MemoryStore } from '../../memory/memories';
import { fakeTurnTools } from '../fake-turn';
import { REMEMBER } from './memory';

let db: Database.Database;
let memories: MemoryStore;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  memories = new MemoryStore(db);
});

afterEach(() => {
  db.close();
});

const run = (input: unknown) => fakeTurnTools({ memory: memories }).run({ name: REMEMBER, input });

describe('remember', () => {
  it('files the memory under the pet that asked', async () => {
    const outcome = await run({ text: 'Prefers tea', kind: 'preference' });

    expect(outcome.content).toBe('Saved to your memory.');
    expect(memories.recent('scout', 5)).toMatchObject([
      { petId: 'scout', kind: 'preference', text: 'Prefers tea' },
    ]);
  });

  it('ignores a stale shared flag and still files it under the pet', async () => {
    const outcome = await run({ text: 'The repo uses pnpm', shared: true });

    expect(outcome.content).toBe('Saved to your memory.');
    expect(memories.recent('scout', 5)).toMatchObject([{ petId: 'scout', kind: 'fact' }]);
  });

  it('offers the model no shared option', () => {
    const turn = fakeTurnTools({ memory: memories });
    const definition = turn.definitions.find((d) => d.name === REMEMBER);
    expect(JSON.stringify(definition)).not.toMatch(/shared|crew/i);
  });

  it('saves nothing without text', async () => {
    const outcome = await run({ text: '  ' });

    expect(outcome.isError).toBe(true);
    expect(memories.recent('scout', 5)).toEqual([]);
  });
});
