/** Tests for AskStore: saving, settling once, the lists, pruning and Delete all. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../memory/db';
import { ANSWERED_SUMMARY_CHARS, ASK_KEEP_DAYS, AskStore, type NewAsk } from './store';

let db: Database.Database;
let store: AskStore;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  store = new AskStore(db);
});

afterEach(() => db.close());

const DAY = 86_400_000;

function ask(id: string, createdAt: string, extra: Partial<NewAsk> = {}): NewAsk {
  return {
    id,
    kind: 'app-change',
    petId: 'scout',
    summary: 'Create a page\ntitle: Plan',
    risk: 'change',
    app: 'Notion',
    tool: 'create_page',
    createdAt,
    ...extra,
  };
}

describe('AskStore', () => {
  it('saves an ask waiting, and reads it back with its payload', () => {
    store.insert(ask('a1', '2026-10-22T10:00:00.000Z', { payload: { brief: { ask: 'x' } } }));
    expect(store.get('a1')).toEqual({
      ...ask('a1', '2026-10-22T10:00:00.000Z'),
      payload: { brief: { ask: 'x' } },
      state: 'waiting',
    });
    expect(store.get('nope')).toBeNull();
  });

  it('hides a secret in the summary before it is saved', () => {
    store.insert(
      ask('a1', '2026-10-22T10:00:00.000Z', {
        summary: 'key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      }),
    );
    expect(store.get('a1')?.summary).not.toContain('sk-ant-api03');
  });

  it('settles once: the second settle loses', () => {
    store.insert(ask('a1', '2026-10-22T10:00:00.000Z'));
    expect(store.settle('a1', 'approved', { by: 'you', at: '2026-10-22T10:01:00.000Z' })).toBe(
      true,
    );
    expect(store.settle('a1', 'declined', { by: 'you' })).toBe(false);
    expect(store.settle('nope', 'declined')).toBe(false);
    expect(store.get('a1')).toMatchObject({
      state: 'approved',
      answeredBy: 'you',
      answeredAt: '2026-10-22T10:01:00.000Z',
    });
  });

  it('keeps only a short first line of an answered ask, and drops its payload', () => {
    const long = `Create a page called ${'x'.repeat(300)}`;
    store.insert(
      ask('a1', '2026-10-22T10:00:00.000Z', {
        summary: `${long}\nbody: the whole plan`,
        payload: { brief: { ask: 'x' } },
      }),
    );
    store.settle('a1', 'expired', { note: 'closed' });
    const settled = store.get('a1');
    expect(settled?.summary.length).toBeLessThanOrEqual(ANSWERED_SUMMARY_CHARS);
    expect(settled?.summary.startsWith('Create a page called x')).toBe(true);
    expect(settled?.summary).not.toContain('body');
    expect(settled?.payload).toBeUndefined();
    expect(settled).toMatchObject({ state: 'expired', note: 'closed' });
    expect(settled?.answeredBy).toBeUndefined();
  });

  it('lists the waiting oldest first and the answered newest first', () => {
    store.insert(ask('a2', '2026-10-22T10:02:00.000Z'));
    store.insert(ask('a1', '2026-10-22T10:01:00.000Z'));
    store.insert(ask('a3', '2026-10-22T10:03:00.000Z'));
    store.insert(ask('a4', '2026-10-22T10:04:00.000Z'));
    store.settle('a3', 'declined', { by: 'you', at: '2026-10-22T11:00:00.000Z' });
    store.settle('a4', 'approved', { by: 'you', at: '2026-10-22T12:00:00.000Z' });
    expect(store.waiting().map((row) => row.id)).toEqual(['a1', 'a2']);
    expect(store.recent().map((row) => row.id)).toEqual(['a4', 'a3']);
    expect(store.recent(1).map((row) => row.id)).toEqual(['a4']);
  });

  it(`prunes answered asks after ${ASK_KEEP_DAYS} days and never a waiting one`, () => {
    const now = Date.parse('2026-12-01T00:00:00.000Z');
    const old = new Date(now - (ASK_KEEP_DAYS + 1) * DAY).toISOString();
    const fresh = new Date(now - DAY).toISOString();
    store.insert(ask('old-answered', old));
    store.insert(ask('fresh-answered', old));
    store.insert(ask('old-waiting', old));
    store.settle('old-answered', 'declined', { by: 'you', at: old });
    store.settle('fresh-answered', 'declined', { by: 'you', at: fresh });
    expect(store.prune(now)).toBe(1);
    expect(store.get('old-answered')).toBeNull();
    expect(store.get('fresh-answered')).not.toBeNull();
    expect(store.get('old-waiting')?.state).toBe('waiting');
  });

  it('Delete all clears answered asks and keeps the waiting', () => {
    store.insert(ask('a1', '2026-10-22T10:00:00.000Z'));
    store.insert(ask('a2', '2026-10-22T10:00:00.000Z'));
    store.settle('a1', 'approved', { by: 'you' });
    expect(store.clear()).toBe(1);
    expect(store.get('a1')).toBeNull();
    expect(store.get('a2')?.state).toBe('waiting');
  });
});
