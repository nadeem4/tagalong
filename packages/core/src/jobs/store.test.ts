/** Tests for JobStore: a job's row from queued to finished, boot cleanup and the 14-day prune. */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../memory/db';
import { ConversationStore } from '../memory/store';
import { JobStore } from './store';

const T0 = '2026-10-17T09:00:00.000Z';

function setup(): { jobs: JobStore; db: Database.Database; conversations: ConversationStore } {
  const db = new Database(':memory:');
  migrate(db);
  return { jobs: new JobStore(db), db, conversations: new ConversationStore(db) };
}

const NEW = { petId: 'scout', task: 'Read the paper', dedupeKey: 'read the paper' };

describe('JobStore', () => {
  it('inserts a queued job, starts it in its conversation and finishes it with a note', () => {
    const { jobs } = setup();
    const row = jobs.insert({ id: 'a1', ...NEW, at: T0 });
    expect(row).toMatchObject({ id: 'a1', state: 'queued', task: 'Read the paper' });

    jobs.start('a1', 'conv-1', '2026-10-17T09:01:00.000Z');
    expect(jobs.get('a1')).toMatchObject({ state: 'running', conversationId: 'conv-1' });

    jobs.finish('a1', { state: 'done', note: 'The gist.' }, '2026-10-17T09:05:00.000Z');
    expect(jobs.get('a1')).toMatchObject({
      state: 'done',
      note: 'The gist.',
      error: null,
      finishedAt: '2026-10-17T09:05:00.000Z',
    });
    expect(jobs.get('nope')).toBeNull();
  });

  it('marks finished jobs told, once, and only the ones named', () => {
    const { jobs } = setup();
    for (const id of ['a', 'b', 'c']) jobs.insert({ id, ...NEW, at: T0 });
    expect(jobs.get('a')?.reportedAt).toBeNull();
    jobs.markReported(['a', 'b'], '2026-10-17T09:30:00.000Z');
    jobs.markReported(['a'], '2026-10-17T10:00:00.000Z');
    expect(jobs.get('a')?.reportedAt).toBe('2026-10-17T09:30:00.000Z');
    expect(jobs.get('b')?.reportedAt).toBe('2026-10-17T09:30:00.000Z');
    expect(jobs.get('c')?.reportedAt).toBeNull();
    jobs.markReported([], T0);
  });

  it('lists live jobs and those finished since a time, newest first', () => {
    const { jobs } = setup();
    jobs.insert({ id: 'old', ...NEW, at: '2026-10-15T09:00:00.000Z' });
    jobs.finish('old', { state: 'done', note: '' }, '2026-10-15T09:10:00.000Z');
    jobs.insert({ id: 'new', ...NEW, at: '2026-10-17T08:00:00.000Z' });
    jobs.finish('new', { state: 'error', error: 'boom' }, '2026-10-17T08:10:00.000Z');
    jobs.insert({ id: 'live', ...NEW, at: '2026-10-14T08:00:00.000Z' });

    expect(jobs.list('2026-10-16T09:00:00.000Z').map((row) => row.id)).toEqual(['new', 'live']);
  });

  it('finds the latest job with a dedupe key', () => {
    const { jobs } = setup();
    jobs.insert({ id: 'a', ...NEW, at: '2026-10-17T08:00:00.000Z' });
    jobs.insert({ id: 'b', ...NEW, at: '2026-10-17T08:30:00.000Z' });
    jobs.insert({ id: 'c', ...NEW, dedupeKey: 'other', at: '2026-10-17T08:40:00.000Z' });
    expect(jobs.latestByKey('read the paper')?.id).toBe('b');
    expect(jobs.latestByKey('nothing')).toBeNull();
  });

  it('counts the jobs created since a time', () => {
    const { jobs } = setup();
    jobs.insert({ id: 'a', ...NEW, at: '2026-10-16T23:00:00.000Z' });
    jobs.insert({ id: 'b', ...NEW, at: '2026-10-17T01:00:00.000Z' });
    jobs.insert({ id: 'c', ...NEW, at: '2026-10-17T02:00:00.000Z' });
    expect(jobs.countSince('2026-10-17T00:00:00.000Z')).toBe(2);
  });

  it('finds finished jobs by words and by id prefix, and deletes one with its conversation', () => {
    const { jobs, conversations, db } = setup();
    const conversation = conversations.createConversation({ petId: 'scout' });
    conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'brief' }],
    });
    jobs.insert({
      id: 'ab12cd34-0000-4000-8000-000000000001',
      ...NEW,
      task: 'Compare pricing',
      at: T0,
    });
    jobs.start('ab12cd34-0000-4000-8000-000000000001', conversation.id, T0);
    jobs.finish('ab12cd34-0000-4000-8000-000000000001', { state: 'done', note: '' }, T0);
    jobs.insert({
      id: 'ab99ffff-0000-4000-8000-000000000002',
      ...NEW,
      task: 'pricing, live',
      at: T0,
    });

    expect(jobs.search('the PRICING page', 5).map((row) => row.task)).toEqual(['Compare pricing']);
    expect(jobs.search('', 5)).toEqual([]);
    expect(jobs.finishedByPrefix('ab12').map((row) => row.task)).toEqual(['Compare pricing']);
    expect(jobs.finishedByPrefix('ab99')).toEqual([]);

    expect(jobs.delete('ab12cd34-0000-4000-8000-000000000001')).toBe(true);
    expect(jobs.delete('ab99ffff-0000-4000-8000-000000000002')).toBe(false);
    expect(jobs.get('ab12cd34-0000-4000-8000-000000000001')).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(0);
  });

  it('closes queued and running jobs at boot as interrupted', () => {
    const { jobs } = setup();
    jobs.insert({ id: 'q', ...NEW, at: T0 });
    jobs.insert({ id: 'r', ...NEW, at: T0 });
    jobs.start('r', 'conv', T0);
    jobs.insert({ id: 'd', ...NEW, at: T0 });
    jobs.finish('d', { state: 'done', note: 'ok' }, T0);

    expect(jobs.interrupted(T0)).toBe(2);
    expect(jobs.get('q')).toMatchObject({ state: 'error', error: expect.stringMatching(/closed/) });
    expect(jobs.get('r')?.state).toBe('error');
    expect(jobs.get('d')?.state).toBe('done');
  });

  it('prunes jobs finished before a time, with their conversations and messages', () => {
    const { jobs, conversations, db } = setup();
    const oldConversation = conversations.createConversation({ petId: 'scout' });
    conversations.appendMessage({
      conversationId: oldConversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'brief' }],
    });
    const keptConversation = conversations.createConversation({ petId: 'scout' });
    jobs.insert({ id: 'old', ...NEW, at: '2026-10-01T09:00:00.000Z' });
    jobs.start('old', oldConversation.id, '2026-10-01T09:00:00.000Z');
    jobs.finish('old', { state: 'done', note: '' }, '2026-10-01T09:10:00.000Z');
    jobs.insert({ id: 'recent', ...NEW, at: '2026-10-10T09:00:00.000Z' });
    jobs.start('recent', keptConversation.id, '2026-10-10T09:00:00.000Z');
    jobs.finish('recent', { state: 'done', note: '' }, '2026-10-10T09:10:00.000Z');
    jobs.insert({ id: 'live', ...NEW, at: '2026-09-01T09:00:00.000Z' });

    expect(jobs.prune('2026-10-03T00:00:00.000Z')).toBe(1);
    expect(jobs.get('old')).toBeNull();
    expect(jobs.get('recent')).not.toBeNull();
    expect(jobs.get('live')).not.toBeNull();
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(
      count(`SELECT COUNT(*) AS n FROM conversations WHERE id = '${oldConversation.id}'`),
    ).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM messages`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM conversations`)).toBe(1);
  });
});

