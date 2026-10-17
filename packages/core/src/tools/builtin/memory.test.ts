/**
 * Tests for the remember tool (files under the calling pet, ignores `shared`, checks its
 * input) and the forget tool (lists by query, deletes by id, facts-only results).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../memory/db';
import { MemoryStore } from '../../memory/memories';
import { fakeTurnTools } from '../fake-turn';
import { directivesIn } from '../test-support';
import { FORGET, REMEMBER } from './memory';
import { JobStore } from '../../jobs';
import { ConversationStore } from '../../memory/store';
import type { JobToolDeps } from './jobs';

/** Job tools wired with only the store `forget` reads; the rest is not under test here. */
function jobDeps(store: JobStore): JobToolDeps {
  return {
    jobs: {
      start: () => ({ ok: false, reason: 'empty' }),
      stop: () => 'unknown',
      result: () => null,
    },
    board: () => [],
    entry: () => null,
    cancelHandoff: () => false,
    stopWatch: () => false,
    finished: store,
  };
}

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
  expect(directivesIn(text)).toEqual([]);
  expect(text).not.toMatch(/(^|[.:!?]\s+)(Never|Always|Use|Try)\b/);
}

/** Runs forget; its results are always plain text. */
const forget = async (input: unknown) => {
  const outcome = await fakeTurnTools({ memory: memories }).run({ name: FORGET, input });
  if (typeof outcome.content !== 'string') throw new Error('forget answers in text');
  return { ...outcome, content: outcome.content };
};

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
    db.exec("INSERT INTO memories_fts (memories_fts) VALUES ('integrity-check')");
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

  it('lists matching finished jobs too, and deletes one with its conversation by id', async () => {
    const jobs = new JobStore(db);
    const conversations = new ConversationStore(db);
    const conversation = conversations.createConversation({ petId: 'scout' });
    conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'brief' }],
    });
    const at = '2026-10-17T09:00:00.000Z';
    jobs.insert({
      id: 'ab12cd34-0000-4000-8000-000000000001',
      petId: 'scout',
      task: 'compare the pricing pages',
      dedupeKey: 'k',
      at,
    });
    jobs.start('ab12cd34-0000-4000-8000-000000000001', conversation.id, at);
    jobs.finish(
      'ab12cd34-0000-4000-8000-000000000001',
      { state: 'done', note: 'B is cheaper.' },
      at,
    );
    jobs.insert({
      id: 'ef560000-0000-4000-8000-000000000002',
      petId: 'scout',
      task: 'pricing again',
      dedupeKey: 'k2',
      at,
    });
    const tools = fakeTurnTools({ memory: memories, jobs: jobDeps(jobs) });
    const text = async (input: unknown) => {
      const outcome = await tools.run({ name: FORGET, input });
      return { ...outcome, content: String(outcome.content) };
    };

    const listed = await text({ query: 'pricing' });
    expect(listed.content).toContain('- j-ab12cd34 (finished job) compare the pricing pages');
    expect(listed.content).not.toContain('pricing again');
    expectFact(listed.content);

    expect(await text({ id: 'j-ab12' })).toEqual({
      content: 'Deleted: "compare the pricing pages".',
    });
    expect(jobs.get('ab12cd34-0000-4000-8000-000000000001')).toBeNull();
    expect(conversations.listMessages(conversation.id)).toEqual([]);
    expect(await text({ id: 'j-ef56' })).toEqual({
      content: 'No finished job has the id j-ef56.',
      isError: true,
    });
    expect(jobs.get('ef560000-0000-4000-8000-000000000002')).not.toBeNull();
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
