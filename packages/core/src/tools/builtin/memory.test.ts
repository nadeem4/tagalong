/**
 * Tests for the remember tool (files under the calling pet, ignores `shared`, checks its
 * input) and the forget tool (lists by query, deletes by id, facts-only results).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../memory/db';
import { MemoryStore } from '../../memory/memories';
import { fakeTurnTools } from '../fake-turn';
import { FORGET, REMEMBER } from './memory';

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

/** A result is facts only: no sentence that tells the mind what to say or do. */
function expectFact(text: string): void {
  expect(text).not.toMatch(/(^|[.:!?]\s+)(Tell|Say|Ask|Do not|Don't|Never|Always|Use|Try)\b/);
}

const forget = (input: unknown, overrides = {}) =>
  fakeTurnTools({ memory: memories }, overrides).run({ name: FORGET, input });

describe('forget', () => {
  it('lists what matches a query, with ids, and deletes nothing', async () => {
    const tea = memories.add({ petId: 'scout', kind: 'preference', text: 'Prefers green tea' });
    memories.add({ petId: 'scout', kind: 'fact', text: 'Works on the Tagalong repo' });

    const outcome = await forget({ query: 'tea' });

    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain(`m-${tea.id.slice(0, 8)} (preference) Prefers green tea`);
    expect(outcome.content).not.toContain('Tagalong');
    expect(outcome.content).toContain('Nothing deleted');
    expectFact(outcome.content);
    expect(memories.recent('scout', 5)).toHaveLength(2);
  });

  it('lists at most five matches', async () => {
    for (let i = 0; i < 7; i += 1) memories.add({ petId: 'scout', kind: 'fact', text: `tea ${i}` });
    const outcome = await forget({ query: 'tea' });
    expect(outcome.content.match(/^- m-/gm)).toHaveLength(5);
  });

  it('says so when nothing matches', async () => {
    memories.add({ petId: 'scout', kind: 'fact', text: 'Uses pnpm' });
    const outcome = await forget({ query: 'zebras' });
    expect(outcome.content).toBe('No memory matches "zebras". Nothing deleted.');
    expectFact(outcome.content);
  });

  it('deletes one memory by its short id, or its whole id, for good', async () => {
    const tea = memories.add({ petId: 'scout', kind: 'preference', text: 'Prefers green tea' });
    const pnpm = memories.add({ petId: 'scout', kind: 'fact', text: 'Uses pnpm' });

    const outcome = await forget({ id: `m-${tea.id.slice(0, 8)}` });
    expect(outcome).toEqual({ content: 'Deleted: "Prefers green tea".' });
    expect((await forget({ id: pnpm.id })).content).toBe('Deleted: "Uses pnpm".');

    expect(memories.recent('scout', 5)).toEqual([]);
    expect(memories.search('scout', 'tea', 5)).toEqual([]);
  });

  it('never deletes another pet’s memory', async () => {
    const theirs = memories.add({ petId: 'pip', kind: 'fact', text: 'Pip’s note' });
    const outcome = await forget({ id: theirs.id });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toBe(`No memory has the id ${theirs.id}.`);
    expect(memories.recent('pip', 5)).toHaveLength(1);
  });

  it('deletes nothing when the id matches two memories', async () => {
    const one = memories.add({ petId: 'scout', kind: 'fact', text: 'One' });
    const two = memories.add({ petId: 'scout', kind: 'fact', text: 'Two' });
    // Give both ids the same first two characters.
    db.prepare('UPDATE memories SET id = ? WHERE id = ?').run(`ab${one.id.slice(2)}`, one.id);
    db.prepare('UPDATE memories SET id = ? WHERE id = ?').run(`ab${two.id.slice(2)}`, two.id);

    const outcome = await forget({ id: 'm-ab' });

    expect(outcome.isError).toBe(true);
    expect(outcome.content).toMatch(/^m-ab matches 2 memories: m-ab\S{6} \(fact\) \w+; m-ab/);
    expectFact(outcome.content);
    expect(memories.recent('scout', 5)).toHaveLength(2);
  });

  it('deletes nothing without a query or an id', async () => {
    memories.add({ petId: 'scout', kind: 'fact', text: 'Uses pnpm' });
    for (const input of [{}, { id: '  ' }, { query: '' }, null, 'tea']) {
      const outcome = await forget(input);
      expect(outcome.isError).toBe(true);
      expectFact(outcome.content);
    }
    expect(memories.recent('scout', 5)).toHaveLength(1);
  });

  it('is a write tool, and a routine’s own turn does not get it', () => {
    const tool = fakeTurnTools({ memory: memories }).tools.find((t) => t.id === FORGET);
    expect(tool?.kind).toBe('write');
    const routine = fakeTurnTools(
      { memory: memories },
      { routine: { routineId: 'r', name: 'Morning', handedOff: () => undefined } },
    );
    expect(routine.tools.map((t) => t.id)).not.toContain(FORGET);
  });
});