describe('JobStore for the digest', () => {
  it('records a digest run as its own kind, kept out of the daily cap and the dedupe', () => {
    const { jobs } = setup();
    jobs.startDigest({ id: 'd1', petId: 'scout', at: T0 });
    expect(jobs.get('d1')).toMatchObject({
      kind: 'digest',
      state: 'running',
      task: 'Tidy memory',
      startedAt: T0,
    });
    jobs.finish('d1', { state: 'done', note: 'Added 1.' }, '2026-10-17T09:01:00.000Z');
    jobs.startDigest({ id: 'd2', petId: 'scout', at: '2026-10-17T10:00:00.000Z' });

    expect(jobs.digests('2026-10-17T00:00:00.000Z').map((row) => row.id)).toEqual(['d2', 'd1']);
    expect(jobs.digests('2026-10-17T09:30:00.000Z').map((row) => row.id)).toEqual(['d2']);
    expect(jobs.countSince('2026-10-17T00:00:00.000Z')).toBe(0);
    expect(jobs.latestByKey('')).toBeNull();
    expect(jobs.insert({ id: 'j1', ...NEW, at: T0 }).kind).toBe('job');
  });

  it('lists finished jobs the digest has not read, and marks them read', () => {
    const { jobs } = setup();
    jobs.insert({ id: 'a', ...NEW, at: T0 });
    jobs.finish('a', { state: 'done', note: 'A.' }, '2026-10-17T09:05:00.000Z');
    jobs.insert({ id: 'b', ...NEW, at: T0 });
    jobs.finish('b', { state: 'done', note: 'B.' }, '2026-10-17T09:06:00.000Z');
    jobs.insert({ id: 'failed', ...NEW, at: T0 });
    jobs.finish('failed', { state: 'error', error: 'boom' }, '2026-10-17T09:07:00.000Z');
    jobs.insert({ id: 'live', ...NEW, at: T0 });
    jobs.startDigest({ id: 'd', petId: 'scout', at: T0 });
    jobs.finish('d', { state: 'done', note: '' }, '2026-10-17T09:08:00.000Z');

    expect(jobs.undigested(10).map((row) => row.id)).toEqual(['b', 'a']);
    expect(jobs.undigested(1).map((row) => row.id)).toEqual(['b']);

    jobs.markDigested(['b'], '2026-10-17T10:00:00.000Z');
    expect(jobs.undigested(10).map((row) => row.id)).toEqual(['a']);
    jobs.markDigested([], '2026-10-17T10:00:00.000Z');
  });

  it('lists jobs that finished well since a time, for recall', () => {
    const { jobs } = setup();
    jobs.insert({ id: 'old', ...NEW, at: T0 });
    jobs.finish('old', { state: 'done', note: '' }, '2026-10-01T09:00:00.000Z');
    jobs.insert({ id: 'new', ...NEW, at: T0 });
    jobs.finish('new', { state: 'done', note: 'N.' }, '2026-10-16T09:00:00.000Z');
    jobs.insert({ id: 'failed', ...NEW, at: T0 });
    jobs.finish('failed', { state: 'error', error: 'x' }, '2026-10-16T09:00:00.000Z');
    jobs.startDigest({ id: 'd', petId: 'scout', at: T0 });
    jobs.finish('d', { state: 'done', note: 'Added 1.' }, '2026-10-16T09:00:00.000Z');

    expect(jobs.doneSince('2026-10-03T00:00:00.000Z').map((row) => row.id)).toEqual(['new']);
  });
});
